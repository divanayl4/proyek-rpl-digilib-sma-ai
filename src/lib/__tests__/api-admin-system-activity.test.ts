import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockEbookLoanFindMany = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    borrowRecord: { findMany: (...args: unknown[]) => mockBorrowFindMany(...args) },
    ebookLoan: { findMany: (...args: unknown[]) => mockEbookLoanFindMany(...args) },
  },
}));

import { GET as getSystemActivity } from "@/app/api/admin/system-activity/route";

describe("GET /api/admin/system-activity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("menolak akses jika tidak login (401)", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/admin/system-activity?period=7days");
    const res = await getSystemActivity(req);
    expect(res.status).toBe(401);
  });

  it("menolak akses jika bukan role ADMIN (403)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    const req = new NextRequest("http://localhost/api/admin/system-activity?period=7days");
    const res = await getSystemActivity(req);
    expect(res.status).toBe(403);
  });

  it("mengembalikan data time-series terpisah untuk buku fisik dan ebook (200)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });

    const date1 = new Date("2026-10-20T10:00:00Z");
    const date2 = new Date("2026-10-21T10:00:00Z");

    mockBorrowFindMany
      .mockResolvedValueOnce([{ borrowDate: date1 }, { borrowDate: date2 }]) // borrows
      .mockResolvedValueOnce([{ returnDate: date1 }]); // returns
    mockEbookLoanFindMany.mockResolvedValueOnce([{ borrowedAt: date1 }]); // ebook loans

    const req = new NextRequest("http://localhost/api/admin/system-activity?period=7days");
    const res = await getSystemActivity(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.period).toBe("7days");
  });
});
