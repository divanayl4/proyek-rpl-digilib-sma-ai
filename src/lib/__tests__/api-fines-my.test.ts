/**
 * GET /api/fines/my — self-service fine history.
 *
 * The route must always scope to the authenticated session user, regardless of
 * any `userId` supplied by the client, and expose payment/outstanding totals
 * derived from FinePayment rows.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockBorrowAgg = jest.fn();
const mockPaymentAgg = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

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

import { GET as getMyFines } from "@/app/api/fines/my/route";

const MS_PER_DAY = 24 * 3600 * 1000;

function signInAs(role: string, id = "u-self") {
  mockGetServerSession.mockResolvedValue({ user: { id, role } });
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/fines/my${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockBorrowAgg.mockResolvedValue({ _sum: { fineAmount: 0 } });
  mockPaymentAgg.mockResolvedValue({ _sum: { amount: 0 } });
});

describe("GET /api/fines/my – authorization & scoping", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getMyFines(request());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it.each(["STUDENT", "TEACHER", "STAFF", "LIBRARIAN", "ADMIN"])(
    "allows %s to read only their own fines",
    async (role) => {
      signInAs(role, "user-123");
      const res = await getMyFines(request());
      expect(res.status).toBe(200);
      expect(mockFindMany.mock.calls[0][0].where.userId).toBe("user-123");
    }
  );

  it("ignores a userId supplied in the query string", async () => {
    signInAs("STUDENT", "u-self");
    await getMyFines(request("?userId=someone-else"));
    expect(mockFindMany.mock.calls[0][0].where.userId).toBe("u-self");
  });

  it("only ever selects returned borrows that carry a fine", async () => {
    signInAs("STUDENT");
    await getMyFines(request());
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("RETURNED");
    expect(where.fineAmount).toEqual({ gt: 0 });
  });
});

describe("GET /api/fines/my – filtering", () => {
  it("filters by unpaid status", async () => {
    signInAs("STUDENT");
    await getMyFines(request("?status=UNPAID"));
    expect(mockFindMany.mock.calls[0][0].where.finePaid).toBe(false);
  });

  it("filters by paid status", async () => {
    signInAs("STUDENT");
    await getMyFines(request("?status=PAID"));
    expect(mockFindMany.mock.calls[0][0].where.finePaid).toBe(true);
  });

  it("scopes the year filter to returnDate", async () => {
    signInAs("STUDENT");
    await getMyFines(request("?year=2026"));
    const range = mockFindMany.mock.calls[0][0].where.returnDate;
    expect(range.gte).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(range.lt).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });
});

describe("GET /api/fines/my – aggregation", () => {
  it("derives per-row totalPaid, outstanding and daysLate", async () => {
    signInAs("STUDENT");
    const returnDate = new Date("2026-05-20T10:00:00.000Z");
    const dueDate = new Date(returnDate.getTime() - 3 * MS_PER_DAY);
    mockFindMany.mockResolvedValue([
      {
        id: "b1",
        borrowDate: new Date("2026-05-01T10:00:00.000Z"),
        dueDate,
        returnDate,
        fineAmount: 3000,
        lateFineAmount: 3000,
        damageFineAmount: 0,
        returnCondition: null,
        fineRate: 1000,
        finePaid: false,
        finePaidAt: null,
        book: { id: "bk", title: "Buku", author: "A", isbn: null, coverUrl: null },
        finePayments: [
          { amount: 1000, createdAt: new Date("2026-05-21T10:00:00.000Z") },
          { amount: 500, createdAt: new Date("2026-05-22T10:00:00.000Z") },
        ],
      },
    ]);
    mockCount.mockResolvedValue(1);
    mockBorrowAgg.mockResolvedValue({ _sum: { fineAmount: 3000 } });
    mockPaymentAgg.mockResolvedValue({ _sum: { amount: 1500 } });

    const res = await getMyFines(request());
    const body = await res.json();

    expect(body.fines[0].totalPaid).toBe(1500);
    expect(body.fines[0].outstanding).toBe(1500);
    expect(body.fines[0].daysLate).toBe(3);
    expect(body.fines[0].paymentStatus).toBe("PARTIAL");
    expect(body.fines[0].lastPaymentAt).toBe("2026-05-22T10:00:00.000Z");
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
    signInAs("STUDENT");
    const res = await getMyFines(request());
    const body = await res.json();
    expect(body.ratePerDay).toBe(1000);
  });
});
