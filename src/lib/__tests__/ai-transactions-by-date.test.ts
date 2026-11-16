/**
 * AI Chat — Audit jawaban transaksi per tanggal (kasus 17 Oktober 2026).
 *
 * Data asli (prisma/dev.db, read-only) pada 15–18 Oktober 2026:
 *   - Tanggal PINJAM : 15 Okt, 16 Okt, 18 Okt — TIDAK ADA pada 17 Okt.
 *   - Tanggal KEMBALI: 17 Okt ada 1 ("Bumi Manusia", dipinjam 16 Okt lalu
 *     dikembalikan 17 Okt pukul 09:05 WIB).
 *
 * Dua celah yang ditutup:
 *  1. Pertanyaan PENGEMBALIAN per-tanggal dulu difilter/disajikan menurut tanggal
 *     PINJAM (atau jatuh ke jalur katalog), sehingga dasar tanggalnya salah.
 *  2. Lanjutan singkat bertanggal ("yang 17 Oktober 2026?") dulu diteruskan ke
 *     model, yang bisa menyalin transaksi tanggal lain dan menampilkannya seolah
 *     17 Oktober.
 *
 * Perbaikan: setiap pertanyaan transaksi per-tanggal dijawab deterministik dari
 * database, memakai dasar tanggal yang tepat (pinjam vs kembali), dan menyatakan
 * jujur saat kosong/gagal.
 */

const mockFindUnique = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockBorrowCount = jest.fn();
const mockEbookFindMany = jest.fn();
const mockChatWithTools = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);
const mockBuildPersonalAnswer = jest.fn();
const mockBuildCatalogAnswer = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockFindUnique },
    borrowRecord: { findMany: mockBorrowFindMany, count: mockBorrowCount },
    ebookLoan: { findMany: mockEbookFindMany },
  },
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat, chatWithTools: mockChatWithTools }),
  isAIConfigured: () => mockIsConfigured(),
}));

jest.mock("@/lib/ai/personal", () => ({
  buildPersonalAnswer: (...args: unknown[]) => mockBuildPersonalAnswer(...args),
}));

jest.mock("@/lib/ai/catalog", () => {
  const actual = jest.requireActual("@/lib/ai/catalog");
  return { ...actual, buildCatalogAnswer: (...args: unknown[]) => mockBuildCatalogAnswer(...args) };
});

import { processChat, resetRateLimits } from "@/lib/ai/pipeline";
import {
  OPERATIONAL_BORROWS_UNAVAILABLE,
  OTHER_USER_REFUSAL,
} from "@/lib/ai/personalAnswer";

const USER_ID = "user-staff-ai";

/** Rentang hari 17 Oktober 2026 menurut Asia/Jakarta (UTC+7). */
const DAY_17 = {
  gte: "2026-10-16T17:00:00.000Z",
  lt: "2026-10-17T17:00:00.000Z",
};

function account(overrides: Record<string, unknown> = {}) {
  return {
    name: "Budi Pustakawan",
    role: "LIBRARIAN",
    gender: "MALE",
    class: null,
    isActive: true,
    ...overrides,
  };
}

function input(content: string) {
  return { userId: USER_ID, messages: [{ role: "user", content }] };
}

function conversation(...contents: string[]) {
  return {
    userId: USER_ID,
    messages: contents.map((content, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content,
    })),
  };
}

function borrowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "br-17",
    bookId: "book-bumi",
    status: "RETURNED",
    borrowDate: new Date("2026-10-16T02:57:13.734Z"), // 16 Okt 09:57 WIB
    dueDate: new Date("2026-10-23T02:57:13.734Z"),
    returnDate: new Date("2026-10-17T02:05:51.755Z"), // 17 Okt 09:05 WIB
    book: { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer", archivedAt: null },
    user: { name: "Siswa Rajin", role: "STUDENT" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnique.mockResolvedValue(account());
  mockBuildPersonalAnswer.mockResolvedValue({ message: "jawaban pribadi", references: [] });
  mockBuildCatalogAnswer.mockResolvedValue({ message: "jawaban katalog", references: [] });
  mockBorrowFindMany.mockResolvedValue([]);
  mockBorrowCount.mockResolvedValue(0);
  mockEbookFindMany.mockResolvedValue([]);
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
});

describe("17 Oktober 2026 — transaksi hanya pada tanggal yang benar", () => {
  it("pertanyaan peminjaman 17 Okt kosong dijawab jujur, bukan mengambil tanggal lain", async () => {
    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 17 Oktober 2026?")
    );

    expect(result.message).toContain("Tidak ada transaksi peminjaman");
    expect(result.message).toContain("17 Oktober 2026");
    expect(result.message).not.toContain("Najla");
    expect(result.message).not.toContain("Siswa Rajin");
    expect(mockChatWithTools).not.toHaveBeenCalled();

    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.borrowDate.gte.toISOString()).toBe(DAY_17.gte);
    expect(where.borrowDate.lt.toISOString()).toBe(DAY_17.lt);
  });

  it("filter tanggal dijalankan di level database: baris 15/16/18 Okt tidak bocor ke 17 Okt", async () => {
    const rows = [
      borrowRow({ id: "b15", borrowDate: new Date("2026-10-15T02:00:00.000Z"), returnDate: null,
        book: { id: "bk15", title: "Buku 15 Okt", author: "A", archivedAt: null },
        user: { name: "Orang 15", role: "STUDENT" } }),
      borrowRow({ id: "b16", borrowDate: new Date("2026-10-16T02:57:13.734Z"), returnDate: null,
        book: { id: "bk16", title: "Buku 16 Okt", author: "A", archivedAt: null },
        user: { name: "Orang 16", role: "STUDENT" } }),
      borrowRow({ id: "b18", borrowDate: new Date("2026-10-18T03:32:57.066Z"), returnDate: null,
        book: { id: "bk18", title: "Buku 18 Okt", author: "A", archivedAt: null },
        user: { name: "Orang 18", role: "STUDENT" } }),
    ];

    type WhereArg = { where: { borrowDate: { gte: Date; lt: Date } } };
    mockBorrowFindMany.mockImplementation(({ where }: WhereArg) =>
      Promise.resolve(
        rows.filter((r) => r.borrowDate >= where.borrowDate.gte && r.borrowDate < where.borrowDate.lt)
      )
    );

    const result = await processChat(
      input("Tampilkan transaksi peminjaman pada tanggal 17 Oktober 2026")
    );

    expect(result.message).toContain("Tidak ada transaksi peminjaman");
    expect(result.message).not.toContain("Orang 15");
    expect(result.message).not.toContain("Orang 16");
    expect(result.message).not.toContain("Orang 18");
  });

  it("pengembalian 17 Okt memakai TANGGAL KEMBALI, bukan tanggal pinjam", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);

    const result = await processChat(
      input("Siapa yang mengembalikan buku pada tanggal 17 Oktober 2026?")
    );

    expect(result.message).toContain("pengembalian");
    expect(result.message).toContain("Siswa Rajin");
    expect(result.message).toContain("Bumi Manusia");
    expect(result.message).toContain("dikembalikan pukul 09:05 WIB");
    expect(result.message).toContain("sudah dikembalikan");
    expect(mockChatWithTools).not.toHaveBeenCalled();

    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.returnDate.gte.toISOString()).toBe(DAY_17.gte);
    expect(where.returnDate.lt.toISOString()).toBe(DAY_17.lt);
    expect(where.borrowDate).toBeUndefined();
  });

  it("lanjutan singkat 'yang 17 Oktober 2026?' dijawab deterministik, bukan oleh model", async () => {
    const result = await processChat(
      conversation(
        "tampilkan transaksi terbaru",
        "Berikut transaksi terbaru...",
        "kalau tanggal 17 Oktober 2026?"
      )
    );

    expect(result.message).toContain("Tidak ada transaksi peminjaman");
    expect(result.message).toContain("17 Oktober 2026");
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

describe("Status dari record aktual (bukan diasumsikan 'sedang dipinjam')", () => {
  it("baris yang sudah dikembalikan tidak dilabeli 'sedang dipinjam'", async () => {
    mockBorrowFindMany.mockResolvedValue([
      borrowRow({
        id: "aktif",
        status: "BORROWED",
        returnDate: null,
        dueDate: new Date("2027-01-31T03:00:00.000Z"),
        book: { id: "b-aktif", title: "Buku Aktif", author: "A", archivedAt: null },
        user: { name: "Aktif", role: "STUDENT" },
      }),
      borrowRow({
        id: "kembali",
        status: "RETURNED",
        book: { id: "b-kembali", title: "Buku Kembali", author: "B", archivedAt: null },
        user: { name: "Kembali", role: "STUDENT" },
      }),
    ]);

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 17 Oktober 2026?")
    );

    expect(result.message).toContain("sedang dipinjam");
    expect(result.message).toContain("sudah dikembalikan");
    // Baris "Kembali" tidak boleh disajikan sebagai sedang dipinjam.
    expect(result.message).not.toMatch(/Kembali.*sedang dipinjam/);
  });

  it("pinjaman yang belum kembali dan lewat jatuh tempo dilabeli terlambat", async () => {
    mockBorrowFindMany.mockResolvedValue([
      borrowRow({
        id: "overdue",
        status: "BORROWED",
        returnDate: null,
        dueDate: new Date("2026-10-17T01:00:00.000Z"), // sudah lewat
        book: { id: "b-ovd", title: "Buku Telat", author: "C", archivedAt: null },
        user: { name: "Terlambat", role: "STUDENT" },
      }),
    ]);

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 17 Oktober 2026?")
    );

    expect(result.message).toContain("terlambat (belum dikembalikan)");
  });
});

describe("Sumber data valid, tahan gagal, dan privasi", () => {
  it("nama, judul, jam, dan referensi berasal dari record yang valid", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow({ status: "BORROWED", returnDate: null })]);

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 16 Oktober 2026?")
    );

    expect(result.message).toContain("Siswa Rajin");
    expect(result.message).toContain("Bumi Manusia");
    expect(result.message).toContain("09:57 WIB");
    expect(result.references.map((r) => r.id)).toContain("book-bumi");
  });

  it("kegagalan query dinyatakan sebagai keterbatasan, bukan 'tidak ada'", async () => {
    mockBorrowFindMany.mockRejectedValue(new Error("db down"));

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 17 Oktober 2026?")
    );

    expect(result.message).toBe(OPERATIONAL_BORROWS_UNAVAILABLE);
    expect(result.message).not.toContain("Tidak ada transaksi");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("Siswa tidak bisa memperoleh riwayat peminjaman pengguna lain", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "STUDENT" }));

    const result = await processChat(
      input("Siapa yang mengembalikan buku pada tanggal 17 Oktober 2026?")
    );

    expect(result.message).toBe(OTHER_USER_REFUSAL);
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(mockEbookFindMany).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("tanggal parsial diminta dilengkapi tanpa menyentuh database", async () => {
    const result = await processChat(
      input("Siapa yang mengembalikan buku pada tanggal 17?")
    );

    expect(result.message).toContain("tanpa bulan dan tahun");
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(mockEbookFindMany).not.toHaveBeenCalled();
  });

  it("A2: ebook dengan masa akses berakhir tidak dilabeli 'sedang dibaca'", async () => {    const past = new Date("2026-10-17T02:00:00.000Z");
    const future = new Date("2030-01-01T00:00:00.000Z");
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el-exp",
        bookId: "eb-exp",
        status: "ACTIVE", // kolom belum diperbarui (lazy)
        borrowedAt: past,
        expiresAt: past, // masa akses sudah berakhir
        returnedAt: null,
        book: { id: "eb-exp", title: "Ebook Kedaluwarsa", author: "A", archivedAt: null },
        user: { name: "Siswa Rajin", role: "STUDENT" },
      },
      {
        id: "el-act",
        bookId: "eb-act",
        status: "ACTIVE",
        borrowedAt: past,
        expiresAt: future,
        returnedAt: null,
        book: { id: "eb-act", title: "Ebook Aktif", author: "B", archivedAt: null },
        user: { name: "Siswa Rajin", role: "STUDENT" },
      },
    ]);

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 17 Oktober 2026?")
    );

    expect(result.message).toContain("Ebook Kedaluwarsa");
    expect(result.message).toContain("kedaluwarsa");
    expect(result.message).toMatch(/Ebook Aktif.*masa akses aktif/);
    expect(result.message).not.toMatch(/Ebook Aktif.*sedang dibaca/);
    expect(result.message).not.toMatch(/Ebook Kedaluwarsa.*masa akses aktif/);
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});
