/**
 * AI Catalog — Pengujian Filter Jumlah Buku per Kategori
 *
 * Menguji:
 * 1. Pertanyaan jumlah buku kategori spesifik (hanya menghitung kategori yang diminta).
 * 2. Kategori dengan awalan "Buku " ("teks pelajaran" → "Buku Teks Pelajaran").
 * 3. Kategori dengan nama lengkap ("buku teks pelajaran" → "Buku Teks Pelajaran").
 * 4. Kategori yang tidak ditemukan (menjelaskan tidak tersedia, sebutkan kategori tersedia).
 * 5. Rekapitulasi semua kategori ("berdasarkan kategori").
 * 6. Variasi pertanyaan (Berapa total buku dengan kategori X, Berapa buku kategori X, dsb).
 * 7. Pencocokan case-insensitive dan pencegahan tabrakan parsial (Fiksi vs Nonfiksi).
 * 8. Kasus ambigu: lebih dari satu kategori cocok → minta pengguna memperjelas.
 * 9. Pencocokan sebagian jika hanya mengarah ke satu kategori unik.
 * 10. Filter archivedAt: null dan format scope (PHYSICAL, EBOOK, ALL).
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    category: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    borrowRecord: { count: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { buildCatalogAnswer } from "@/lib/ai/catalog";
import {
  buildSingleCategoryAnswer,
  buildCategoryNotFoundAnswer,
  buildCategoryAnswer,
  buildAmbiguousCategoryAnswer,
} from "@/lib/ai/catalogAnswer";

const mockCategoryFindMany = prisma.category.findMany as jest.Mock;
const mockBookCount = prisma.book.count as jest.Mock;

const sampleCategories = [
  { id: "cat-bio", name: "Biologi" },
  { id: "cat-fis", name: "Fisika" },
  { id: "cat-kim", name: "Kimia" },
  { id: "cat-sej", name: "Sejarah" },
  { id: "cat-fik", name: "Fiksi" },
  { id: "cat-non", name: "Nonfiksi" },
  { id: "cat-teks", name: "Buku Teks Pelajaran" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCategoryFindMany.mockResolvedValue(sampleCategories);
});

describe("AI Catalog — Pertanyaan Kategori Spesifik", () => {
  it("hanya menghitung buku pada kategori Biologi saat ditanya spesifik", async () => {
    mockBookCount.mockResolvedValue(4);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total buku dengan kategori Biologi?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-bio",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Biologi");
    expect(answer.message).toContain("4 judul");
    // Tidak boleh menampilkan kategori lain dalam pesan
    expect(answer.message).not.toContain("Fisika");
    expect(answer.message).not.toContain("Kimia");
    expect(answer.message).not.toContain("Sejarah");
  });

  it("menangani pertanyaan variasi 'Berapa buku kategori Fisika?'", async () => {
    mockBookCount.mockResolvedValue(7);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa buku kategori Fisika?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-fis",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Fisika");
    expect(answer.message).toContain("7 judul");
    expect(answer.message).not.toContain("Biologi");
  });

  it("menangani pertanyaan variasi 'Hitung jumlah buku untuk kategori Kimia'", async () => {
    mockBookCount.mockResolvedValue(5);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Hitung jumlah buku untuk kategori Kimia"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-kim",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Kimia");
    expect(answer.message).toContain("5 judul");
    expect(answer.message).not.toContain("Biologi");
  });

  it("menangani pertanyaan variasi 'Total koleksi buku Biologi berapa?'", async () => {
    mockBookCount.mockResolvedValue(3);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Total koleksi buku Biologi berapa?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-bio",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Biologi");
    expect(answer.message).toContain("3 judul");
  });

  it("menangani pertanyaan variasi 'Ada berapa judul buku dalam kategori Sejarah?'", async () => {
    mockBookCount.mockResolvedValue(2);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Ada berapa judul buku dalam kategori Sejarah?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-sej",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Sejarah");
    expect(answer.message).toContain("2 judul");
  });

  it("menangani kategori yang ada di DB tetapi koleksinya 0 judul", async () => {
    mockBookCount.mockResolvedValue(0);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total buku dengan kategori Biologi?"
    );

    expect(answer.message).toContain("Biologi");
    expect(answer.message).toContain("belum ada");
    expect(answer.message).not.toContain("tidak ditemukan");
  });
});

describe("AI Catalog — Pencocokan Awalan 'Buku' & Variasi Teks Pelajaran", () => {
  it("mencocokkan 'teks pelajaran' ke 'Buku Teks Pelajaran' (tanpa awalan Buku)", async () => {
    mockBookCount.mockResolvedValue(12);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total buku dengan kategori teks pelajaran?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-teks",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Buku Teks Pelajaran");
    expect(answer.message).toContain("12 judul");
    expect(answer.message).not.toContain("tidak ditemukan");
  });

  it("mencocokkan 'buku teks pelajaran' ke 'Buku Teks Pelajaran' (dengan awalan Buku)", async () => {
    mockBookCount.mockResolvedValue(12);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total buku kategori buku teks pelajaran?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-teks",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Buku Teks Pelajaran");
    expect(answer.message).toContain("12 judul");
  });

  it("mencocokkan 'TEKS PELAJARAN' secara case-insensitive", async () => {
    mockBookCount.mockResolvedValue(12);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa buku kategori TEKS PELAJARAN?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-teks",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Buku Teks Pelajaran");
    expect(answer.message).toContain("12 judul");
  });

  it("mencocokkan sebagian jika hanya mengarah ke satu kategori unik ('pelajaran')", async () => {
    mockBookCount.mockResolvedValue(12);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa buku kategori pelajaran?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-teks",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Buku Teks Pelajaran");
    expect(answer.message).toContain("12 judul");
  });
});

describe("AI Catalog — Penanganan Kategori Ambigu", () => {
  it("meminta klarifikasi dan tidak menebak sembarang jika pencocokan menghasilkan > 1 kategori", async () => {
    // Database memiliki 2 kategori yang sama-sama memuat kata 'teks'
    mockCategoryFindMany.mockResolvedValue([
      { id: "cat-teks-1", name: "Buku Teks Pelajaran" },
      { id: "cat-teks-2", name: "Buku Teks Kejuruan" },
      { id: "cat-bio", name: "Biologi" },
    ]);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa buku kategori teks?"
    );

    // Jangan lakukan count sembarang ke salah satu kategori
    expect(mockBookCount).not.toHaveBeenCalled();

    // Meminta klarifikasi kepada pengguna
    expect(answer.message).toContain("beberapa kategori");
    expect(answer.message).toContain("Buku Teks Pelajaran");
    expect(answer.message).toContain("Buku Teks Kejuruan");
    expect(answer.message).toMatch(/perjelas/i);
  });
});

describe("AI Catalog — Kategori Tidak Ditemukan", () => {
  it("menjelaskan kategori Astronomi tidak ditemukan dan menyebutkan kategori tersedia", async () => {
    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total buku kategori Astronomi?"
    );

    expect(mockBookCount).not.toHaveBeenCalled();

    expect(answer.message).toContain("Astronomi");
    expect(answer.message).toContain("tidak ditemukan");
    expect(answer.message).toContain("Biologi");
    expect(answer.message).toContain("Fisika");
    expect(answer.message).toContain("Kimia");
  });
});

describe("AI Catalog — Rekapitulasi Seluruh Kategori", () => {
  it("menampilkan seluruh kategori saat ditanya 'Berapa jumlah buku berdasarkan kategori?'", async () => {
    mockCategoryFindMany.mockResolvedValue([
      { name: "Biologi", _count: { books: 3 } },
      { name: "Fisika", _count: { books: 5 } },
      { name: "Kimia", _count: { books: 2 } },
    ]);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa jumlah buku berdasarkan kategori?"
    );

    expect(answer.message).toContain("per kategori");
    expect(answer.message).toContain("Biologi: 3 judul");
    expect(answer.message).toContain("Fisika: 5 judul");
    expect(answer.message).toContain("Kimia: 2 judul");
  });

  it("menampilkan seluruh kategori untuk 'Tampilkan buku per kategori'", async () => {
    mockCategoryFindMany.mockResolvedValue([
      { name: "Biologi", _count: { books: 3 } },
      { name: "Fisika", _count: { books: 5 } },
    ]);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Tampilkan buku per kategori"
    );

    expect(answer.message).toContain("Biologi: 3 judul");
    expect(answer.message).toContain("Fisika: 5 judul");
  });
});

describe("AI Catalog — Matching & Pencegahan Tabrakan Parsial", () => {
  it("mencocokkan 'Fiksi' secara akurat tanpa tertukar dengan 'Nonfiksi'", async () => {
    mockBookCount.mockResolvedValue(10);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total buku dengan kategori Fiksi?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-fik",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Fiksi");
    expect(answer.message).not.toContain("Nonfiksi");
  });

  it("mencocokkan 'Nonfiksi' secara akurat tanpa tertukar dengan 'Fiksi'", async () => {
    mockBookCount.mockResolvedValue(8);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total buku dengan kategori Nonfiksi?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-non",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Nonfiksi");
  });

  it("mendukung pencocokan case-insensitive", async () => {
    mockBookCount.mockResolvedValue(6);

    const answer = await buildCatalogAnswer(
      "STATS",
      "berapa total buku kategori biologi?"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-bio",
        format: "PHYSICAL",
      },
    });

    expect(answer.message).toContain("Biologi");
  });
});

describe("AI Catalog — Format Scope (PHYSICAL vs EBOOK vs ALL)", () => {
  it("menyaring format EBOOK dengan benar", async () => {
    mockBookCount.mockResolvedValue(2);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total ebook dengan kategori Biologi?",
      "EBOOK"
    );

    expect(mockBookCount).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        categoryId: "cat-bio",
        format: "EBOOK",
      },
    });

    expect(answer.message).toContain("ebook");
    expect(answer.message).toContain("2 judul");
  });

  it("menyajikan kedua bagian untuk scope ALL", async () => {
    mockBookCount.mockResolvedValueOnce(4).mockResolvedValueOnce(2);

    const answer = await buildCatalogAnswer(
      "STATS",
      "Berapa total buku dan ebook kategori Biologi?",
      "ALL"
    );

    expect(answer.message).toContain("Buku fisik");
    expect(answer.message).toContain("Ebook");
    expect(answer.message).toContain("4 judul");
    expect(answer.message).toContain("2 judul");
  });
});

describe("Fungsi Pembantu catalogAnswer", () => {
  it("buildSingleCategoryAnswer memformat jawaban dengan tepat", () => {
    const res = buildSingleCategoryAnswer("Fisika", 5, "PHYSICAL");
    expect(res.message).toBe(
      "Terdapat **5 judul** buku fisik dalam kategori **Fisika** di katalog DigiLib."
    );
    expect(res.references).toEqual([]);
  });

  it("buildCategoryNotFoundAnswer mencantumkan kategori tersedia", () => {
    const res = buildCategoryNotFoundAnswer("Robotika", ["IPA", "IPS"], "PHYSICAL");
    expect(res.message).toContain("Robotika");
    expect(res.message).toContain("tidak ditemukan");
    expect(res.message).toContain("IPA");
    expect(res.message).toContain("IPS");
  });

  it("buildAmbiguousCategoryAnswer memformat klarifikasi kategori ambigu dengan daftar dan meminta perjelas", () => {
    const res = buildAmbiguousCategoryAnswer("teks", ["Buku Teks Pelajaran", "Buku Teks Kejuruan"], "PHYSICAL");
    expect(res.message).toContain("beberapa kategori");
    expect(res.message).toContain("teks");
    expect(res.message).toContain("Buku Teks Pelajaran");
    expect(res.message).toContain("Buku Teks Kejuruan");
    expect(res.message).toContain("Silakan perjelas");
    expect(res.references).toEqual([]);
  });

  it("buildCategoryAnswer menghasilkan pesan kosong saat kategori kosong", () => {
    const res = buildCategoryAnswer([], "PHYSICAL");
    expect(res.message).toContain("Belum ada data kategori");
  });
});
