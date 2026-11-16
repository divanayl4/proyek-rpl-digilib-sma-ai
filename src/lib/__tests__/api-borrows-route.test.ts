/**
 * Route-level tests for GET /api/borrows.
 *
 * Mengunci perilaku status ganda: baris yang masih tersimpan sebagai BORROWED
 * namun sudah lewat jatuh tempo harus diperlakukan sama seperti baris OVERDUE
 * yang sudah dipersist.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    borrowRecord: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
    ebookLoan: { findMany: jest.fn(), count: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    book: { findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/notifications", () => ({
  notifyBorrowSuccess: jest.fn(),
  notifyReturnSuccess: jest.fn(),
  sendInAppNotification: jest.fn(),
  notifyLibrarians: jest.fn(),
  processOverdueNotifications: jest.fn(),
  processUpcomingDueNotifications: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { GET as getBorrows } from "@/app/api/borrows/route";

const PAST = new Date(Date.now() - 3 * 86400000);

beforeEach(() => {
  jest.resetAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "adm-1", role: "ADMIN" } });
  (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
  (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);
  (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.ebookLoan.count as jest.Mock).mockResolvedValue(0);
});

describe("GET /api/borrows", () => {
  it("includes persisted OVERDUE rows in the OVERDUE filter", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);

    const res = await getBorrows(
      new NextRequest("http://localhost:3000/api/borrows?status=OVERDUE")
    );

    expect(res.status).toBe(200);
    const where = (prisma.borrowRecord.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["BORROWED", "OVERDUE"] });
    expect(where.dueDate).toEqual({ lt: expect.any(Date) });
  });

  it("computes the summary so overdue is not double-counted as borrowed", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([
      {
        id: "b1",
        status: "BORROWED",
        dueDate: PAST,
        borrowDate: PAST,
        user: { id: "u1", name: "A", email: "a@x.id", role: "STUDENT", class: "X", identityNumber: null },
        book: { id: "bk1", title: "Buku", author: "P", isbn: null, coverUrl: null },
        createdBy: null,
      },
      {
        id: "b2",
        status: "OVERDUE",
        dueDate: PAST,
        borrowDate: PAST,
        user: { id: "u2", name: "B", email: "b@x.id", role: "STUDENT", class: "X", identityNumber: null },
        book: { id: "bk2", title: "Buku 2", author: "P", isbn: null, coverUrl: null },
        createdBy: null,
      },
    ]);
    (prisma.borrowRecord.count as jest.Mock)
      .mockResolvedValueOnce(12) // total
      .mockResolvedValueOnce(2); // overdueCount
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([
      { status: "BORROWED", _count: { _all: 1 } },
      { status: "OVERDUE", _count: { _all: 1 } },
      { status: "RETURNED", _count: { _all: 5 } },
      { status: "CANCELLED", _count: { _all: 1 } },
    ]);

    const res = await getBorrows(new NextRequest("http://localhost:3000/api/borrows"));
    const body = await res.json();

    expect(body.summary.borrowed).toBe(0); // (1 + 1) active - 2 overdue
    expect(body.summary.physicalActive).toBe(2);
    expect(body.summary.overdue).toBe(2);
    expect(body.summary.returned).toBe(5);
    expect(body.borrows[0].effectiveStatus).toBe("OVERDUE");
  });

  it("uses separate physical/ebook sources for the all-tab summary", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.borrowRecord.count as jest.Mock)
      .mockResolvedValueOnce(7) // physical total
      .mockResolvedValueOnce(1); // physical overdue
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([
      { status: "BORROWED", _count: { _all: 2 } },
      { status: "OVERDUE", _count: { _all: 1 } },
      { status: "RETURNED", _count: { _all: 4 } },
    ]);
    (prisma.ebookLoan.count as jest.Mock)
      .mockResolvedValueOnce(3) // total
      .mockResolvedValueOnce(2) // active
      .mockResolvedValueOnce(1) // expired
      .mockResolvedValueOnce(0); // returned
    (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([]);

    const res = await getBorrows(new NextRequest("http://localhost:3000/api/borrows"));
    const body = await res.json();

    expect(body.total).toBe(10);
    expect(body.summary.total).toBe(10);
    expect(body.summary.physicalTotal).toBe(7);
    expect(body.summary.ebookTotal).toBe(3);
    expect(body.summary.physicalActive).toBe(3);
    expect(body.summary.borrowed).toBe(2);
    expect(body.summary.overdue).toBe(1);
    expect(body.summary.ebookActive).toBe(2);
    expect(body.summary.ebookExpired).toBe(1);
  });

  it("treats BORROWED as the on-time active filter", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);

    await getBorrows(
      new NextRequest("http://localhost:3000/api/borrows?status=BORROWED")
    );

    const where = (prisma.borrowRecord.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBe("BORROWED");
    expect(where.dueDate).toEqual({ gte: expect.any(Date) });

    const overdueWhere = (prisma.borrowRecord.count as jest.Mock).mock.calls[1][0]
      .where;
    expect(overdueWhere).toEqual({
      AND: [
        where,
        {
          status: { in: ["BORROWED", "OVERDUE"] },
          dueDate: { lt: expect.any(Date) },
        },
      ],
    });
  });

  it("returns 401 when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getBorrows(new NextRequest("http://localhost:3000/api/borrows"));
    expect(res.status).toBe(401);
  });

  it("merges active ebook loans for staff with unique ids and itemType", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.ebookLoan.count as jest.Mock)
      .mockResolvedValueOnce(2) // total
      .mockResolvedValueOnce(1) // active
      .mockResolvedValueOnce(1) // expired
      .mockResolvedValueOnce(0); // returned
    (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([
      {
        id: "el-1",
        borrowedAt: PAST,
        expiresAt: new Date(Date.now() + 3 * 86400000),
        returnedAt: null,
        user: { id: "u1", name: "Siswa", email: "s@x.id", role: "STUDENT", class: "X", identityNumber: null },
        book: {
          id: "eb1",
          title: "Ebook Aktif",
          author: "P",
          isbn: null,
          coverUrl: null,
          archivedAt: null,
        },
      },
      {
        id: "el-2",
        borrowedAt: new Date(PAST.getTime() - 86400000),
        expiresAt: new Date(Date.now() - 86400000),
        returnedAt: null,
        user: { id: "u2", name: "Guru", email: "g@x.id", role: "TEACHER", class: null, identityNumber: null },
        book: {
          id: "eb2",
          title: "Ebook Berakhir",
          author: "P",
          isbn: null,
          coverUrl: null,
          archivedAt: null,
        },
      },
    ]);

    const res = await getBorrows(new NextRequest("http://localhost:3000/api/borrows"));
    const body = await res.json();

    expect(body.total).toBe(2);
    expect(body.borrows[0].id).toBe("ebook:el-1");
    expect(body.borrows[0].itemType).toBe("ebook");
    expect(body.borrows[0].effectiveStatus).toBe("BORROWED");
    expect(body.borrows[1].id).toBe("ebook:el-2");
    expect(body.borrows[1].effectiveStatus).toBe("EXPIRED");
    // Status aktif diturunkan dari timestamp, bukan kolom status yang lazy.
    expect(body.summary.ebookTotal).toBe(2);
    expect(body.summary.ebookActive).toBe(1);
    expect(body.summary.ebookExpired).toBe(1);
    expect(body.borrows[0].book.isArchived).toBe(false);
  });

  it("keeps returned ebook timestamps and archive state", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.ebookLoan.count as jest.Mock)
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(0) // active
      .mockResolvedValueOnce(0) // expired
      .mockResolvedValueOnce(1); // returned
    (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([
      {
        id: "el-returned",
        borrowedAt: PAST,
        expiresAt: new Date(Date.now() + 86400000),
        returnedAt: new Date(PAST.getTime() + 3600000),
        user: {
          id: "u1",
          name: "Siswa",
          email: "s@x.id",
          role: "STUDENT",
          class: "XI IPA 1",
          identityNumber: "123",
        },
        book: {
          id: "eb1",
          title: "Ebook Lama",
          author: "P",
          isbn: null,
          coverUrl: null,
          archivedAt: PAST,
        },
      },
    ]);

    const res = await getBorrows(
      new NextRequest("http://localhost:3000/api/borrows?type=ebook")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.borrows[0].borrowDate).toBe(PAST.toISOString());
    expect(body.borrows[0].returnDate).toBe(
      new Date(PAST.getTime() + 3600000).toISOString()
    );
    expect(body.borrows[0].effectiveStatus).toBe("RETURNED");
    expect(body.borrows[0].book.isArchived).toBe(true);
    expect(body.summary.ebookReturned).toBe(1);
    expect(body.summary.physicalTotal).toBe(0);
  });

  it("supports the ebook-only category without physical rows", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.ebookLoan.count as jest.Mock)
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(1) // active
      .mockResolvedValueOnce(0) // expired
      .mockResolvedValueOnce(0); // returned
    (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([
      {
        id: "el-only",
        borrowedAt: PAST,
        expiresAt: new Date(Date.now() + 86400000),
        returnedAt: null,
        user: {
          id: "u1",
          name: "Siswa",
          email: "s@x.id",
          role: "STUDENT",
          class: "X",
          identityNumber: null,
        },
        book: {
          id: "eb1",
          title: "Ebook Saja",
          author: "P",
          isbn: null,
          coverUrl: null,
          archivedAt: null,
        },
      },
    ]);

    const res = await getBorrows(
      new NextRequest("http://localhost:3000/api/borrows?type=ebook")
    );
    const body = await res.json();

    const physicalWhere = (prisma.borrowRecord.findMany as jest.Mock).mock.calls[0][0]
      .where;
    expect(physicalWhere.id).toEqual({ in: [] });
    expect(body.borrows).toHaveLength(1);
    expect(body.borrows[0].itemType).toBe("ebook");
    expect(body.summary.total).toBe(1);
    expect(body.summary.physicalTotal).toBe(0);
    expect(body.summary.ebookTotal).toBe(1);
  });

  it("supports the physical-book-only category without ebook rows", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([
      {
        id: "b1",
        status: "RETURNED",
        dueDate: PAST,
        borrowDate: PAST,
        returnDate: PAST,
        user: {
          id: "u1",
          name: "A",
          email: "a@x.id",
          role: "STUDENT",
          class: "X",
          identityNumber: null,
        },
        book: {
          id: "bk1",
          title: "Buku Fisik",
          author: "P",
          isbn: null,
          coverUrl: null,
        },
        createdBy: null,
      },
    ]);
    (prisma.borrowRecord.count as jest.Mock)
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(0); // overdue
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([
      { status: "RETURNED", _count: { _all: 1 } },
    ]);

    const res = await getBorrows(
      new NextRequest("http://localhost:3000/api/borrows?type=book")
    );
    const body = await res.json();

    expect(prisma.ebookLoan.findMany).not.toHaveBeenCalled();
    expect(body.borrows).toHaveLength(1);
    expect(body.borrows[0].itemType).toBe("book");
    expect(body.summary.physicalTotal).toBe(1);
    expect(body.summary.ebookTotal).toBe(0);
  });

  it("rejects an unknown transaction category", async () => {
    const res = await getBorrows(
      new NextRequest("http://localhost:3000/api/borrows?type=video")
    );

    expect(res.status).toBe(400);
    expect(prisma.borrowRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.ebookLoan.findMany).not.toHaveBeenCalled();
  });

  it("filters ebook loans by timestamp-derived status", async () => {
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([]);

    await getBorrows(
      new NextRequest("http://localhost:3000/api/borrows?status=BORROWED")
    );

    const where = (prisma.ebookLoan.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.returnedAt).toBeNull();
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it("scopes ebook history to the session user for non-librarians", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-1", role: "STUDENT" } });
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.ebookLoan.count as jest.Mock)
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(1) // active
      .mockResolvedValueOnce(0) // expired
      .mockResolvedValueOnce(0); // returned
    (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([
      {
        id: "el-own",
        borrowedAt: PAST,
        expiresAt: new Date(Date.now() + 86400000),
        returnedAt: null,
        user: {
          id: "stu-1",
          name: "Siswa",
          email: "s@x.id",
          role: "STUDENT",
          class: "X",
          identityNumber: null,
        },
        book: {
          id: "eb1",
          title: "Ebook Milik Sendiri",
          author: "P",
          isbn: null,
          coverUrl: null,
          archivedAt: null,
        },
      },
    ]);

    const res = await getBorrows(new NextRequest("http://localhost:3000/api/borrows"));
    const body = await res.json();

    const ebookWhere = (prisma.ebookLoan.findMany as jest.Mock).mock.calls[0][0].where;
    expect(ebookWhere.userId).toBe("stu-1");
    // Ebook ikut digabung sehingga baris fisik tidak dipaginasi di database.
    const physicalArgs = (prisma.borrowRecord.findMany as jest.Mock).mock.calls[0][0];
    expect(physicalArgs.skip).toBeUndefined();
    expect(physicalArgs.take).toBeUndefined();
    expect(body.borrows).toHaveLength(1);
    expect(body.borrows[0].id).toBe("ebook:el-own");
    expect(body.borrows[0].itemType).toBe("ebook");
    expect(body.summary.total).toBe(1);
    expect(body.summary.ebookTotal).toBe(1);
  });

  it("keeps type=book physical-only for non-librarians", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stu-1", role: "STUDENT" } });
    (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
    (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);

    const res = await getBorrows(
      new NextRequest("http://localhost:3000/api/borrows?type=book")
    );

    expect(res.status).toBe(200);
    expect(prisma.ebookLoan.findMany).not.toHaveBeenCalled();
    expect((prisma.borrowRecord.findMany as jest.Mock).mock.calls[0][0].where.userId).toBe(
      "stu-1"
    );
  });

  describe("Pagination validation for GET /api/borrows", () => {
    beforeEach(() => {
      (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
      (prisma.borrowRecord.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.ebookLoan.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ebookLoan.count as jest.Mock).mockResolvedValue(0);
    });

    it("handles page and pageSize defaults when parameters are omitted", async () => {
      const res = await getBorrows(new NextRequest("http://localhost:3000/api/borrows"));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.page).toBe(1);
    });

    it("handles valid page number page=2", async () => {
      const res = await getBorrows(new NextRequest("http://localhost:3000/api/borrows?page=2"));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.page).toBe(2);
    });

    it("falls back to page=1 for non-numeric, zero, or negative page", async () => {
      const invalidPages = ["abc", "0", "-1", "-99"];
      for (const p of invalidPages) {
        const res = await getBorrows(new NextRequest(`http://localhost:3000/api/borrows?page=${p}`));
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.page).toBe(1);
      }
    });

    it("falls back to default pageSize=20 for non-numeric, zero, or negative pageSize", async () => {
      const invalidSizes = ["abc", "0", "-10"];
      for (const s of invalidSizes) {
        const res = await getBorrows(new NextRequest(`http://localhost:3000/api/borrows?pageSize=${s}`));
        const body = await res.json();
        expect(res.status).toBe(200);
        // Verify totalPages is computed using default 20 without NaN or negative
        expect(body.totalPages).toBe(0);
      }
    });

    it("caps pageSize to maximum 100 when a large value is requested", async () => {
      // With type=book, Prisma skip and take are populated
      await getBorrows(new NextRequest("http://localhost:3000/api/borrows?type=book&pageSize=100000"));
      const physicalArgs = (prisma.borrowRecord.findMany as jest.Mock).mock.calls[0][0];
      expect(physicalArgs.take).toBe(100);
    });

    it("calculates correct skip and take on Prisma when type=book", async () => {
      await getBorrows(new NextRequest("http://localhost:3000/api/borrows?type=book&page=3&pageSize=15"));
      const physicalArgs = (prisma.borrowRecord.findMany as jest.Mock).mock.calls[0][0];
      expect(physicalArgs.skip).toBe(30);
      expect(physicalArgs.take).toBe(15);
    });

    it("slices merged physical and ebook arrays properly across pages", async () => {
      const dummyBorrows = Array.from({ length: 25 }, (_, i) => ({
        id: `borrow-${i}`,
        bookId: `b-${i}`,
        userId: "adm-1",
        borrowDate: new Date(Date.now() - i * 60000),
        dueDate: new Date(Date.now() + 86400000),
        returnDate: null,
        status: "BORROWED",
        user: { id: "adm-1", name: "Admin", email: "admin@test.com", role: "ADMIN", class: null, identityNumber: null },
        book: { id: `b-${i}`, title: `Buku ${i}`, author: "Penulis", isbn: null, coverUrl: null },
        createdBy: null,
      }));
      (prisma.borrowRecord.findMany as jest.Mock).mockResolvedValue(dummyBorrows);

      // Page 1 with pageSize 20 -> 20 items
      const res1 = await getBorrows(new NextRequest("http://localhost:3000/api/borrows?page=1&pageSize=20"));
      const body1 = await res1.json();
      expect(body1.borrows).toHaveLength(20);
      expect(body1.page).toBe(1);

      // Page 2 with pageSize 20 -> remaining 5 items
      const res2 = await getBorrows(new NextRequest("http://localhost:3000/api/borrows?page=2&pageSize=20"));
      const body2 = await res2.json();
      expect(body2.borrows).toHaveLength(5);
      expect(body2.page).toBe(2);
    });

    it("handles large page number and total data = 0 gracefully without NaN", async () => {
      const res = await getBorrows(new NextRequest("http://localhost:3000/api/borrows?page=999999"));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.page).toBe(999999);
      expect(body.borrows).toEqual([]);
      expect(body.totalPages).toBe(0);
    });
  });
});
