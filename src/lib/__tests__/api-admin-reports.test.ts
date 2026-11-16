const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

const mockBookAggregate = jest.fn();
const mockBookFindMany = jest.fn();
const mockUserCount = jest.fn();
const mockBorrowCount = jest.fn();
const mockBorrowAggregate = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockBorrowGroupBy = jest.fn();
const mockFineAggregate = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: {
      aggregate: (...args: unknown[]) => mockBookAggregate(...args),
      findMany: (...args: unknown[]) => mockBookFindMany(...args),
    },
    user: { count: (...args: unknown[]) => mockUserCount(...args) },
    borrowRecord: {
      count: (...args: unknown[]) => mockBorrowCount(...args),
      aggregate: (...args: unknown[]) => mockBorrowAggregate(...args),
      findMany: (...args: unknown[]) => mockBorrowFindMany(...args),
      groupBy: (...args: unknown[]) => mockBorrowGroupBy(...args),
    },
    finePayment: {
      aggregate: (...args: unknown[]) => mockFineAggregate(...args),
    },
  },
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/reports/route";

function request() {
  return new NextRequest("http://localhost/api/admin/reports");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBookAggregate.mockResolvedValue({ _sum: { stock: 5 } });
  mockUserCount.mockResolvedValue(2);
  mockBorrowCount.mockResolvedValue(3);
  mockBorrowAggregate.mockResolvedValue({ _sum: { fineAmount: 1000 } });
  mockFineAggregate.mockResolvedValue({ _sum: { amount: 500 } });
  mockBorrowFindMany.mockResolvedValue([]);
  mockBorrowGroupBy.mockResolvedValue([]);
  mockBookFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/reports", () => {
  it("menolak request tanpa sesi", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(mockBorrowCount).not.toHaveBeenCalled();
  });

  it.each(["LIBRARIAN", "STUDENT", "TEACHER", "STAFF"])(
    "menolak role %s",
    async (role) => {
      mockGetServerSession.mockResolvedValue({ user: { id: "u1", role } });

      const res = await GET(request());

      expect(res.status).toBe(403);
      expect(mockBorrowCount).not.toHaveBeenCalled();
    }
  );

  it("mengembalikan ringkasan untuk ADMIN", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });

    const res = await GET(request());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toMatchObject({
      totalBooks: 5,
      totalUsers: 2,
      totalBorrows: 3,
      fineAssessed: 1000,
      fineCollected: 500,
      fineOutstanding: 500,
    });
    expect(body.chartData).toEqual([]);
    expect(body.exportList).toEqual([]);
  });
});
