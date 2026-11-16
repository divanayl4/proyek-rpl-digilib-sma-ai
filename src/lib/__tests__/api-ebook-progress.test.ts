const mockGetServerSession = jest.fn();
const mockFindFirst = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    ebookReadingSession: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/ebooks/[id]/progress/route";

function createReq() {
  return new NextRequest("http://localhost/api/ebooks/book-1/progress", {
    method: "GET",
  });
}

describe("GET /api/ebooks/[id]/progress", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("mengembalikan 401 jika pengguna belum terautentikasi", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(createReq(), { params: { id: "book-1" } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("mengembalikan found: false jika belum ada sesi membaca", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "STUDENT" },
    });
    mockFindFirst.mockResolvedValue(null);

    const res = await GET(createReq(), { params: { id: "book-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.lastPage).toBeNull();
    expect(body.progressPercent).toBeNull();
  });

  it("mengembalikan data progres membaca terbaru", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "STUDENT" },
    });
    mockFindFirst.mockResolvedValue({
      id: "session-1",
      lastPage: 42,
      progressPercent: 35.5,
      firstOpenedAt: new Date("2026-10-20T10:00:00Z"),
      lastActivityAt: new Date("2026-10-20T10:30:00Z"),
      activityCount: 5,
    });

    const res = await GET(createReq(), { params: { id: "book-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.lastPage).toBe(42);
    expect(body.progressPercent).toBe(35.5);
    expect(body.activityCount).toBe(5);
  });
});
