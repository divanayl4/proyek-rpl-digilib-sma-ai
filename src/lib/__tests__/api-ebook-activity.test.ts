const mockGetServerSession = jest.fn();
const mockRecord = jest.fn();
const mockAllow = jest.fn();
const mockGetAccess = jest.fn();
const mockBookFindUnique = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: { findUnique: (...args: unknown[]) => mockBookFindUnique(...args) },
  },
}));

jest.mock("@/lib/ebook-access", () => ({
  EBOOK_DENIAL_MESSAGE: {
    NOT_FOUND: "Ebook tidak ditemukan",
    NOT_AN_EBOOK: "Koleksi ini bukan ebook",
    NO_FILE: "Berkas ebook belum tersedia",
    NOT_BORROWED: "Anda belum meminjam ebook ini",
    RETURNED: "Peminjaman ebook ini sudah dikembalikan",
    EXPIRED: "Masa akses ebook telah habis",
    FORBIDDEN: "Anda tidak berhak membaca ebook ini",
  },
  getEbookAccessDecision: (...args: unknown[]) => mockGetAccess(...args),
}));

jest.mock("@/lib/ebook-reading", () => ({
  allowReadingActivityRequest: (...args: unknown[]) => mockAllow(...args),
  recordEbookReadingActivity: (...args: unknown[]) => mockRecord(...args),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/ebooks/[id]/activity/route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/ebooks/book-1/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: { id: "book-1" } };
}

function signIn(role = "STUDENT") {
  mockGetServerSession.mockResolvedValue({
    user: { id: "student-1", role },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllow.mockReturnValue(true);
  mockRecord.mockResolvedValue({
    sessionId: "session-1",
    status: "OPENED",
    created: true,
    closed: false,
  });
  mockGetAccess.mockResolvedValue({
    ok: true,
    status: 200,
    accessState: "ACTIVE",
    remainingMs: 86400000,
    book: { id: "book-1", title: "Ebook Uji", pageCount: 100 },
    loan: { id: "loan-1" },
  });
  mockBookFindUnique.mockResolvedValue({ id: "book-1", format: "EBOOK" });
});

describe("POST /api/ebooks/[id]/activity", () => {
  it("menolak request tanpa sesi server", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await POST(req({ event: "open" }), params());

    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("mengabaikan userId dari browser dan memakai identitas sesi", async () => {
    signIn("STUDENT");

    const res = await POST(
      req({ event: "open", userId: "user-lain", page: 50 }),
      params()
    );

    expect(res.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "student-1",
        bookId: "book-1",
        loanId: "loan-1",
        page: 50,
        progressPercent: 50,
      })
    );
  });

  it("menolak aktivitas bila akses ebook tidak sah", async () => {
    signIn("STUDENT");
    mockGetAccess.mockResolvedValue({
      ok: false,
      status: 403,
      accessState: "NOT_BORROWED",
      reason: "NOT_BORROWED",
      remainingMs: 0,
    });

    const res = await POST(req({ event: "heartbeat" }), params());

    expect(res.status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("menolak halaman di luar pageCount sebelum menyimpan", async () => {
    signIn("STUDENT");

    const res = await POST(req({ event: "open", page: 101 }), params());

    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("menolak event yang tidak dikenal", async () => {
    signIn("STUDENT");

    const res = await POST(req({ event: "scroll" }), params());

    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("close boleh menutup sesi sendiri walau akses sudah berakhir", async () => {
    signIn("STUDENT");
    mockRecord.mockResolvedValue({
      sessionId: "session-1",
      status: "INACTIVE",
      created: false,
      closed: true,
    });

    const res = await POST(req({ event: "close" }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.closed).toBe(true);
    expect(mockGetAccess).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "student-1",
        event: "close",
      })
    );
  });

  it("membatasi request berlebihan dengan 429", async () => {
    signIn("STUDENT");
    mockAllow.mockReturnValue(false);

    const res = await POST(req({ event: "heartbeat" }), params());

    expect(res.status).toBe(429);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
