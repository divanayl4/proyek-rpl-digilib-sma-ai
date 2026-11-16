/**
 * Route-level tests for the book catalog API with the new SMK dimensions
 * (kelas / mata pelajaran / jurusan) and ebook file handling.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    category: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET as getBooks, POST as postBook } from "@/app/api/books/route";
import { GET as getBook, PATCH as patchBook } from "@/app/api/books/[id]/route";
import { GET as getFilters } from "@/app/api/books/filters/route";

const ADMIN = { user: { id: "admin-1", role: "ADMIN" } };
const STUDENT = { user: { id: "stu-1", role: "STUDENT" } };

function bookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "book-1",
    title: "Matematika Kelas X",
    author: "Tim Penyusun",
    isbn: null,
    publisher: null,
    year: null,
    stock: 3,
    filePath: null,
    coverUrl: null,
    description: null,
    categoryId: null,
    format: "PHYSICAL",
    grade: "X",
    subject: "Matematika",
    major: null,
    pageCount: null,
    createdAt: new Date(),
    category: null,
    _count: { borrows: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue(ADMIN);
});

describe("GET /api/books", () => {
  it("filters by grade, subject and major and never leaks filePath", async () => {
    (prisma.book.findMany as jest.Mock).mockResolvedValue([
      bookRow({ filePath: "ebook-1.pdf", format: "EBOOK" }),
    ]);
    (prisma.book.count as jest.Mock).mockResolvedValue(1);

    const req = new NextRequest(
      "http://localhost:3000/api/books?grade=X&subject=Matematika&major=Rekayasa%20Perangkat%20Lunak"
    );
    const res = await getBooks(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.book.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          grade: "X",
          subject: "Matematika",
          major: "Rekayasa Perangkat Lunak",
        }),
      })
    );
    expect(body.books[0]).not.toHaveProperty("filePath");
    expect(body.books[0].hasEbookFile).toBe(true);
  });

  it("searches across subject and major too", async () => {
    (prisma.book.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.book.count as jest.Mock).mockResolvedValue(0);

    await getBooks(new NextRequest("http://localhost:3000/api/books?search=Jaringan"));

    const where = (prisma.book.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { subject: { contains: "Jaringan" } },
        { major: { contains: "Jaringan" } },
      ])
    );
  });

  it("applies the availability filter to computed stock", async () => {
    (prisma.book.findMany as jest.Mock).mockResolvedValue([
      bookRow({ id: "b1", stock: 3, _count: { borrows: 1 } }),
      bookRow({ id: "b2", stock: 1, _count: { borrows: 1 } }),
    ]);
    (prisma.book.count as jest.Mock).mockResolvedValue(2);

    const res = await getBooks(
      new NextRequest("http://localhost:3000/api/books?availability=available")
    );
    const body = await res.json();

    expect(body.books).toHaveLength(1);
    expect(body.books[0].id).toBe("b1");
  });

  describe("Pagination validation", () => {
    beforeEach(() => {
      (prisma.book.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.book.count as jest.Mock).mockResolvedValue(0);
    });

    it("uses default page=1 and pageSize=12 when omitted", async () => {
      const res = await getBooks(new NextRequest("http://localhost:3000/api/books"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.page).toBe(1);
      expect(prisma.book.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 12 })
      );
    });

    it("handles valid page=2 and calculates skip=12", async () => {
      const res = await getBooks(new NextRequest("http://localhost:3000/api/books?page=2"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.page).toBe(2);
      expect(prisma.book.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 12, take: 12 })
      );
    });

    it("falls back to page=1 for non-numeric, zero, or negative page", async () => {
      for (const p of ["abc", "0", "-1", "-10"]) {
        const res = await getBooks(new NextRequest(`http://localhost:3000/api/books?page=${p}`));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.page).toBe(1);
        expect(prisma.book.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 12 })
        );
      }
    });

    it("falls back to default pageSize=12 for non-numeric, zero, or negative pageSize", async () => {
      for (const s of ["abc", "0", "-10"]) {
        const res = await getBooks(new NextRequest(`http://localhost:3000/api/books?pageSize=${s}`));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(prisma.book.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 12 })
        );
      }
    });

    it("caps pageSize to maximum 50 when an excessively large value is requested", async () => {
      const res = await getBooks(new NextRequest("http://localhost:3000/api/books?pageSize=100000"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(prisma.book.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 })
      );
    });

    it("handles large page number and total data = 0 without NaN or errors", async () => {
      const res = await getBooks(new NextRequest("http://localhost:3000/api/books?page=999999"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.page).toBe(999999);
      expect(body.total).toBe(0);
      expect(body.totalPages).toBe(0);
      expect(body.books).toEqual([]);
      expect(prisma.book.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: (999999 - 1) * 12, take: 12 })
      );
    });
  });
});

describe("POST /api/books", () => {
  const payload = {
    title: "Dasar Pemrograman",
    author: "RPL Team",
    grade: "X",
    subject: "Pemrograman Dasar",
    major: "Rekayasa Perangkat Lunak",
    format: "EBOOK",
    filePath: "ebook-123.pdf",
    stock: 0,
  };

  it("rejects a non-privileged user with 403", async () => {
    mockGetServerSession.mockResolvedValue(STUDENT);
    const res = await postBook(
      new NextRequest("http://localhost:3000/api/books", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
    expect(res.status).toBe(403);
  });

  it("rejects an invalid grade", async () => {
    const res = await postBook(
      new NextRequest("http://localhost:3000/api/books", {
        method: "POST",
        body: JSON.stringify({ ...payload, grade: "XIII" }),
      })
    );
    expect(res.status).toBe(400);
    expect(prisma.book.create).not.toHaveBeenCalled();
  });

  it("creates an ebook with all SMK dimensions", async () => {
    (prisma.book.create as jest.Mock).mockImplementation(({ data }) => ({
      id: "new-1",
      ...data,
      category: null,
    }));
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    const res = await postBook(
      new NextRequest("http://localhost:3000/api/books", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(prisma.book.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grade: "X",
          subject: "Pemrograman Dasar",
          major: "Rekayasa Perangkat Lunak",
          format: "EBOOK",
          filePath: "ebook-123.pdf",
        }),
      })
    );
    expect(body.hasEbookFile).toBe(true);
    expect(body).not.toHaveProperty("filePath");
  });

  it("forces filePath to null for a physical book", async () => {
    (prisma.book.create as jest.Mock).mockImplementation(({ data }) => ({
      id: "new-2",
      ...data,
      category: null,
    }));
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    await postBook(
      new NextRequest("http://localhost:3000/api/books", {
        method: "POST",
        body: JSON.stringify({ ...payload, format: "PHYSICAL" }),
      })
    );

    expect((prisma.book.create as jest.Mock).mock.calls[0][0].data.filePath).toBeNull();
  });
});

describe("GET /api/books/[id]", () => {
  it("returns 404 for an unknown book", async () => {
    (prisma.book.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await getBook(new NextRequest("http://localhost:3000/api/books/x"), {
      params: { id: "x" },
    });
    expect(res.status).toBe(404);
  });

  it("strips filePath and exposes hasEbookFile", async () => {
    (prisma.book.findUnique as jest.Mock).mockResolvedValue(
      bookRow({ format: "EBOOK", filePath: "ebook-9.pdf", _count: { borrows: 1 }, stock: 1 })
    );
    const res = await getBook(new NextRequest("http://localhost:3000/api/books/book-1"), {
      params: { id: "book-1" },
    });
    const body = await res.json();
    expect(body.book).not.toHaveProperty("filePath");
    expect(body.book.hasEbookFile).toBe(true);
    expect(body.book.available).toBe(0);
  });
});

describe("PATCH /api/books/[id]", () => {
  const physicalTarget = { id: "book-1", format: "PHYSICAL", filePath: null };

  it("rejects a non-privileged user with 403", async () => {
    mockGetServerSession.mockResolvedValue(STUDENT);
    const res = await patchBook(
      new NextRequest("http://localhost:3000/api/books/book-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "X" }),
      }),
      { params: { id: "book-1" } }
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown book", async () => {
    (prisma.book.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await patchBook(
      new NextRequest("http://localhost:3000/api/books/x", {
        method: "PATCH",
        body: JSON.stringify({ title: "X" }),
      }),
      { params: { id: "x" } }
    );
    expect(res.status).toBe(404);
  });

  it("detaches the file when switching an ebook back to physical", async () => {
    (prisma.book.findUnique as jest.Mock).mockResolvedValue({ id: "book-1", format: "EBOOK", filePath: "a.pdf" });
    (prisma.book.update as jest.Mock).mockImplementation(({ data }) => ({
      id: "book-1",
      ...data,
      category: null,
    }));
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    await patchBook(
      new NextRequest("http://localhost:3000/api/books/book-1", {
        method: "PATCH",
        body: JSON.stringify({ format: "PHYSICAL" }),
      }),
      { params: { id: "book-1" } }
    );

    expect((prisma.book.update as jest.Mock).mock.calls[0][0].data.filePath).toBeNull();
  });

  it("keeps the stored file on a plain edit (filePath omitted)", async () => {
    (prisma.book.findUnique as jest.Mock).mockResolvedValue({ id: "book-1", format: "EBOOK", filePath: "a.pdf" });
    (prisma.book.update as jest.Mock).mockImplementation(({ data }) => ({
      id: "book-1",
      ...data,
      category: null,
    }));
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    await patchBook(
      new NextRequest("http://localhost:3000/api/books/book-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Judul Baru" }),
      }),
      { params: { id: "book-1" } }
    );

    expect((prisma.book.update as jest.Mock).mock.calls[0][0].data.filePath).toBeUndefined();
  });

  it("rejects an invalid grade", async () => {
    (prisma.book.findUnique as jest.Mock).mockResolvedValue(physicalTarget);
    const res = await patchBook(
      new NextRequest("http://localhost:3000/api/books/book-1", {
        method: "PATCH",
        body: JSON.stringify({ grade: "XX" }),
      }),
      { params: { id: "book-1" } }
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/books/filters", () => {
  it("returns DB-derived options with grades ordered X, XI, XII", async () => {
    (prisma.book.findMany as jest.Mock)
      .mockResolvedValueOnce([{ grade: "XII" }, { grade: "X" }, { grade: "XI" }])
      .mockResolvedValueOnce([{ subject: "Matematika" }, { subject: "Bahasa Indonesia" }])
      .mockResolvedValueOnce([{ major: "Pemasaran" }]);
    (prisma.category.findMany as jest.Mock).mockResolvedValue([{ id: "c1", name: "Umum" }]);

    const res = await getFilters();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.grades).toEqual(["X", "XI", "XII"]);
    expect(body.subjects).toEqual(["Bahasa Indonesia", "Matematika"]);
    expect(body.majors).toEqual(["Pemasaran"]);
    expect(body.categories).toEqual([{ id: "c1", name: "Umum" }]);
  });
});