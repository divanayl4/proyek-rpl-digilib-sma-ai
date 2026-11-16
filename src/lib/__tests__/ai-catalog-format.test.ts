/**
 * Regresi pemisahan katalog BUKU FISIK vs EBOOK.
 *
 * Tes ini tidak hanya menguji resolver intent. Prisma di-mock dengan mesin
 * filter `where` in-memory sederhana, sehingga `format` yang dikirim ke query
 * database benar-benar diuji: hasil fisik tidak boleh berisi ebook dan
 * sebaliknya.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    category: { count: jest.fn(), findMany: jest.fn() },
    borrowRecord: { count: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  buildCatalogAnswer,
  mergeCatalogQuery,
  searchCatalogBooks,
} from "@/lib/ai/catalog";
import {
  hasFormatCue,
  resolveCatalogFormat,
} from "@/lib/ai/catalogFormat";
import { detectIntent } from "@/lib/ai/intent";
import { executeTool } from "@/lib/ai/tools";

const mockFindMany = prisma.book.findMany as jest.Mock;
const mockFindFirst = prisma.book.findFirst as jest.Mock;
const mockBookCount = prisma.book.count as jest.Mock;
const mockAggregate = prisma.book.aggregate as jest.Mock;
const mockCategoryFindMany = prisma.category.findMany as jest.Mock;
const mockCategoryCount = prisma.category.count as jest.Mock;
const mockBorrowCount = prisma.borrowRecord.count as jest.Mock;
const mockSettingFindMany = (prisma as unknown as {
  setting?: { findMany: jest.Mock };
}).setting?.findMany;

type FixtureBook = {
  id: string;
  title: string;
  author: string;
  publisher: string | null;
  year: number | null;
  isbn: string | null;
  description: string;
  stock: number;
  grade: string | null;
  subject: string | null;
  major: string | null;
  format: "PHYSICAL" | "EBOOK";
  coverUrl: string | null;
  category: { name: string };
  _count: { borrows: number };
};

function row(
  id: string,
  title: string,
  format: "PHYSICAL" | "EBOOK",
  overrides: Partial<FixtureBook> = {}
): FixtureBook {
  return {
    id,
    title,
    author: `Penulis ${id}`,
    publisher: "Erlangga",
    year: 2024,
    isbn: `ISBN-${id}`,
    description: `Deskripsi ${title}`,
    stock: format === "EBOOK" ? 0 : 2,
    grade: "X",
    subject: title.split(" ")[0],
    major: null,
    format,
    coverUrl: null,
    category: { name: "Buku Pelajaran" },
    _count: { borrows: 0 },
    ...overrides,
  };
}

// Data uji terisolasi. Setiap judul khas agar hasil bisa dilacak ke formatnya.
const BOOKS: FixtureBook[] = [
  row("p-fisika", "Fisika Dasar Kelas X", "PHYSICAL", { stock: 3, _count: { borrows: 1 } }),
  row("p-sejarah", "Sejarah Indonesia", "PHYSICAL"),
  row("p-matematika", "Matematika Wajib Kelas X", "PHYSICAL"),
  row("p-kimia", "Kimia Terpadu", "PHYSICAL", { stock: 0, grade: "XI" }),
  row("p-biologi", "Biologi Molekuler", "PHYSICAL", { stock: 1 }),
  row("p-manajemen", "Manajemen Perpustakaan", "PHYSICAL", { stock: 1 }),
  row("e-fisika", "Fisika Digital", "EBOOK"),
  row("e-matematika", "Matematika Digital Kelas X", "EBOOK"),
  row("e-kimia", "Kimia Terpadu", "EBOOK", { grade: "XI" }),
  row("e-biologi", "Biologi Molekuler", "EBOOK"),
  row("e-algoritma", "Algoritma Digital", "EBOOK", { subject: "Informatika" }),
  row("e-geografi", "Geografi Digital", "EBOOK", { subject: "Geografi" }),
];

function contains(value: unknown, needle: unknown): boolean {
  // Prisma `contains` pada MySQL bersifat case-insensitive.
  return String(value ?? "")
    .toLowerCase()
    .includes(String(needle ?? "").toLowerCase());
}

/** Mesin filter `where` minimal untuk field yang dipakai query katalog. */
function matchesWhere(book: FixtureBook, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === "archivedAt") return value === null; // semua fixture aktif
    if (key === "AND") {
      return (value as Record<string, unknown>[]).every((part) => matchesWhere(book, part));
    }
    if (key === "OR") {
      return (value as Record<string, unknown>[]).some((part) => matchesWhere(book, part));
    }
    if (key === "format") return book.format === value;
    if (key === "grade") return book.grade === value;
    if (key === "stock") {
      const gt = (value as { gt?: number }).gt;
      return typeof gt === "number" ? book.stock > gt : false;
    }
    if (key === "category") {
      const name = (value as { name?: { contains?: string; equals?: string } }).name;
      if (!name) return true;
      if (typeof name.contains === "string") return contains(book.category.name, name.contains);
      if (typeof name.equals === "string") return book.category.name === name.equals;
      return true;
    }

    const field = (book as unknown as Record<string, unknown>)[key];
    if (field === undefined || field === null) return false;
    if (value && typeof value === "object" && "contains" in value) {
      return contains(field, (value as { contains: unknown }).contains);
    }
    return field === value;
  });
}

function selectRows(args: Record<string, unknown> | undefined): FixtureBook[] {
  const where = args?.where as Record<string, unknown> | undefined;
  let rows = BOOKS.filter((book) => matchesWhere(book, where));
  const orderBy = args?.orderBy as Record<string, "asc" | "desc"> | undefined;
  if (orderBy?.title) {
    rows = [...rows].sort((a, b) => a.title.localeCompare(b.title));
  }
  const take = args?.take as number | undefined;
  return typeof take === "number" ? rows.slice(0, take) : rows;
}

beforeEach(() => {
  jest.clearAllMocks();

  mockFindMany.mockImplementation(async (args: Record<string, unknown>) => selectRows(args));
  mockFindFirst.mockImplementation(async (args: Record<string, unknown>) => selectRows(args)[0] ?? null);
  mockBookCount.mockImplementation(async (args: Record<string, unknown>) =>
    BOOKS.filter((book) => matchesWhere(book, args?.where as Record<string, unknown> | undefined)).length
  );
  mockAggregate.mockImplementation(async (args: Record<string, unknown>) => {
    const where = args?.where as Record<string, unknown> | undefined;
    return {
      _sum: {
        stock: BOOKS.filter((book) => matchesWhere(book, where)).reduce(
          (total, book) => total + book.stock,
          0
        ),
      },
    };
  });
  mockBorrowCount.mockResolvedValue(0);
  mockCategoryCount.mockResolvedValue(2);
  mockCategoryFindMany.mockImplementation(async (args: Record<string, unknown>) => {
    const select = args?.select as
      | { _count?: { select?: { books?: { where?: Record<string, unknown> } } } }
      | undefined;
    const where = select?._count?.select?.books?.where;
    const names = Array.from(new Set(BOOKS.map((book) => book.category.name)));
    return names.map((name) => ({
      name,
      _count: {
        books: BOOKS.filter(
          (book) => book.category.name === name && matchesWhere(book, where)
        ).length,
      },
    }));
  });
  mockSettingFindMany?.mockResolvedValue([]);
});

function findManyFormats(): string[] {
  return mockFindMany.mock.calls
    .map(([args]) => (args?.where as Record<string, unknown> | undefined)?.format)
    .filter((format): format is string => typeof format === "string");
}

function bookIds(answer: { references: Array<{ id: string }> }): string[] {
  return answer.references.map((ref) => ref.id);
}

describe("resolveCatalogFormat() — satu sumber kebenaran", () => {
  it("default buku adalah PHYSICAL dan ebook eksplisit adalah EBOOK", () => {
    expect(resolveCatalogFormat("Buku apa yang tersedia di katalog?")).toBe("PHYSICAL");
    expect(resolveCatalogFormat("Cari buku sejarah.")).toBe("PHYSICAL");
    expect(resolveCatalogFormat("Ebook apa yang tersedia?")).toBe("EBOOK");
    expect(resolveCatalogFormat("Ada e-book matematika?")).toBe("EBOOK");
    expect(resolveCatalogFormat("Ada e book matematika?")).toBe("EBOOK");
    expect(resolveCatalogFormat("Cari buku digital sejarah.")).toBe("EBOOK");
    expect(resolveCatalogFormat("Buku cetak fisika")).toBe("PHYSICAL");
  });

  it("ALL hanya untuk permintaan eksplisit kedua format", () => {
    expect(resolveCatalogFormat("Tampilkan buku fisik dan ebook yang tersedia.")).toBe("ALL");
    expect(resolveCatalogFormat("buku biasa")).toBe("PHYSICAL");
    expect(resolveCatalogFormat("buku", "PHYSICAL")).toBe("PHYSICAL");
  });

  it("penanda format pada pertanyaan mengalahkan argumen model", () => {
    expect(resolveCatalogFormat("Cari ebook fisika", "PHYSICAL")).toBe("EBOOK");
    expect(resolveCatalogFormat("Cari buku cetak fisika", "EBOOK")).toBe("PHYSICAL");
  });

  it("argumen model dipakai bila pertanyaan tidak punya penanda format", () => {
    expect(resolveCatalogFormat("fisika", "EBOOK")).toBe("EBOOK");
    expect(resolveCatalogFormat("fisika")).toBe("PHYSICAL");
  });
});

describe("detectIntent() — routing format", () => {
  it("pertanyaan buku tanpa penanda digital → BOOK_PHYSICAL", () => {
    expect(detectIntent("Buku apa yang tersedia di katalog?", false)).toBe("BOOK_PHYSICAL");
    expect(detectIntent("Ada buku Matematika kelas 10?", false)).toBe("BOOK_PHYSICAL");
    expect(detectIntent("Cari buku sejarah.", false)).toBe("BOOK_PHYSICAL");
  });

  it("pertanyaan ebook/buku digital → EBOOK_CATALOG", () => {
    expect(detectIntent("Ebook apa yang tersedia di katalog?", false)).toBe("EBOOK_CATALOG");
    expect(detectIntent("Ada e-book Matematika kelas 10?", false)).toBe("EBOOK_CATALOG");
    expect(detectIntent("Ada e book Matematika kelas 10?", false)).toBe("EBOOK_CATALOG");
    expect(detectIntent("Cari buku digital sejarah.", false)).toBe("EBOOK_CATALOG");
  });

  it("permintaan kedua format → CATALOG (resolver menghasilkan ALL)", () => {
    const query = "Tampilkan buku fisik dan ebook yang tersedia.";
    expect(detectIntent(query, false)).toBe("CATALOG");
    expect(resolveCatalogFormat(query)).toBe("ALL");
  });
});

describe("query database benar-benar difilter per format", () => {
  it("pencarian buku fisik hanya memakai where.format=PHYSICAL", async () => {
    const books = await searchCatalogBooks("Matematika kelas 10", 8, "PHYSICAL");
    expect(books.map((book) => book.id)).toEqual(["p-matematika"]);
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);
  });

  it("pencarian ebook hanya memakai where.format=EBOOK", async () => {
    const books = await searchCatalogBooks("Matematika kelas 10", 8, "EBOOK");
    expect(books.map((book) => book.id)).toEqual(["e-matematika"]);
    expect(findManyFormats().every((format) => format === "EBOOK")).toBe(true);
  });

  it("fuzzy search tetap mematuhi format di query database", async () => {
    const physical = await searchCatalogBooks("Fisikx", 8, "PHYSICAL");
    expect(physical.map((book) => book.id)).toEqual(["p-fisika"]);
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);

    mockFindMany.mockClear();
    const ebook = await searchCatalogBooks("Fisikx", 8, "EBOOK");
    expect(ebook.map((book) => book.id)).toEqual(["e-fisika"]);
    expect(findManyFormats().every((format) => format === "EBOOK")).toBe(true);
  });
});

describe("handler tool meneruskan format yang benar", () => {
  it("search_books tanpa format default PHYSICAL", async () => {
    const result = JSON.parse(
      await executeTool("search_books", { query: "fisika" }, "user-1", "STUDENT")
    );
    expect(result.format).toBe("PHYSICAL");
    expect(result.books.map((book: { title: string }) => book.title)).toEqual([
      "Fisika Dasar Kelas X",
    ]);
    expect(result.books.every((book: { format: string }) => book.format === "PHYSICAL")).toBe(true);
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);
  });

  it("search_books dengan format EBOOK dan query eksplisit hanya mengambil ebook", async () => {
    const explicit = JSON.parse(
      await executeTool(
        "search_books",
        { query: "ebook fisika" },
        "user-1",
        "STUDENT"
      )
    );
    expect(explicit.format).toBe("EBOOK");
    expect(explicit.books.map((book: { title: string }) => book.title)).toEqual([
      "Fisika Digital",
    ]);

    mockFindMany.mockClear();
    const byArg = JSON.parse(
      await executeTool(
        "search_books",
        { query: "fisika", format: "EBOOK" },
        "user-1",
        "STUDENT"
      )
    );
    expect(byArg.format).toBe("EBOOK");
    expect(byArg.books.map((book: { title: string }) => book.title)).toEqual([
      "Fisika Digital",
    ]);
    expect(byArg.books.every((book: { format: string }) => book.format === "EBOOK")).toBe(true);
    expect(findManyFormats().every((format) => format === "EBOOK")).toBe(true);
  });

  it("list_available_books default PHYSICAL dan tidak menampilkan ebook", async () => {
    const result = JSON.parse(
      await executeTool("list_available_books", {}, "user-1", "STUDENT")
    );
    expect(result.format).toBe("PHYSICAL");
    expect(result.books.every((book: { format: string }) => book.format === "PHYSICAL")).toBe(true);
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);
  });

  it("book_summary mengikuti format dan menolak substitusi lintas format", async () => {
    const physical = JSON.parse(
      await executeTool(
        "book_summary",
        { query: "Biologi Molekuler" },
        "user-1",
        "STUDENT"
      )
    );
    expect(physical.found).toBe(true);
    expect(physical.book.title).toBe("Biologi Molekuler");
    expect(physical.book.format).toBe("PHYSICAL");

    // Ebook "Algoritma Digital" ada, tetapi ringkasan BUKU fisik harus kosong.
    const missingPhysical = JSON.parse(
      await executeTool(
        "book_summary",
        { query: "Algoritma" },
        "user-1",
        "STUDENT"
      )
    );
    expect(missingPhysical.found).toBe(false);
    expect(missingPhysical.format).toBe("PHYSICAL");
  });
});

describe("buildCatalogAnswer() — 12 skenario regresi", () => {
  it("1. buku apa yang tersedia di katalog → hanya PHYSICAL", async () => {
    const answer = await buildCatalogAnswer(
      "BOOK_PHYSICAL",
      "Buku apa yang tersedia di katalog?"
    );
    expect(answer.message).toContain("Fisika Dasar Kelas X");
    expect(answer.message).toContain("Matematika Wajib Kelas X");
    expect(answer.message).not.toContain("Fisika Digital");
    expect(answer.message).not.toContain("Matematika Digital");
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);
  });

  it("2. ada buku Matematika kelas 10 → hanya PHYSICAL", async () => {
    const answer = await buildCatalogAnswer(
      "BOOK_PHYSICAL",
      "Ada buku Matematika kelas 10?"
    );
    expect(answer.message).toContain("Matematika Wajib Kelas X");
    expect(answer.message).not.toContain("Matematika Digital");
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);
  });

  it("3. cari buku sejarah → hanya PHYSICAL", async () => {
    const answer = await buildCatalogAnswer("BOOK_PHYSICAL", "Cari buku sejarah.");
    expect(answer.message).toContain("Sejarah Indonesia");
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);
  });

  it("4. ebook apa yang tersedia di katalog → hanya EBOOK", async () => {
    const answer = await buildCatalogAnswer(
      "EBOOK_CATALOG",
      "Ebook apa yang tersedia di katalog?"
    );
    expect(answer.message).toContain("Fisika Digital");
    expect(answer.message).not.toContain("Fisika Dasar Kelas X");
    expect(answer.message).not.toContain("Sejarah Indonesia");
    expect(findManyFormats().every((format) => format === "EBOOK")).toBe(true);
  });

  it("5. ada e-book Matematika kelas 10 → hanya EBOOK", async () => {
    const answer = await buildCatalogAnswer(
      "EBOOK_CATALOG",
      "Ada e-book Matematika kelas 10?"
    );
    expect(answer.message).toContain("Matematika Digital Kelas X");
    expect(answer.message).not.toContain("Matematika Wajib Kelas X");
    expect(findManyFormats().every((format) => format === "EBOOK")).toBe(true);
  });

  it("6. cari buku digital geografi → hanya EBOOK", async () => {
    const answer = await buildCatalogAnswer(
      "EBOOK_CATALOG",
      "Cari buku digital geografi."
    );
    expect(answer.message).toContain("Geografi Digital");
    expect(findManyFormats().every((format) => format === "EBOOK")).toBe(true);
  });

  it("7. minta buku fisik dan ebook → dua bagian terpisah", async () => {
    const answer = await buildCatalogAnswer(
      "CATALOG",
      "Tampilkan buku fisik dan ebook yang tersedia."
    );
    expect(answer.message).toContain("**Buku fisik**");
    expect(answer.message).toContain("**Ebook**");
    expect(answer.message).toContain("Fisika Dasar Kelas X");
    expect(answer.message).toContain("Fisika Digital");
    expect(answer.message).toContain("Ebook dapat dibaca secara digital melalui web DigiLib.");
    // Bukti query memakai dua format berbeda.
    const formats = new Set(findManyFormats());
    expect(formats.has("PHYSICAL")).toBe(true);
    expect(formats.has("EBOOK")).toBe(true);
    expect(formats.size).toBe(2);
  });

  it("8. buku fisik tidak ada tetapi ebook berjudul sama ada → tetap tidak ditemukan", async () => {
    const answer = await buildCatalogAnswer("BOOK_PHYSICAL", "Ada buku Algoritma?");
    expect(answer.message).toContain("tidak ada buku");
    expect(answer.message).not.toContain("Algoritma Digital");
    expect(answer.references).toEqual([]);
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);
  });

  it("9. ebook tidak ada tetapi buku fisik berjudul sama ada → tetap tidak ditemukan", async () => {
    const answer = await buildCatalogAnswer(
      "EBOOK_CATALOG",
      "Cari ebook Manajemen Perpustakaan."
    );
    expect(answer.message).toContain("tidak ada ebook");
    expect(answer.message).not.toContain("Manajemen Perpustakaan");
    expect(answer.references).toEqual([]);
    expect(findManyFormats().every((format) => format === "EBOOK")).toBe(true);
  });

  it("10. judul sama di dua format tetap dua entri terpisah", async () => {
    const physical = await buildCatalogAnswer(
      "BOOK_PHYSICAL",
      "Cari buku Biologi Molekuler."
    );
    expect(bookIds(physical)).toEqual(["p-biologi"]);

    mockFindMany.mockClear();
    const ebook = await buildCatalogAnswer(
      "EBOOK_CATALOG",
      "Cari ebook Biologi Molekuler."
    );
    expect(bookIds(ebook)).toEqual(["e-biologi"]);

    mockFindMany.mockClear();
    const both = await buildCatalogAnswer(
      "CATALOG",
      "Tampilkan buku fisik dan ebook Biologi Molekuler."
    );
    expect(bookIds(both).sort()).toEqual(["e-biologi", "p-biologi"]);
    expect(both.message).toContain("**Buku fisik**");
    expect(both.message).toContain("**Ebook**");
  });

  it("11. fuzzy build answer tidak mencampur format", async () => {
    const physical = await buildCatalogAnswer("BOOK_PHYSICAL", "Cari buku Fisikx.");
    expect(bookIds(physical)).toEqual(["p-fisika"]);
    expect(findManyFormats().every((format) => format === "PHYSICAL")).toBe(true);

    mockFindMany.mockClear();
    const ebook = await buildCatalogAnswer("EBOOK_CATALOG", "Cari ebook Fisikx.");
    expect(bookIds(ebook)).toEqual(["e-fisika"]);
    expect(findManyFormats().every((format) => format === "EBOOK")).toBe(true);
  });
});

describe("format pada pertanyaan lanjutan dan pergantian topik", () => {
  it("pertanyaan mandiri baru tidak mewarisi format topik sebelumnya", () => {
    expect(
      resolveCatalogFormat(
        mergeCatalogQuery("Buku apa yang tersedia di katalog?", [
          "Ebook fisika apa saja yang tersedia?",
        ])
      )
    ).toBe("PHYSICAL");

    expect(
      resolveCatalogFormat(
        mergeCatalogQuery("Ebook apa yang tersedia?", ["Cari buku sejarah."])
      )
    ).toBe("EBOOK");

    expect(
      resolveCatalogFormat(
        mergeCatalogQuery("Cari buku biologi.", ["Ebook fisika apa saja?"])
      )
    ).toBe("PHYSICAL");
  });

  it("follow-up tanpa penanda format mewarisi format topik secara relevan", () => {
    const ebookFollowUp = mergeCatalogQuery("stoknya berapa?", [
      "Ebook fisika apa saja?",
    ]);
    expect(resolveCatalogFormat(ebookFollowUp)).toBe("EBOOK");

    const physicalFollowUp = mergeCatalogQuery("stoknya berapa?", [
      "Buku fisika apa saja?",
    ]);
    expect(resolveCatalogFormat(physicalFollowUp)).toBe("PHYSICAL");
  });

  it("penanda format pada pertanyaan baru mengalahkan konteks sebelumnya", () => {
    const current = "versi cetak yang kelas 11?";
    const merged = mergeCatalogQuery(current, ["Ebook fisika kelas 10"]);
    // Logika yang sama dengan pipeline: format eksplisit pertanyaan baru menang.
    const format = hasFormatCue(current)
      ? resolveCatalogFormat(current)
      : resolveCatalogFormat(merged);
    expect(format).toBe("PHYSICAL");
    expect(hasFormatCue("Ebook fisika kelas 11?")).toBe(true);
  });
});
