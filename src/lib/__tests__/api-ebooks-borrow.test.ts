/**
 * Business-rule tests for borrowing and returning ebooks.
 *
 * Focus: the window is always 5 days from borrowedAt, a user can never stack
 * windows on the same ebook, the concurrent quota is enforced, and a loan can
 * only ever be closed by the user who owns it.
 */

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

const mockTx = {
  user: { findUnique: jest.fn() },
  book: { findUnique: jest.fn() },
  ebookLoan: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  auditLog: { create: jest.fn() },
};

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
    book: { findUnique: jest.fn(), create: jest.fn() },
    ebookLoan: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/notifications", () => ({
  notifyEbookBorrowed: jest.fn(),
  notifyEbookExpired: jest.fn(),
  notifyEbookReturned: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { EBOOK_CONFIG, MS_PER_DAY, getCalendarWeekRange } from "@/lib/config/ebook";
import { POST as borrowEbook } from "@/app/api/ebooks/route";
import { POST as returnEbook } from "@/app/api/ebooks/return/route";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const BOOK_ID = "book-1";

function borrowRequest(body: unknown) {
  return new Request("http://localhost:3000/api/ebooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function returnRequest(body: unknown) {
  return new Request("http://localhost:3000/api/ebooks/return", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role: "STUDENT" } });

  mockTx.user.findUnique.mockResolvedValue({
    id: USER_ID,
    name: "Siswa Rajin",
    role: "STUDENT",
    isActive: true,
  });
  mockTx.book.findUnique.mockResolvedValue({
    id: BOOK_ID,
    title: "Ebook Uji",
    format: "EBOOK",
    filePath: "uji.pdf",
  });
  mockTx.ebookLoan.findFirst.mockResolvedValue(null);
  mockTx.ebookLoan.findMany.mockResolvedValue([]);
  mockTx.ebookLoan.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "loan-1",
    ...data,
  }));
});

describe("Borrowing an ebook", () => {
  it("requires an authenticated session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(401);
    expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
  });

  it("rejects a missing bookId", async () => {
    const res = await borrowEbook(borrowRequest({}));

    expect(res.status).toBe(400);
  });

  it("stores borrowedAt and expiresAt exactly 5 days apart", async () => {
    const before = Date.now();
    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));
    const after = Date.now();

    expect(res.status).toBe(201);

    const { data } = mockTx.ebookLoan.create.mock.calls[0][0];
    const borrowedAt = new Date(data.borrowedAt as string).getTime();
    const expiresAt = new Date(data.expiresAt as string).getTime();

    expect(borrowedAt).toBeGreaterThanOrEqual(before);
    expect(borrowedAt).toBeLessThanOrEqual(after);
    expect(expiresAt - borrowedAt).toBe(EBOOK_CONFIG.accessDurationDays * MS_PER_DAY);
  });

  it("records the loan against the session user only", async () => {
    await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    const { data } = mockTx.ebookLoan.create.mock.calls[0][0];
    expect(data.userId).toBe(USER_ID);
  });

  it("ignores a caller-supplied userId so nobody can borrow on someone else's behalf", async () => {
    await borrowEbook(borrowRequest({ bookId: BOOK_ID, userId: OTHER_USER_ID }));

    const { data } = mockTx.ebookLoan.create.mock.calls[0][0];
    expect(data.userId).toBe(USER_ID);
  });

  it("refuses to renew a window that is still running", async () => {
    mockTx.ebookLoan.findFirst.mockResolvedValue({
      id: "loan-existing",
      expiresAt: new Date(Date.now() + MS_PER_DAY),
    });

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/masih aktif/i);
    expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
  });

  it("forces a return before a lapsed ebook can be borrowed again", async () => {
    mockTx.ebookLoan.findFirst.mockResolvedValue({
      id: "loan-expired",
      expiresAt: new Date(Date.now() - MS_PER_DAY),
    });

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Kembalikan terlebih dahulu/i);
    expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
  });

  it("enforces the concurrent quota of active windows", async () => {
    mockTx.ebookLoan.findMany.mockResolvedValue(
      Array.from({ length: EBOOK_CONFIG.maxActiveLoansPerUser }, (_, i) => ({ id: `l${i}` }))
    );

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/batas/i);
    expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
  });

  it("blocks a fourth loan inside the calendar week even after earlier ones were returned", async () => {
    // Create dates within the current calendar week (Monday-Sunday WIB)
    const { start: weekStart } = getCalendarWeekRange(new Date());
    const past = new Date(weekStart.getTime() + 1 * 24 * 60 * 60 * 1000); // Tuesday
    mockTx.ebookLoan.findMany.mockResolvedValue([
      { id: "l1", borrowedAt: past, returnedAt: past, expiresAt: past },
      { id: "l2", borrowedAt: past, returnedAt: past, expiresAt: past },
      { id: "l3", borrowedAt: past, returnedAt: past, expiresAt: past },
    ]);

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/minggu ini/i);
    expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
    expect(mockTx.ebookLoan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          borrowedAt: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
        }),
      })
    );
  });

  it("allows borrowing again after calendar week resets (next Monday)", async () => {
    // Use a fixed date in the NEXT calendar week (after the current week ends)
    const fixedNextMonday = new Date("2026-10-26T00:00:00.000Z"); // Monday 00:00 WIB = 2026-10-25 17:00 UTC
    
    // Loans from PREVIOUS week (should not count towards quota)
    // These should NOT be returned by findMany because the query filters by week range
    mockTx.ebookLoan.findMany.mockResolvedValue([]);

    // Use a fixed time in the next week for the request
    const originalDateNow = Date.now;
    (global.Date as any).now = () => new Date("2026-10-26T00:00:00.000Z").getTime();

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    (global.Date as any).now = originalDateNow;
    expect(res.status).toBe(201);
    expect(mockTx.ebookLoan.create).toHaveBeenCalled();
  });

  it("counts a loan at Sunday 23:59 WIB in the current week, and Monday 00:00 WIB in the next week", async () => {
    const { start: weekStart } = getCalendarWeekRange(new Date());
    const sunday2359 = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000 + 59 * 1000); // Sunday 23:59:59 WIB
    mockTx.ebookLoan.findMany.mockResolvedValue([
      { id: "l1", borrowedAt: sunday2359, returnedAt: null, expiresAt: new Date(sunday2359.getTime() + 5 * 24 * 60 * 60 * 1000) },
      { id: "l2", borrowedAt: sunday2359, returnedAt: null, expiresAt: new Date(sunday2359.getTime() + 5 * 24 * 60 * 60 * 1000) },
      { id: "l3", borrowedAt: sunday2359, returnedAt: null, expiresAt: new Date(sunday2359.getTime() + 5 * 24 * 60 * 60 * 1000) },
    ]);

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/minggu ini/i);

    // Now test Monday 00:00 WIB (next week)
    mockTx.ebookLoan.findMany.mockResolvedValue([
      { id: "l1", borrowedAt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000), returnedAt: null, expiresAt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 + 5 * 24 * 60 * 60 * 1000) },
      { id: "l2", borrowedAt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000), returnedAt: null, expiresAt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 + 5 * 24 * 60 * 60 * 1000) },
      { id: "l3", borrowedAt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000), returnedAt: null, expiresAt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 + 5 * 24 * 60 * 60 * 1000) },
    ]);

    const res2 = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));
    expect(res2.status).toBe(400); // Still blocked because 3 active loans in the NEW week
  });

  it("separate accounts have independent quotas", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role: "STUDENT" } });
    mockTx.ebookLoan.findMany.mockResolvedValue([
      { id: "l1", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
      { id: "l2", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
      { id: "l3", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
    ]);

    const res1 = await borrowEbook(borrowRequest({ bookId: "book-1" }));
    expect(res1.status).toBe(400);

    // Different user
    mockGetServerSession.mockResolvedValue({ user: { id: "user-2", role: "STUDENT" } });
    mockTx.user.findUnique.mockResolvedValue({ id: "user-2", name: "Siswa Dua", role: "STUDENT", isActive: true });
    mockTx.ebookLoan.findMany.mockResolvedValue([]);

    const res2 = await borrowEbook(borrowRequest({ bookId: "book-2" }));
    expect(res2.status).toBe(201);
  });

  it("does not count failed/non-existent transactions toward quota", async () => {
    mockTx.ebookLoan.findMany.mockResolvedValue([]);
    
    // First loan succeeds
    const res1 = await borrowEbook(borrowRequest({ bookId: "book-1" }));
    expect(res1.status).toBe(201);

    // Second loan (different book) succeeds
    mockTx.ebookLoan.findMany.mockResolvedValueOnce([
      { id: "loan-1", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }
    ]);
    const res2 = await borrowEbook(borrowRequest({ bookId: "book-2" }));
    expect(res2.status).toBe(201);

    // Third loan succeeds
    mockTx.ebookLoan.findMany.mockResolvedValueOnce([
      { id: "loan-1", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
      { id: "loan-2", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }
    ]);
    const res3 = await borrowEbook(borrowRequest({ bookId: "book-3" }));
    expect(res3.status).toBe(201);

    // Fourth should be blocked
    mockTx.ebookLoan.findMany.mockResolvedValueOnce([
      { id: "loan-1", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
      { id: "loan-2", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
      { id: "loan-3", borrowedAt: new Date(), returnedAt: null, expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }
    ]);
    const res4 = await borrowEbook(borrowRequest({ bookId: "book-4" }));
    expect(res4.status).toBe(400);
  });

  it("rejects a physical book", async () => {
    mockTx.book.findUnique.mockResolvedValue({
      id: BOOK_ID,
      title: "Buku Fisik",
      format: "PHYSICAL",
      filePath: null,
    });

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(400);
    expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
  });

  it("rejects an ebook with no readable file", async () => {
    mockTx.book.findUnique.mockResolvedValue({
      id: BOOK_ID,
      title: "Ebook Kosong",
      format: "EBOOK",
      filePath: null,
    });

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(400);
  });

  it("rejects an unknown ebook", async () => {
    mockTx.book.findUnique.mockResolvedValue(null);

    const res = await borrowEbook(borrowRequest({ bookId: "missing" }));

    expect(res.status).toBe(400);
  });

  it("rejects a deactivated account", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      id: USER_ID,
      name: "Nonaktif",
      role: "STUDENT",
      isActive: false,
    });

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(400);
    expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
  });

  it("writes an audit log entry", async () => {
    await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "BORROW_EBOOK" }) })
    );
  });
});

describe("Role-restricted borrowing", () => {
  it.each(["ADMIN", "LIBRARIAN", "STAFF"])(
    "rejects a %s session with 403 before touching the database",
    async (role) => {
      mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role } });

      const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

      expect(res.status).toBe(403);
      expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
      expect(mockTx.book.findUnique).not.toHaveBeenCalled();
    }
  );

  it.each(["STUDENT", "TEACHER"])("allows a %s session to borrow", async (role) => {
    mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role } });

    const res = await borrowEbook(borrowRequest({ bookId: BOOK_ID }));

    expect(res.status).toBe(201);
    expect(mockTx.ebookLoan.create).toHaveBeenCalled();
  });

  it("ignores a caller-supplied role and uses the session role", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: USER_ID, role: "ADMIN" } });

    const res = await borrowEbook(
      borrowRequest({ bookId: BOOK_ID, role: "STUDENT" })
    );

    expect(res.status).toBe(403);
    expect(mockTx.ebookLoan.create).not.toHaveBeenCalled();
  });
});

describe("Returning an ebook", () => {
  it("requires an authenticated session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await returnEbook(returnRequest({ loanId: "loan-1" }));

    expect(res.status).toBe(401);
  });

  it("closes the loan and marks it RETURNED when returned early", async () => {
    (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue({
      id: "loan-1",
      userId: USER_ID,
      bookId: BOOK_ID,
      expiresAt: new Date(Date.now() + MS_PER_DAY),
      returnedAt: null,
      book: { id: BOOK_ID, title: "Ebook Uji" },
    });
    (prisma.ebookLoan.update as jest.Mock).mockResolvedValue({ id: "loan-1" });

    const res = await returnEbook(returnRequest({ loanId: "loan-1" }));

    expect(res.status).toBe(200);
    expect((await res.json()).accessState).toBe("RETURNED");
    expect(prisma.ebookLoan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RETURNED" }) })
    );
  });

  it("marks the loan EXPIRED when returned after the deadline", async () => {
    (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue({
      id: "loan-1",
      userId: USER_ID,
      bookId: BOOK_ID,
      expiresAt: new Date(Date.now() - 1000),
      returnedAt: null,
      book: { id: BOOK_ID, title: "Ebook Uji" },
    });
    (prisma.ebookLoan.update as jest.Mock).mockResolvedValue({ id: "loan-1" });

    const res = await returnEbook(returnRequest({ loanId: "loan-1" }));

    expect(res.status).toBe(200);
    expect((await res.json()).accessState).toBe("EXPIRED");
  });

  it("scopes the lookup to the session user so another loan cannot be closed", async () => {
    (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue({
      id: "loan-1",
      userId: USER_ID,
      bookId: BOOK_ID,
      expiresAt: new Date(Date.now() + MS_PER_DAY),
      returnedAt: null,
      book: { id: BOOK_ID, title: "Ebook Uji" },
    });
    (prisma.ebookLoan.update as jest.Mock).mockResolvedValue({ id: "loan-1" });

    await returnEbook(returnRequest({ loanId: "loan-1" }));

    expect(prisma.ebookLoan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "loan-1", userId: USER_ID }),
      })
    );
  });

  it("returns 404 when the loan belongs to somebody else", async () => {
    // Scoped lookup finds nothing for the session user.
    (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await returnEbook(returnRequest({ loanId: "someone-elses-loan" }));

    expect(res.status).toBe(404);
    expect(prisma.ebookLoan.update).not.toHaveBeenCalled();
  });

  it("rejects returning the same loan twice", async () => {
    (prisma.ebookLoan.findFirst as jest.Mock).mockResolvedValue({
      id: "loan-1",
      userId: USER_ID,
      bookId: BOOK_ID,
      expiresAt: new Date(Date.now() + MS_PER_DAY),
      returnedAt: new Date(),
      book: { id: BOOK_ID, title: "Ebook Uji" },
    });

    const res = await returnEbook(returnRequest({ loanId: "loan-1" }));

    expect(res.status).toBe(400);
    expect(prisma.ebookLoan.update).not.toHaveBeenCalled();
  });

  it("requires either a loanId or a bookId", async () => {
    const res = await returnEbook(returnRequest({}));

    expect(res.status).toBe(400);
  });
});