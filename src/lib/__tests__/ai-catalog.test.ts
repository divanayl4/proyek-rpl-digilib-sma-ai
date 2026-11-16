/**
 * AI Chat â€” Query Katalog
 *
 * Memastikan AI memakai data nyata dari database: stok tersedia dihitung dari
 * peminjaman aktif, dan pencarian tidak memakai kata kunci kosong.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    category: { count: jest.fn() },
    borrowRecord: { count: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  buildBookSummaryAnswer,
  buildCatalogListAnswer,
} from "@/lib/ai/catalogAnswer";
import {
  extractGrade,
  extractMajor,
  extractSearchTerms,
  getCatalogStats,
  getPopularBooks,
  isStandaloneCatalogQuery,
  mergeCatalogQuery,
  resolveCatalogQuery,
  searchCatalogBooks,
  listAllCatalogBooks,
  findBookByReference,
  buildCatalogAnswer,
} from "@/lib/ai/catalog";

const mockFindMany = prisma.book.findMany as jest.Mock;
const mockFindFirst = prisma.book.findFirst as jest.Mock;
const mockBookCount = prisma.book.count as jest.Mock;
const mockAggregate = prisma.book.aggregate as jest.Mock;
const mockCategoryCount = prisma.category.count as jest.Mock;
const mockBorrowCount = prisma.borrowRecord.count as jest.Mock;

beforeEach(() => jest.clearAllMocks());

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "book-1",
    title: "Fisika SMA Kelas X",
    author: "Budi Santoso",
    publisher: "Erlangga",
    year: 2021,
    isbn: "978-123",
    description: "Buku teks fisika.",
    stock: 5,
    category: { name: "IPA" },
    _count: { borrows: 1 },
    ...overrides,
  };
}

describe("extractSearchTerms()", () => {
  it("membuang kata umum yang tidak berguna", () => {
    expect(extractSearchTerms("tolong carikan buku tentang sejarah")).toEqual([
      "sejarah",
    ]);
  });

  it("mempertahankan kata kunci bermakna", () => {
    expect(extractSearchTerms("buku tentang perubahan iklim")).toEqual(
      expect.arrayContaining(["perubahan", "iklim"])
    );
  });

  it("mempertahankan istilah pendek yang bermakna di sekolah", () => {
    expect(extractSearchTerms("buku IPA")).toEqual(["ipa"]);
    expect(extractSearchTerms("contoh soal matematika")).toEqual([
      "soal",
      "matematika",
    ]);
  });

  it("membuang kata penjelasan saat buku dirujuk tanpa judul", () => {
    expect(extractSearchTerms("ringkas buku ini")).toEqual([]);
  });

  it("membuang kata kerja baca agar tidak menjadi filter katalog", () => {
    // Regresi: "Ada berapa ebook yang bisa dibaca?" pernah menyaring katalog
    // dengan kata "dibaca" sehingga jumlah judul ebook salah (1 bukan 2).
    expect(extractSearchTerms("Ada berapa ebook yang bisa dibaca?")).toEqual([]);
    expect(extractSearchTerms("buku apa saja yang bisa dibaca")).toEqual([]);
  });

  it("mengabaikan kata pendek", () => {
    expect(extractSearchTerms("ada apa coba")).toEqual([]);
  });

  it("menormalkan huruf besar dan tanda baca", () => {
    expect(extractSearchTerms("FISIKA, Termodinamika!")).toEqual([
      "fisika",
      "termodinamika",
    ]);
  });
});

describe("searchCatalogBooks()", () => {
  it("tidak menyentuh database bila hanya ada kata umum", async () => {
    await expect(searchCatalogBooks("tolong carikan buku")).resolves.toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("menghitung stok tersedia dari peminjaman aktif", async () => {
    mockFindMany.mockResolvedValue([row({ stock: 5, _count: { borrows: 2 } })]);

    const [book] = await searchCatalogBooks("fisika");
    expect(book.available).toBe(3);
  });

  it("tidak menghasilkan stok tersedia negatif", async () => {
    mockFindMany.mockResolvedValue([row({ stock: 1, _count: { borrows: 4 } })]);

    const [book] = await searchCatalogBooks("fisika");
    expect(book.available).toBe(0);
  });

  it("mengembalikan daftar kosong bila tidak ada yang cocok", async () => {
    mockFindMany.mockResolvedValue([]);
    await expect(searchCatalogBooks("kontsep antimatter")).resolves.toEqual([]);
  });

  it("membatasi jumlah hasil sesuai parameter", async () => {
    mockFindMany.mockResolvedValue([]);
    await searchCatalogBooks("fisika", 3);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 })
    );
  });
});

describe("findBookByReference()", () => {
  it("mengembalikan null bila tidak ada kata kunci", async () => {
    await expect(findBookByReference("ringkas buku ini")).resolves.toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("mengambil satu buku teratas", async () => {
    mockFindFirst.mockResolvedValue(row());
    const book = await findBookByReference("ringkas buku Fisika SMA");
    expect(book?.title).toBe("Fisika SMA Kelas X");
    expect(book?.available).toBe(4);
  });

  it("mengutamakan format ebook bila pengguna meminta ebook", async () => {
    // Regresi: "ringkas buku Fisika Dasar untuk SMA ebook" pernah mengembalikan
    // buku fisik berjudul mirip, lalu menampilkan stok buku tersebut.
    mockFindFirst.mockResolvedValue(row({ title: "Fisika SMA Kelas X (Ebook)" }));

    await findBookByReference("ringkas buku Fisika SMA ebook");

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ format: "EBOOK" }),
      })
    );
  });
});

describe("getCatalogStats()", () => {
  it("menghitung total tersedia dari total eksemplar dikurangi peminjaman aktif", async () => {
    mockAggregate.mockResolvedValue({ _sum: { stock: 300 } });
    mockBookCount.mockImplementation(async (args: any) => {
      const where = args?.where ?? {};
      const archived = where.archivedAt;
      const isArchived = archived && archived.not === null;
      if (isArchived) {
        if (where.format === "EBOOK") return 0;
        if (where.format === "PHYSICAL") return 0;
        return 0;
      }
      if (where.format === "EBOOK") return 18;
      if (where.format === "PHYSICAL") return 102;
      return 120;
    });
    mockCategoryCount.mockResolvedValue(8);
    mockBorrowCount.mockResolvedValueOnce(25).mockResolvedValueOnce(640);

    await expect(getCatalogStats()).resolves.toEqual({
      totalTitles: 120,
      totalCopies: 300,
      totalAvailable: 275,
      totalEbooks: 18,
      physicalTitles: 102,
      physicalCopies: 300,
      physicalAvailable: 275,
      activeLoans: 25,
      totalBorrows: 640,
      categories: 8,
      archivedTitles: 0,
      archivedEbooks: 0,
      archivedPhysicalTitles: 0,
    });
  });

  it("tidak menghasilkan total tersedia negatif", async () => {
    mockAggregate.mockResolvedValue({ _sum: { stock: null } });
    mockBookCount.mockResolvedValue(0);
    mockCategoryCount.mockResolvedValue(0);
    mockBorrowCount.mockResolvedValue(3);

    const stats = await getCatalogStats();
    expect(stats.totalCopies).toBe(0);
    expect(stats.totalAvailable).toBe(0);
    expect(stats.archivedTitles).toBe(0);
  });
});

describe("getPopularBooks()", () => {
  it("mengembalikan buku terbaru beserta ketersediaan", async () => {
    mockFindMany.mockResolvedValue([row({ stock: 4, _count: { borrows: 0 } })]);
    const books = await getPopularBooks(2);
    expect(books[0].available).toBe(4);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 })
    );
  });
});

describe("extractGrade()", () => {
  it("memetakan angka kelas ke kode romawi", () => {
    expect(extractGrade("buku kelas 10")).toBe("X");
    expect(extractGrade("kelas 11")).toBe("XI");
    expect(extractGrade("Kelas 12 dong")).toBe("XII");
  });

  it("menerima penulisan romawi dan kata tingkat", () => {
    expect(extractGrade("buku kelas X")).toBe("X");
    expect(extractGrade("tingkat XI")).toBe("XI");
  });

  it("mengembalikan null bila kelas tidak disebut", () => {
    expect(extractGrade("buku fisika")).toBeNull();
  });
});

describe("extractMajor()", () => {
  it("mengenali kode jurusan", () => {
    expect(extractMajor("buku untuk TKJ")).toBe("Teknik Komputer dan Jaringan");
    expect(extractMajor("jurusan RPL")).toBe("Rekayasa Perangkat Lunak");
  });

  it("mengenali nama jurusan lengkap", () => {
    expect(extractMajor("buku Akuntansi dan Keuangan Lembaga")).toBe(
      "Akuntansi dan Keuangan Lembaga"
    );
  });

  it("mengembalikan null bila tidak ada jurusan", () => {
    expect(extractMajor("buku fisika biasa")).toBeNull();
  });
});

describe("resolveCatalogQuery()", () => {
  it("memisahkan kata kunci, kelas, dan jurusan", () => {
    expect(resolveCatalogQuery("Rekomendasi buku jaringan komputer kelas 11 jurusan TKJ")).toEqual({
      terms: expect.arrayContaining(["jaringan", "komputer"]),
      grade: "XI",
      major: "Teknik Komputer dan Jaringan",
    });
  });

  it("tidak meninggalkan kata penanda dimensi sebagai kata kunci", () => {
    const { terms } = resolveCatalogQuery("buku kelas 10 jurusan RPL mata pelajaran");
    expect(terms).not.toContain("kelas");
    expect(terms).not.toContain("jurusan");
    expect(terms).not.toContain("pelajaran");
  });
});

describe("isStandaloneCatalogQuery()", () => {
  it("mengenali pertanyaan koleksi umum sebagai pertanyaan mandiri", () => {
    expect(isStandaloneCatalogQuery("Ada buku apa saja?")).toBe(true);
    expect(isStandaloneCatalogQuery("Buku apa saja yang tersedia?")).toBe(true);
    expect(isStandaloneCatalogQuery("Ebook apa saja yang tersedia?")).toBe(true);
    expect(isStandaloneCatalogQuery("Ebook apa saja yang ada?")).toBe(true);
    expect(isStandaloneCatalogQuery("Tampilkan semua koleksi.")).toBe(true);
    expect(isStandaloneCatalogQuery("Koleksi apa saja yang ada")).toBe(true);
  });

  it("tidak menandai pertanyaan spesifik atau lanjutan sebagai mandiri", () => {
    expect(isStandaloneCatalogQuery("Yang untuk kelas 11 ada?")).toBe(false);
    expect(isStandaloneCatalogQuery("Kalau untuk jurusan TKJ?")).toBe(false);
    expect(isStandaloneCatalogQuery("Buku jaringan komputer")).toBe(false);
  });
});

describe("mergeCatalogQuery()", () => {
  it("memakai pertanyaan apa adanya bila sudah punya kata kunci", () => {
    expect(mergeCatalogQuery("buku jaringan komputer", ["buku fisika"])).toBe(
      "buku jaringan komputer"
    );
  });

  it("menggabungkan topik sebelumnya untuk pertanyaan lanjutan", () => {
    const merged = mergeCatalogQuery("Yang untuk kelas 11 ada?", [
      "Saya ingin belajar jaringan komputer",
    ]);
    expect(merged).toContain("jaringan komputer");
    expect(merged).toContain("kelas 11");
  });

  it("mengembalikan pesan apa adanya bila tidak ada topik sebelumnya", () => {
    expect(mergeCatalogQuery("Yang untuk kelas 11 ada?", [])).toBe(
      "Yang untuk kelas 11 ada?"
    );
  });

  it("tidak menggabungkan pertanyaan mandiri dengan topik denda sebelumnya", () => {
    const res = mergeCatalogQuery("Ada buku apa saja?", [
      "Apakah saya memiliki denda?",
    ]);
    expect(res).toBe("Ada buku apa saja?");
    expect(res).not.toContain("denda");
  });

  it("tidak memfilter ebook dengan kata kunci buku fisika sebelumnya saat bertanya ebook mandiri", () => {
    const res = mergeCatalogQuery("Ebook apa saja yang tersedia?", [
      "Saya ingin mencari buku fisika",
    ]);
    expect(res).toBe("Ebook apa saja yang tersedia?");
    expect(res).not.toContain("fisika");
  });

  it("tidak menggabungkan pertanyaan ketersediaan umum dengan pertanyaan peminjaman sebelumnya", () => {
    const res = mergeCatalogQuery("Buku apa saja yang tersedia?", [
      "Kapan saya harus mengembalikan buku?",
    ]);
    expect(res).toBe("Buku apa saja yang tersedia?");
    expect(res).not.toContain("kembalikan");
  });

  it("memproses permintaan 'Tampilkan semua koleksi.' secara mandiri", () => {
    const res = mergeCatalogQuery("Tampilkan semua koleksi.", [
      "Buku sejarah kelas 10",
    ]);
    expect(res).toBe("Tampilkan semua koleksi.");
    expect(res).not.toContain("sejarah");
  });
});

describe("buildCatalogListAnswer() — ketersediaan", () => {
  const criteria = { terms: [], grade: null, major: null };

  const physical = {
    ...row({ stock: 4, _count: { borrows: 1 } }),
    available: 3,
    category: "IPA",
    format: "PHYSICAL",
    coverUrl: null,
  };

  const ebook = {
    ...row({ id: "book-2", title: "Fisika SMA (Ebook)", stock: 0, _count: { borrows: 0 } }),
    available: 0,
    category: "Ebook",
    format: "EBOOK",
    coverUrl: null,
  };

  it("tidak menandai ebook sebagai 'sedang dipinjam'", () => {
    // Regresi: ebook tidak punya eksemplar; stok 0 pernah membuat chatbot
    // mengklaim "sedang dipinjam" untuk judul yang sebenarnya tersedia.
    const answer = buildCatalogListAnswer("rekomendasikan ebook", [ebook], 1, criteria);
    expect(answer.message).toContain("(ebook)");
    expect(answer.message).not.toContain("sedang dipinjam");
  });

  it("tetap memakai stok nyata untuk buku fisik", () => {
    const answer = buildCatalogListAnswer("buku fisika", [physical], 1, criteria);
    expect(answer.message).toContain("tersedia 3");
  });

  it("referensi ebook tidak membawa angka stok yang menyesatkan", () => {
    const answer = buildCatalogListAnswer("rekomendasikan ebook", [ebook], 1, criteria);
    expect(answer.references[0].available).toBeNull();
    expect(answer.references[0].coverUrl).toBeNull();
  });

  it("referensi buku fisik membawa jumlah tersedia dari database", () => {
    const answer = buildCatalogListAnswer("buku fisika", [physical], 1, criteria);
    expect(answer.references[0].available).toBe(3);
  });
});

describe("mergeCatalogQuery() — rujukan buku & stok", () => {
  it("menggabungkan 'stoknya berapa?' dengan topik katalog sebelumnya", () => {
    const merged = mergeCatalogQuery("stoknya berapa?", ["buku fisika kelas 10"]);
    expect(merged).toContain("fisika");
    expect(merged).toContain("stoknya berapa");
  });

  it("menggabungkan rujukan 'buku itu' dengan judul sebelumnya", () => {
    const merged = mergeCatalogQuery("buku itu tersedia?", [
      "rekomendasi buku pemrograman",
    ]);
    expect(merged).toContain("pemrograman");
  });

  it("tidak menggabungkan bila tidak ada topik katalog sebelumnya", () => {
    expect(mergeCatalogQuery("stoknya berapa?", ["halo"])).toBe("stoknya berapa?");
    expect(mergeCatalogQuery("buku itu tersedia?", [])).toBe("buku itu tersedia?");
  });

  it("tidak membawa topik non-katalog ke pertanyaan stok", () => {
    const merged = mergeCatalogQuery("stoknya berapa?", [
      "Apakah saya memiliki denda?",
    ]);
    expect(merged).toBe("stoknya berapa?");
    expect(merged).not.toContain("denda");
  });
});

describe("searchCatalogBooks() — fallback sinonim & salah ketik", () => {
  it("pencarian persis tidak memakai sinonim", async () => {
    mockFindMany.mockResolvedValueOnce([
      row({ title: "Fisika Dasar", description: "Buku fisika." }),
    ]);

    const books = await searchCatalogBooks("fisika");

    expect(books[0].title).toBe("Fisika Dasar");
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("memakai sinonim hanya ketika pencarian persis kosong", async () => {
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ title: "Pemrograman Dasar" })]);

    const books = await searchCatalogBooks("coding");

    expect(books[0].title).toBe("Pemrograman Dasar");
    expect(mockFindMany).toHaveBeenCalledTimes(2);
    // Fallback kedua mencari istilah kurikulum, bukan hanya "coding".
    const secondWhere = JSON.stringify(mockFindMany.mock.calls[1][0].where);
    expect(secondWhere).toContain("pemrograman");
  });

  it("mentoleransi salah ketik bila pencarian persis dan sinonim kosong", async () => {
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ title: "Fisika Dasar" })]);

    const books = await searchCatalogBooks("fisikaa");

    expect(books[0].title).toBe("Fisika Dasar");
  });
});

const stockCriteria = { terms: ["fisika"], grade: null, major: null };

function stockBook(overrides: Record<string, unknown> = {}) {
  return {
    ...row(),
    available: 3,
    category: "IPA",
    format: "PHYSICAL",
    coverUrl: null,
    ...overrides,
  } as Parameters<typeof buildCatalogListAnswer>[1][number];
}

describe("buildCatalogListAnswer() — pertanyaan stok", () => {
  it("membaca stok dari database, bukan jumlah judul", () => {
    const answer = buildCatalogListAnswer(
      "berapa stok buku fisika",
      [stockBook({ stock: 5, available: 2 })],
      1,
      stockCriteria
    );
    expect(answer.message).toContain("tersedia 2 dari 5 eksemplar");
    expect(answer.message).not.toContain("Ada 1 judul");
  });

  it("membedakan stok kosong dari semua eksemplar yang dipinjam", () => {
    const zeroStock = buildCatalogListAnswer(
      "stok buku fisika",
      [stockBook({ stock: 0, available: 0 })],
      1,
      stockCriteria
    );
    expect(zeroStock.message).toContain("stok kosong");
    expect(zeroStock.message).not.toContain("sedang dipinjam");

    const allBorrowed = buildCatalogListAnswer(
      "stok buku fisika",
      [stockBook({ stock: 3, available: 0 })],
      1,
      stockCriteria
    );
    expect(allBorrowed.message).toContain("semuanya sedang dipinjam");
    expect(allBorrowed.message).not.toContain("stok kosong");
  });

  it("menjawab stok buku yang dirujuk sebagai 'buku ini'", () => {
    const answer = buildCatalogListAnswer(
      "stok buku ini",
      [stockBook({ title: "Fisika SMA Kelas X", stock: 4, available: 1 })],
      1,
      stockCriteria
    );
    expect(answer.message).toContain("Fisika SMA Kelas X");
    expect(answer.message).toContain("tersedia 1 dari 4 eksemplar");
  });

  it("pertanyaan ketersediaan membedakan stok kosong dari dipinjam semua", () => {
    const zeroStock = buildCatalogListAnswer(
      "buku fisika yang tersedia",
      [stockBook({ stock: 0, available: 0 })],
      1,
      stockCriteria
    );
    expect(zeroStock.message).toContain("stoknya kosong");

    const allBorrowed = buildCatalogListAnswer(
      "buku fisika yang tersedia",
      [stockBook({ stock: 2, available: 0 })],
      1,
      stockCriteria
    );
    expect(allBorrowed.message).toContain("sedang dipinjam");
  });

  it("tidak mengklaim ebook punya stok eksemplar", () => {
    const answer = buildCatalogListAnswer(
      "berapa stok ebook fisika",
      [
        stockBook({
          title: "Fisika (Ebook)",
          stock: 0,
          available: 0,
          format: "EBOOK",
        }),
      ],
      1,
      stockCriteria
    );
    expect(answer.message).toContain("tidak memiliki stok eksemplar");
    expect(answer.message).not.toContain("stok kosong");
  });
});

describe("buildCatalogAnswer() — statistik berfilter", () => {
  it("menghitung judul yang cocok, bukan seluruh katalog", async () => {
    mockFindMany.mockResolvedValue([row({ title: "Fisika SMA Kelas X" })]);
    mockBookCount.mockResolvedValueOnce(1);

    const answer = await buildCatalogAnswer("STATS", "Berapa jumlah buku fisika?");

    expect(answer.message).toContain("Ada 1 judul buku fisika");
    expect(answer.message).not.toContain("eksemplar");
  });
});

describe("buildCatalogListAnswer() — penanda bahwa stok dibatasi", () => {
  it("menyebut stok dari database secara eksplisit", () => {
    const answer = buildCatalogListAnswer(
      "berapa stok buku fisika",
      [stockBook({ stock: 2, available: 2 })],
      1,
      stockCriteria
    );
    expect(answer.message).toContain("tersedia 2 dari 2 eksemplar");
  });
});

describe("buildCatalogListAnswer() — katalog kosong vs tidak ditemukan", () => {
  const criteria = { terms: ["fisika"], grade: null, major: null };

  it("membedakan katalog yang benar-benar kosong", () => {
    const answer = buildCatalogListAnswer("buku fisika", [], 0, criteria, true);

    expect(answer.message).toContain("Katalog DigiLib belum memiliki");
    expect(answer.message).not.toContain("tidak ada buku fisika");
    expect(answer.references).toEqual([]);
  });

  it("menyatakan judul tidak ditemukan saat katalog berisi", () => {
    const answer = buildCatalogListAnswer("buku fisika", [], 0, criteria, false);

    expect(answer.message).toContain("tidak ada buku fisika");
    expect(answer.message).not.toContain("belum memiliki");
    expect(answer.references).toEqual([]);
  });
});

describe("buildBookSummaryAnswer() — katalog kosong vs tidak ditemukan", () => {
  it("membedakan katalog kosong dari judul yang tidak ditemukan", () => {
    const emptyCatalog = buildBookSummaryAnswer(null, true);
    const notFound = buildBookSummaryAnswer(null, false);

    expect(emptyCatalog.message).toContain("belum memiliki buku");
    expect(notFound.message).toContain("buku tersebut tidak ditemukan");
    expect(notFound.message).not.toContain("belum memiliki");
  });
});

describe("buildBookSummaryAnswer() — ebook", () => {
  const ebook = {
    ...row({ id: "book-2", title: "Fisika SMA (Ebook)", stock: 0, _count: { borrows: 0 } }),
    available: 0,
    category: "Ebook",
    format: "EBOOK",
    coverUrl: null,
  };

  it("tidak menampilkan 'Stok total: 0 / habis' untuk ebook", () => {
    // Regresi: ringkasan ebook pernah menyatakan "habis (sedang dipinjam)"
    // padahal ebook tersedia sebagai koleksi digital.
    const answer = buildBookSummaryAnswer(ebook);
    expect(answer.message).not.toContain("Stok total");
    expect(answer.message).not.toContain("habis");
    expect(answer.message).toContain("ebook");
    expect(answer.message).toContain("aktif di katalog");
  });

  it("tetap menampilkan stok untuk buku fisik", () => {
    const physical = {
      ...row({ stock: 4, _count: { borrows: 1 } }),
      available: 3,
      category: "IPA",
      format: "PHYSICAL",
      coverUrl: null,
    };
    const answer = buildBookSummaryAnswer(physical);
    expect(answer.message).toContain("Stok total: 4");
    expect(answer.message).toContain("3 eksemplar");
  });
});

describe("searchCatalogBooks() — kelas dan jurusan", () => {
  it("menyaring berdasarkan kelas ketika kata kunci dan kelas disebut", async () => {
    mockFindMany.mockResolvedValue([row({ grade: "XI" })]);
    await searchCatalogBooks("buku jaringan komputer kelas 11", 5);

    const arg = mockFindMany.mock.calls[0][0];
    expect(JSON.stringify(arg.where)).toContain('"grade":"XI"');
  });

  it("melonggarkan pencarian ke kata kunci bila filter kelas terlalu sempit", async () => {
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ grade: "X" })]);

    const books = await searchCatalogBooks("fisika kelas 12", 5);
    expect(books).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });

  it("mencari hanya berdasarkan kelas bila tanpa kata kunci lain", async () => {
    mockFindMany.mockResolvedValue([row({ grade: "X" })]);
    const books = await searchCatalogBooks("buku kelas 10", 5);
    expect(books).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("memprioritaskan buku yang cocok dengan kelas yang diminta", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "b-x", title: "Fisika Umum", grade: "X", _count: { borrows: 0 } }),
      row({ id: "b-xi", title: "Fisika Lanjutan", grade: "XI", _count: { borrows: 0 } }),
    ]);
    const books = await searchCatalogBooks("fisika kelas 11", 5);
    expect(books[0].id).toBe("b-xi");
  });
});

describe("findBookByReference() — mapel/jurusan", () => {
  it("mencari buku lewat mata pelajaran atau jurusan", async () => {
    mockFindFirst.mockResolvedValue(row({ subject: "Jaringan Dasar" }));
    await findBookByReference("ringkas buku jaringan");
    const arg = mockFindFirst.mock.calls[0][0];
    expect(JSON.stringify(arg.where)).toContain("subject");
    expect(JSON.stringify(arg.where)).toContain("major");
  });
});

describe("listAllCatalogBooks() - filter ketersediaan (Tahap 4B-4A)", () => {
  it("stok 3, dipinjam 1 → tersedia 2 dan tetap masuk daftar", async () => {
    mockFindMany.mockResolvedValue([row({ stock: 3, _count: { borrows: 1 } })]);

    const books = await listAllCatalogBooks("AVAILABLE", 10);

    expect(books).toHaveLength(1);
    expect(books[0].available).toBe(2);
  });

  it("stok 3, dipinjam 3 → tersedia 0, tidak masuk daftar buku tersedia", async () => {
    mockFindMany.mockResolvedValue([row({ stock: 3, _count: { borrows: 3 } })]);

    const books = await listAllCatalogBooks("AVAILABLE", 10);

    expect(books).toHaveLength(0);
  });

  it("stok 0 → tidak masuk daftar buku tersedia", async () => {
    mockFindMany.mockResolvedValue([row({ stock: 0, _count: { borrows: 0 } })]);

    const books = await listAllCatalogBooks("AVAILABLE", 10);

    expect(books).toHaveLength(0);
  });

  it("scope ALL tetap menampilkan buku penuh (available 0) — filter hanya untuk AVAILABLE", async () => {
    mockFindMany.mockResolvedValue([row({ stock: 3, _count: { borrows: 3 } })]);

    const books = await listAllCatalogBooks("ALL", 10);

    expect(books).toHaveLength(1);
    expect(books[0].available).toBe(0);
  });

  it("buku diarsipkan tidak muncul: query selalu memfilter archivedAt null", async () => {
    mockFindMany.mockResolvedValue([]);

    const books = await listAllCatalogBooks("AVAILABLE", 10);

    const arg = mockFindMany.mock.calls[0][0];
    expect(arg.where.archivedAt).toBeNull();
    expect(books).toHaveLength(0);
  });
});

describe("buildCatalogAnswer() — jumlah koleksi aktif/arsip", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function answerFor(query: string) {
    mockAggregate.mockImplementation(async (args: any) => {
      if (args?.where?.format === "PHYSICAL") return { _sum: { stock: 8 } };
      return { _sum: { stock: 15 } };
    });
    mockBookCount.mockImplementation(async (args: any) => {
      const where = args?.where ?? {};
      const archived = where.archivedAt;
      const isArchived = archived && archived.not === null;
      if (isArchived) {
        if (where.format === "EBOOK") return 0;
        if (where.format === "PHYSICAL") return 1;
        return 1; // archivedTitles
      }
      // active (archivedAt: null)
      if (where.format === "EBOOK") return 2;
      if (where.format === "PHYSICAL") return 2;
      return 4; // totalTitles active
    });
    (prisma.borrowRecord.count as jest.Mock).mockResolvedValue(0);
    (prisma.category.count as jest.Mock).mockResolvedValue(0);
    return buildCatalogAnswer("STATS", query);
  }

  it("menjawab total koleksi aktif/tidak diarsipkan dengan data aktual (4 aktif, 1 arsip)", async () => {
    const queries = [
      "Berapa total koleksi buku aktif di perpustakaan?",
      "Berapa jumlah buku yang tidak diarsipkan saat ini?",
      "Ada berapa total koleksi buku aktif? Jawab singkat dari data.",
      "Berapa total koleksi buku di perpustakaan?",
    ];
    for (const q of queries) {
      jest.clearAllMocks();
      const answer = await answerFor(q);
      expect(answer.message).toMatch(/\b4\b/);
      expect(answer.message).not.toMatch(/tidak ada buku/i);
      expect(answer.message).not.toMatch(/belum memiliki/i);
    }
  });

  it("menjawab jumlah buku yang diarsipkan dengan data aktual", async () => {
    const queries = [
      "Berapa jumlah buku yang diarsipkan?",
      "Ada berapa koleksi arsip di perpustakaan?",
      "Total buku diarsipkan berapa?",
    ];
    for (const q of queries) {
      jest.clearAllMocks();
      const answer = await answerFor(q);
      expect(answer.message).toMatch(/\b1\b/);
      expect(answer.message).toMatch(/arsip/i);
      expect(answer.message).not.toMatch(/tidak ada buku/i);
    }
  });
});