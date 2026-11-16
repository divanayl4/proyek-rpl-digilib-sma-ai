/**
 * Catalog access-state tests for GET /api/ebooks.
 *
 * The catalog exposes an *effective* access state derived from the verified
 * server session. Admin/Pustakawan always read via the operator path, so they
 * must never receive a lock state from a missing (or historical) loan. Siswa,
 * Guru and Staf keep the previous loan-based rules.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

const mockBookFindMany = jest.fn();
const mockBookCount = jest.fn();
const mockLoanFindMany = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: {
      findMany: (...args: unknown[]) => mockBookFindMany(...args),
      count: (...args: unknown[]) => mockBookCount(...args),
    },
    ebookLoan: {
      findMany: (...args: unknown[]) => mockLoanFindMany(...args),
    },
  },
}));

jest.mock("@/lib/notifications", () => ({
  notifyEbookBorrowed: jest.fn(),
}));

import { GET as getEbooks } from "@/app/api/ebooks/route";

const BOOK_ID = "book-1";
const MS_PER_DAY = 24 * 3600 * 1000;

function signInAs(role: string) {
  mockGetServerSession.mockResolvedValue({ user: { id: "user-1", role } });
}

function catalogRequest() {
  return new NextRequest("http://localhost:3000/api/ebooks");
}

function mockCatalog(loans: unknown[] = []) {
  mockBookFindMany.mockResolvedValue([
    {
      id: BOOK_ID,
      title: "Ebook Uji",
      author: "Penulis",
      isbn: null,
      publisher: null,
      year: null,
      coverUrl: null,
      description: null,
      pageCount: 10,
      grade: null,
      subject: null,
      major: null,
      categoryId: null,
      createdAt: new Date(),
      category: null,
    },
  ]);
  mockBookCount.mockResolvedValue(1);
  mockLoanFindMany.mockResolvedValue(loans);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/ebooks – manager catalog state", () => {
  it.each(["ADMIN", "LIBRARIAN"])(
    "%s receives an active, lock-free state without any loan",
    async (role) => {
      signInAs(role);
      mockCatalog([]);

      const res = await getEbooks(catalogRequest());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ebooks[0].accessState).toBe("ACTIVE");
      expect(body.ebooks[0].operator).toBe(true);
      expect(body.ebooks[0].loan).toBeNull();
    }
  );

  it.each(["ADMIN", "LIBRARIAN"])(
    "%s stays unlocked even with a historical expired loan",
    async (role) => {
      signInAs(role);
      mockCatalog([
        {
          id: "old-loan",
          bookId: BOOK_ID,
          borrowedAt: new Date(Date.now() - 10 * MS_PER_DAY),
          expiresAt: new Date(Date.now() - 5 * MS_PER_DAY),
          returnedAt: null,
          status: "EXPIRED",
        },
      ]);

      const res = await getEbooks(catalogRequest());
      const body = await res.json();

      expect(body.ebooks[0].accessState).toBe("ACTIVE");
      expect(body.ebooks[0].operator).toBe(true);
    }
  );
});

describe("GET /api/ebooks – borrower rules preserved", () => {
  it.each(["STUDENT", "TEACHER"])(
    "%s without a loan still sees NOT_BORROWED",
    async (role) => {
      signInAs(role);
      mockCatalog([]);

      const res = await getEbooks(catalogRequest());
      const body = await res.json();

      expect(body.ebooks[0].accessState).toBe("NOT_BORROWED");
      expect(body.ebooks[0].operator).toBe(false);
      expect(body.ebooks[0].canBorrow).toBe(true);
    }
  );

  it("a student with an active loan still sees ACTIVE", async () => {
    signInAs("STUDENT");
    mockCatalog([
      {
        id: "loan-1",
        bookId: BOOK_ID,
        borrowedAt: new Date(Date.now() - MS_PER_DAY),
        expiresAt: new Date(Date.now() + 4 * MS_PER_DAY),
        returnedAt: null,
        status: "ACTIVE",
      },
    ]);

    const res = await getEbooks(catalogRequest());
    const body = await res.json();

    expect(body.ebooks[0].accessState).toBe("ACTIVE");
    expect(body.ebooks[0].operator).toBe(false);
  });

  it("a student with an expired loan still sees EXPIRED (lock kept)", async () => {
    signInAs("STUDENT");
    mockCatalog([
      {
        id: "loan-1",
        bookId: BOOK_ID,
        borrowedAt: new Date(Date.now() - 10 * MS_PER_DAY),
        expiresAt: new Date(Date.now() - MS_PER_DAY),
        returnedAt: null,
        status: "EXPIRED",
      },
    ]);

    const res = await getEbooks(catalogRequest());
    const body = await res.json();

    expect(body.ebooks[0].accessState).toBe("EXPIRED");
    expect(body.ebooks[0].operator).toBe(false);
  });

  it("STAFF keeps the previous no-borrow/no-read rule", async () => {
    signInAs("STAFF");
    mockCatalog([]);

    const res = await getEbooks(catalogRequest());
    const body = await res.json();

    expect(body.ebooks[0].accessState).toBe("NOT_BORROWED");
    expect(body.ebooks[0].operator).toBe(false);
    expect(body.ebooks[0].canBorrow).toBe(false);
  });

  describe("Pagination validation for GET /api/ebooks", () => {
    beforeEach(() => {
      signInAs("STUDENT");
      mockCatalog([]);
      mockBookCount.mockResolvedValue(0);
    });

    it("uses default page=1 and pageSize=12 when parameters are omitted", async () => {
      const res = await getEbooks(new NextRequest("http://localhost:3000/api/ebooks"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.page).toBe(1);
      expect(mockBookFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 12 })
      );
    });

    it("handles valid page=2 and calculates skip=12", async () => {
      const res = await getEbooks(new NextRequest("http://localhost:3000/api/ebooks?page=2"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.page).toBe(2);
      expect(mockBookFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 12, take: 12 })
      );
    });

    it("falls back to page=1 for non-numeric, zero, or negative page", async () => {
      for (const p of ["abc", "0", "-1", "-25"]) {
        const res = await getEbooks(new NextRequest(`http://localhost:3000/api/ebooks?page=${p}`));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.page).toBe(1);
        expect(mockBookFindMany).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 12 })
        );
      }
    });

    it("falls back to default pageSize=12 for non-numeric, zero, or negative pageSize", async () => {
      for (const s of ["abc", "0", "-10"]) {
        const res = await getEbooks(new NextRequest(`http://localhost:3000/api/ebooks?pageSize=${s}`));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(mockBookFindMany).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 12 })
        );
      }
    });

    it("caps pageSize to maximum 50 when an excessively large value is requested", async () => {
      const res = await getEbooks(new NextRequest("http://localhost:3000/api/ebooks?pageSize=100000"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(mockBookFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 })
      );
    });

    it("handles large page number and total data = 0 without NaN or errors", async () => {
      const res = await getEbooks(new NextRequest("http://localhost:3000/api/ebooks?page=999999"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.page).toBe(999999);
      expect(body.total).toBe(0);
      expect(body.totalPages).toBe(0);
      expect(mockBookFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: (999999 - 1) * 12, take: 12 })
      );
    });
  });
});
