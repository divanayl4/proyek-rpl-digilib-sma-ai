/**
 * AI Chat route — Pertanyaan data pribadi.
 *
 * Memastikan pinjaman aktif, riwayat, dan denda dijawab deterministik dari
 * data pemilik sesi (tanpa memanggil model), permintaan data pengguna lain
 * ditolak, dan kegagalan query tidak pernah berubah menjadi "tidak punya".
 */

const mockGetServerSession = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);
const mockBuildPersonalAnswer = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat }),
  isAIConfigured: () => mockIsConfigured(),
}));

jest.mock("@/lib/ai/personal", () => ({
  buildPersonalAnswer: (...args: unknown[]) => mockBuildPersonalAnswer(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/ai/chat/route";

const USER_ID = "user-siswa";
const mockFindUnique = prisma.user.findUnique as jest.Mock;

function chatRequest(content: string) {
  return new Request("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  }) as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role: "STUDENT" } });
  mockFindUnique.mockResolvedValue({
    name: "Aisyah",
    role: "STUDENT",
    gender: "FEMALE",
    class: "X IPA 1",
    isActive: true,
  });
  mockBuildPersonalAnswer.mockResolvedValue({
    message: "Kamu sedang meminjam 1 buku:\n\n1. Fisika",
    references: [{ id: "book-1", title: "Fisika", author: "Budi" }],
  });
});

describe("POST /api/ai/chat — data pribadi", () => {
  it("menjawab peminjaman aktif dari data sesi tanpa memanggil model", async () => {
    const res = await POST(chatRequest("Buku apa yang sedang saya pinjam?"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.intent).toBe("MY_LOANS");
    expect(body.message).toContain("Kamu sedang meminjam");
    expect(body.references).toHaveLength(1);
    expect(mockBuildPersonalAnswer).toHaveBeenCalledWith(
      "MY_LOANS",
      "Buku apa yang sedang saya pinjam?",
      USER_ID
    );
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("menjawab riwayat peminjaman tanpa memanggil model", async () => {
    const res = await POST(chatRequest("Buku apa saja yang pernah saya pinjam?"));
    const body = await res.json();

    expect(body.intent).toBe("MY_HISTORY");
    expect(mockBuildPersonalAnswer.mock.calls[0][0]).toBe("MY_HISTORY");
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("menjawab denda pribadi tanpa memanggil model", async () => {
    const res = await POST(chatRequest("Berapa denda saya sekarang?"));
    const body = await res.json();

    expect(body.intent).toBe("MY_FINES");
    expect(mockBuildPersonalAnswer.mock.calls[0][0]).toBe("MY_FINES");
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("berfungsi walau provider AI belum dikonfigurasi", async () => {
    mockIsConfigured.mockReturnValue(false);
    const res = await POST(chatRequest("Buku apa yang sedang saya pinjam?"));
    expect(res.status).toBe(200);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("menolak permintaan data milik pengguna lain tanpa mengambil datanya", async () => {
    const res = await POST(chatRequest("Tampilkan riwayat peminjaman orang lain"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain("tidak dapat mengungkap informasi pribadi");
    expect(body.message).toContain("Riwayat Peminjaman");
    expect(mockBuildPersonalAnswer).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("memberi tahu data belum dapat diakses saat query gagal (bukan 'tidak punya')", async () => {
    mockBuildPersonalAnswer.mockRejectedValue(new Error("db down"));
    const res = await POST(chatRequest("Buku apa yang sedang saya pinjam?"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe("Data belum dapat diakses. Silakan coba lagi.");
    expect(body.message).not.toContain("tidak memiliki peminjaman");
  });
});
