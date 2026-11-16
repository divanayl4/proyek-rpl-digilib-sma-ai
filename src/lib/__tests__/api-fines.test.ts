/**
 * Authorization and shaping tests for GET /api/fines.
 *
 * Only Admin/Pustakawan may read it; the list is restricted to RETURNED borrows
 * that actually carry a fine, and per-row outstanding / summary totals are
 * derived from partial FinePayment rows.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockBorrowAgg = jest.fn();
const mockPaymentAgg = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    borrowRecord: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
      aggregate: (...args: unknown[]) => mockBorrowAgg(...args),
    },
    finePayment: {
      aggregate: (...args: unknown[]) => mockPaymentAgg(...args),
    },
  },
}));

jest.mock("@/lib/config/settings", () => ({
  getFinePerDayIDR: jest.fn(async () => 1000),
}));

import { GET as getFines } from "@/app/api/fines/route";

const MS_PER_DAY = 24 * 3600 * 1000;

function signInAs(role: string) {
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", role } });
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/fines${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockBorrowAgg.mockResolvedValue({ _sum: { fineAmount: 0 } });
  mockPaymentAgg.mockResolvedValue({ _sum: { amount: 0 } });
});

describe("GET /api/fines – authorization", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getFines(request());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it.each(["STUDENT", "TEACHER", "STAFF"])(
    "forbids %s from reading fines",
    async (role) => {
      signInAs(role);
      const res = await getFines(request());
      expect(res.status).toBe(403);
      expect(mockFindMany).not.toHaveBeenCalled();
    }
  );

  it.each(["ADMIN", "LIBRARIAN"])("allows %s to read fines", async (role) => {
    signInAs(role);
    const res = await getFines(request());
    expect(res.status).toBe(200);
  });
});

describe("GET /api/fines – filtering", () => {
  it("only ever selects returned borrows that carry a fine", async () => {
    signInAs("LIBRARIAN");
    await getFines(request());

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("RETURNED");
    expect(where.fineAmount).toEqual({ gt: 0 });
  });

  it("filters by unpaid status", async () => {
    signInAs("LIBRARIAN");
    await getFines(request("?status=UNPAID"));
    expect(mockFindMany.mock.calls[0][0].where.finePaid).toBe(false);
  });

  it("filters by paid status", async () => {
    signInAs("LIBRARIAN");
    await getFines(request("?status=PAID"));
    expect(mockFindMany.mock.calls[0][0].where.finePaid).toBe(true);
  });

  it("builds a search OR across borrower and book", async () => {
    signInAs("LIBRARIAN");
    await getFines(request("?search=budi"));
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
    expect(where.OR).toHaveLength(4);
  });

  it("scopes the year filter to returnDate", async () => {
    signInAs("LIBRARIAN");
    await getFines(request("?year=2026"));
    const range = mockFindMany.mock.calls[0][0].where.returnDate;
    expect(range.gte).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(range.lt).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });
});

describe("GET /api/fines – aggregation", () => {
  it("derives per-row totalPaid, outstanding and daysLate", async () => {
    signInAs("LIBRARIAN");
    const returnDate = new Date("2026-05-20T10:00:00.000Z");
    const dueDate = new Date(returnDate.getTime() - 3 * MS_PER_DAY);
    mockFindMany.mockResolvedValue([
      {
        id: "b1",
        dueDate,
        returnDate,
        fineAmount: 3000,
        fineRate: 1000,
        finePaid: false,
        finePaidAt: null,
        user: { id: "u2", name: "Budi", email: "b@x.id", role: "STUDENT", class: "X", identityNumber: null },
        book: { id: "bk", title: "Buku", author: "A", isbn: null, coverUrl: null },
        finePayments: [{ amount: 1000 }, { amount: 500 }],
        finePaidBy: null,
      },
    ]);
    mockCount.mockResolvedValue(1);
    mockBorrowAgg.mockResolvedValue({ _sum: { fineAmount: 3000 } });
    mockPaymentAgg.mockResolvedValue({ _sum: { amount: 1500 } });

    const res = await getFines(request());
    const body = await res.json();

    expect(body.fines[0].totalPaid).toBe(1500);
    expect(body.fines[0].outstanding).toBe(1500);
    expect(body.fines[0].daysLate).toBe(3);
    expect(body.fines[0].paymentStatus).toBe("PARTIAL");
    expect(body.summary).toEqual({
      totalFine: 3000,
      totalPaid: 1500,
      totalOutstanding: 1500,
      unpaidCount: 1,
      partialCount: 1,
      paidCount: 0,
    });
  });

  it("returns the effective rate for display", async () => {
    signInAs("LIBRARIAN");
    const res = await getFines(request());
    const body = await res.json();
    expect(body.ratePerDay).toBe(1000);
  });
});
