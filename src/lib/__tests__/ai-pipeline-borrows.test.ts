/**
 * AI Chat — Pertanyaan "siapa yang meminjam pada tanggal X" (Pustakawan/Admin).
 *
 * Bug yang diuji (Kasus A/B/C):
 *  - "hari ini" salah dijawab kosong / jam dilaporkan sebagai UTC;
 *  - model mengarang nama peminjam & judul buku karena tidak ada tool ber-filter
 *    tanggal.
 *
 * Perbaikan: pipeline menjawab deterministik dari transaksi pada rentang hari
 * Asia/Jakarta, menampilkan jam WIB, dan menyatakan jujur saat kosong/gagal.
 * Semua tanggal di sini eksplisit (18 Oktober 2026 / 15 Oktober 2026) agar hasil
 * tidak bergantung pada jam berjalannya pengujian.
 */

const mockFindUnique = jest.fn();
const mockUserCount = jest.fn();
const mockSettingFindMany = jest.fn();
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
    user: { findUnique: mockFindUnique, count: mockUserCount },
    setting: { findMany: mockSettingFindMany },
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
  LIBRARIAN_NOT_A_BORROWER,
  OPERATIONAL_BORROWS_UNAVAILABLE,
  OTHER_USER_REFUSAL,
} from "@/lib/ai/personalAnswer";

const USER_ID = "user-admin";

function account(overrides: Record<string, unknown> = {}) {
  return {
    name: "Pustakawan Satu",
    role: "LIBRARIAN",
    gender: "FEMALE",
    class: null,
    isActive: true,
    ...overrides,
  };
}

function input(content: string) {
  return { userId: USER_ID, messages: [{ role: "user", content }] };
}

/** Baris BorrowRecord seperti hasil prisma.borrowRecord.findMany. */
function borrowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "br1",
    bookId: "book-bumi",
    status: "RETURNED",
    borrowDate: new Date("2026-10-18T03:32:57.066Z"), // 10:32 WIB
    dueDate: new Date("2026-10-25T03:32:57.066Z"),
    returnDate: null,
    book: { id: "book-bumi", title: "Bumi Manusia", author: "Pramoedya Ananta Toer", archivedAt: null },
    user: { name: "Najla", role: "STUDENT" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
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

afterAll(() => jest.useRealTimers());

describe("processChat() — peminjam per tanggal (deterministik, tanpa model)", () => {
  it("Kasus B: tanggal 18 Oktober menampilkan transaksi DB dengan jam WIB (bukan UTC)", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 18 Oktober 2026?")
    );

    expect(result.message).toContain("Najla");
    expect(result.message).toContain("Bumi Manusia");
    expect(result.message).toContain("10:32 WIB");
    // Jam UTC mentah (03:32) tidak boleh bocor ke jawaban.
    expect(result.message).not.toContain("03:32");
    expect(result.message).not.toContain("Z");
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockBuildCatalogAnswer).not.toHaveBeenCalled();
    // Query difilter ke rentang hari Asia/Jakarta.
    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.borrowDate.gte.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(where.borrowDate.lt.toISOString()).toBe("2026-10-18T17:00:00.000Z");
  });

  it("Kasus C: tanggal 15 Oktober yang kosong dijawab jujur, bukan mengarang nama", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookFindMany.mockResolvedValue([]);

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 15 Oktober 2026?")
    );

    expect(result.message).toContain("Tidak ada transaksi peminjaman");
    expect(result.message).toContain("15 Oktober 2026");
    expect(result.message).not.toContain("Najla");
    expect(result.message).not.toContain("Dasar-Dasar Pemrograman");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("riwayat buku yang sudah diarsipkan tetap ditampilkan dan ditandai", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "book-pem",
        status: "RETURNED",
        borrowedAt: new Date("2026-10-15T08:17:39.490Z"), // 15:17 WIB
        book: {
          id: "book-pem",
          title: "Dasar-Dasar Pemrograman (Ebook)",
          author: "Tim Penulis",
          archivedAt: new Date("2026-10-15T09:17:39.490Z"),
        },
        user: { name: "Siswa Rajin", role: "STUDENT" },
      },
    ]);

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 15 Oktober 2026?")
    );

    expect(result.message).toContain("Dasar-Dasar Pemrograman (Ebook)");
    expect(result.message).toContain("Siswa Rajin");
    expect(result.message).toContain("15:17 WIB");
    expect(result.message).toContain("arsip");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("Kasus A: 'hari ini' memakai rentang hari Jakarta (bukan UTC)", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-18T04:00:00.000Z"));
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);

    const result = await processChat(input("Siapa yang meminjam buku hari ini?"));

    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.borrowDate.gte.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(where.borrowDate.lt.toISOString()).toBe("2026-10-18T17:00:00.000Z");
    expect(result.message).toContain("18 Oktober 2026");
    expect(result.message).toContain("Najla");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("batas hari Jakarta: transaksi 23:59 dan 00:00 WIB masuk, di luar rentang keluar", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-18T04:00:00.000Z"));

    const rows = [
      borrowRow({
        id: "before",
        borrowDate: new Date("2026-10-17T16:59:00.000Z"), // 17 Okt 23:59 WIB
        book: { id: "b-before", title: "Sebelum Batas", author: "A", archivedAt: null },
        user: { name: "Orang Sebelum", role: "STUDENT" },
      }),
      borrowRow({
        id: "start",
        borrowDate: new Date("2026-10-17T17:00:00.000Z"), // 18 Okt 00:00 WIB
        book: { id: "b-start", title: "Awal Batas", author: "A", archivedAt: null },
        user: { name: "Orang Awal", role: "STUDENT" },
      }),
      borrowRow({
        id: "end",
        borrowDate: new Date("2026-10-18T16:59:00.000Z"), // 18 Okt 23:59 WIB
        book: { id: "b-end", title: "Akhir Batas", author: "A", archivedAt: null },
        user: { name: "Orang Akhir", role: "STUDENT" },
      }),
      borrowRow({
        id: "after",
        borrowDate: new Date("2026-10-18T17:00:00.000Z"), // 19 Okt 00:00 WIB
        book: { id: "b-after", title: "Sesudah Batas", author: "A", archivedAt: null },
        user: { name: "Orang Sesudah", role: "STUDENT" },
      }),
    ];

    // Simulasikan filter Prisma: hanya transaksi di dalam [gte, lt).
    type WhereArg = { where: { borrowDate: { gte: Date; lt: Date } } };
    mockBorrowFindMany.mockImplementation(({ where }: WhereArg) =>
      Promise.resolve(
        rows.filter((r) => r.borrowDate >= where.borrowDate.gte && r.borrowDate < where.borrowDate.lt)
      )
    );

    const result = await processChat(input("Siapa yang meminjam buku hari ini?"));

    expect(result.message).toContain("Orang Awal");
    expect(result.message).toContain("Orang Akhir");
    expect(result.message).toContain("00:00 WIB");
    expect(result.message).toContain("23:59 WIB");
    expect(result.message).not.toContain("Sebelum Batas");
    expect(result.message).not.toContain("Sesudah Batas");
    expect(result.message).toContain("Total 2 transaksi");
  });

  it("query gagal menyatakan keterbatasan, bukan 'tidak ada transaksi'", async () => {
    mockBorrowFindMany.mockRejectedValue(new Error("db down"));

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 18 Oktober 2026?")
    );

    expect(result.message).toBe(OPERATIONAL_BORROWS_UNAVAILABLE);
    expect(result.message).not.toContain("Tidak ada transaksi");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("tanggal parsial ('tanggal 18') diminta dilengkapi, tanpa menyentuh DB", async () => {
    const result = await processChat(input("Siapa yang meminjam buku pada tanggal 18?"));

    expect(result.message).toContain("tanpa bulan dan tahun");
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(mockEbookFindMany).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("menggabungkan peminjaman fisik dan ebook pada tanggal yang sama", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);
    mockEbookFindMany.mockResolvedValue([
      {
        id: "el1",
        bookId: "book-fisika-e",
        status: "RETURNED",
        borrowedAt: new Date("2026-10-18T04:05:00.000Z"), // 11:05 WIB
        book: { id: "book-fisika-e", title: "Fisika Dasar (Ebook)", author: "Yohanes", archivedAt: null },
        user: { name: "Najla", role: "STUDENT" },
      },
    ]);

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 18 Oktober 2026?")
    );

    expect(result.message).toContain("Bumi Manusia");
    expect(result.message).toContain("Fisika Dasar (Ebook)");
    expect(result.message).toContain("11:05 WIB");
    expect(result.message).toContain("Total 2 transaksi");
    expect(result.references.length).toBeGreaterThanOrEqual(2);
  });

  it("peminjaman yang belum disetujui/ditolak tidak dihitung (filter status di query)", async () => {
    mockBorrowFindMany.mockResolvedValue([]);

    await processChat(input("Siapa yang meminjam buku pada tanggal 18 Oktober 2026?"));

    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["BORROWED", "OVERDUE", "RETURNED"] });
  });
});

describe("processChat() — batas akses peminjam per tanggal", () => {
  it("STUDENT ditolak sebelum handler DB dijalankan", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "STUDENT" }));

    const result = await processChat(
      input("Siapa yang meminjam buku pada tanggal 18 Oktober 2026?")
    );

    expect(result.message).toBe(OTHER_USER_REFUSAL);
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(mockEbookFindMany).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

describe("processChat() — peminjam & aktivitas baca ebook (Pustakawan/Admin)", () => {
  function activeEbook(overrides: Record<string, unknown> = {}) {
    return {
      id: "el-aktif",
      bookId: "eb-fisika",
      status: "ACTIVE", // kolom bisa tertinggal; status sebenarnya dari timestamp
      borrowedAt: new Date("2026-10-20T02:00:00.000Z"),
      expiresAt: new Date(Date.now() + 3 * 86400000),
      returnedAt: null,
      book: { id: "eb-fisika", title: "Fisika Dasar (Ebook)", author: "Yohanes Surya" },
      user: { name: "Siswa Rajin", role: "STUDENT" },
      ...overrides,
    };
  }

  it("LIBRARIAN: 'Siapa yang sedang membaca ebook?' dijawab jujur dari masa akses, bukan klaim baca", async () => {
    mockEbookFindMany.mockResolvedValue([activeEbook()]);

    const result = await processChat(input("Siapa yang sedang membaca ebook?"));

    expect(result.message).toContain("dicatat melalui sesi reader");
    expect(result.message).toContain("Siswa Rajin");
    expect(result.message).toContain("Fisika Dasar (Ebook)");
    expect(result.message).toContain("masa akses aktif");
    expect(result.message).not.toMatch(/Siswa Rajin sedang membaca/);
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockBuildPersonalAnswer).not.toHaveBeenCalled();
    // Filter status memakai timestamp, bukan kolom status yang lazy.
    const where = mockEbookFindMany.mock.calls[0][0].where;
    expect(where.returnedAt).toBeNull();
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it("LIBRARIAN: 'Siapa yang sedang meminjam ebook?' menampilkan pemegang masa akses", async () => {
    mockEbookFindMany.mockResolvedValue([activeEbook()]);

    const result = await processChat(input("Siapa yang sedang meminjam ebook?"));

    expect(result.message).toContain("Peminjaman ebook dengan masa akses aktif");
    expect(result.message).toContain("Total 1 peminjaman ebook aktif");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("filter judul opsional: hanya ebook yang cocok yang ditampilkan", async () => {
    mockEbookFindMany.mockResolvedValue([
      activeEbook(),
      activeEbook({
        id: "el-biologi",
        bookId: "eb-biologi",
        book: { id: "eb-biologi", title: "Biologi Dasar (Ebook)", author: "Siti Aminah" },
      }),
    ]);

    const result = await processChat(input("Siapa yang sedang membaca ebook Biologi?"));

    expect(result.message).toContain("Biologi Dasar (Ebook)");
    expect(result.message).not.toContain("Fisika Dasar (Ebook)");
    expect(result.message).toContain("Total 1 peminjaman ebook aktif");
  });

  it("STUDENT ditolak sebelum query ebook dijalankan", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "STUDENT" }));

    const result = await processChat(input("Siapa yang sedang membaca ebook?"));

    expect(result.message).toBe(OTHER_USER_REFUSAL);
    expect(mockEbookFindMany).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("query gagal menyatakan keterbatasan, bukan 'tidak ada'", async () => {
    mockEbookFindMany.mockRejectedValue(new Error("db down"));

    const result = await processChat(input("Siapa yang sedang membaca ebook?"));

    expect(result.message).toBe(OPERATIONAL_BORROWS_UNAVAILABLE);
    expect(result.message).not.toContain("Tidak ada peminjaman ebook");
  });
});

describe("processChat() — riwayat vs masa akses aktif ebook (Pustakawan/Admin)", () => {
  function ebookLoanRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "el-history",
      bookId: "eb-fisika",
      userId: "user-siswa",
      status: "ACTIVE", // kolom bisa tertinggal; status sebenarnya dari timestamp
      borrowedAt: new Date("2026-10-20T02:00:00.000Z"),
      expiresAt: new Date("2030-10-29T02:00:00.000Z"),
      returnedAt: null,
      book: { id: "eb-fisika", title: "Fisika Dasar (Ebook)", author: "Yohanes Surya" },
      user: { name: "Siswa Rajin", role: "STUDENT" },
      ...overrides,
    };
  }

  it("LIBRARIAN: 'Riwayat peminjaman ebook' memakai semua status, bukan pesan bukan-peminjam", async () => {
    mockEbookFindMany.mockResolvedValue([
      ebookLoanRow(),
      ebookLoanRow({
        id: "el-returned",
        bookId: "eb-biologi",
        book: { id: "eb-biologi", title: "Biologi Dasar (Ebook)", author: "Siti Aminah" },
        status: "RETURNED",
        returnedAt: new Date("2026-10-21T02:00:00.000Z"),
      }),
    ]);

    const result = await processChat(input("Riwayat peminjaman ebook"));

    expect(result.message).toContain("Riwayat peminjaman ebook (semua status");
    expect(result.message).toContain("Siswa Rajin");
    expect(result.message).toContain("Fisika Dasar (Ebook)");
    expect(result.message).toContain("Biologi Dasar (Ebook)");
    expect(result.message).toContain("masa akses aktif");
    expect(result.message).toContain("sudah dikembalikan");
    expect(result.message).not.toBe(LIBRARIAN_NOT_A_BORROWER);
    expect(mockBuildPersonalAnswer).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
    // Semua status: tidak memfilter returnedAt/expiresAt.
    const where = mockEbookFindMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });

  it("ADMIN: 'Semua peminjaman ebook' bukan hanya masa akses aktif", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "ADMIN" }));
    mockEbookFindMany.mockResolvedValue([ebookLoanRow()]);

    const result = await processChat(input("Semua peminjaman ebook"));

    expect(result.message).toContain("Riwayat peminjaman ebook (semua status");
    expect(result.message).not.toBe(LIBRARIAN_NOT_A_BORROWER);
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("'Peminjaman ebook aktif' tetap memakai jalur masa akses aktif", async () => {
    mockEbookFindMany.mockResolvedValue([ebookLoanRow()]);

    const result = await processChat(input("Peminjaman ebook aktif"));

    expect(result.message).toContain("Peminjaman ebook dengan masa akses aktif");
    expect(result.message).not.toContain("Riwayat peminjaman ebook");
    const where = mockEbookFindMany.mock.calls[0][0].where;
    expect(where.returnedAt).toBeNull();
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it("STUDENT tetap mendapat riwayat pribadi, bukan data operasional", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "STUDENT" }));

    const result = await processChat(input("Riwayat peminjaman ebook"));

    expect(result.message).toBe("jawaban pribadi");
    expect(mockBuildPersonalAnswer).toHaveBeenCalled();
    expect(mockEbookFindMany).not.toHaveBeenCalled();
  });
});

/** Baris BorrowRecord overdue seperti hasil prisma.borrowRecord.findMany (tool). */
function overdueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ov1",
    bookId: "book-fisika",
    status: "BORROWED",
    borrowDate: new Date("2026-09-24T00:00:00.000Z"),
    dueDate: new Date("2026-10-01T00:00:00.000Z"), // 07:00 WIB
    returnDate: null,
    book: {
      id: "book-fisika",
      title: "Fisika Dasar untuk SMA",
      author: "Yohanes Surya",
      archivedAt: null,
    },
    user: { name: "Budi", role: "STUDENT", class: null },
    ...overrides,
  };
}

describe("processChat() — keterlambatan global (Pustakawan/Admin)", () => {
  it("LIBRARIAN: 'Buku apa saja yang sedang terlambat?' dijawab dari DB (bukan pinjaman pribadi)", async () => {
    mockBorrowFindMany.mockResolvedValue([overdueRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Buku apa saja yang sedang terlambat?"));

    expect(result.intent).toBe("OPERATIONAL");
    expect(result.message).toContain("Budi");
    expect(result.message).toContain("Fisika Dasar untuk SMA");
    expect(result.message).toContain("07:00 WIB");
    expect(result.message).toContain("Total 1 peminjaman terlambat");
    // Bukan jalur pribadi, bukan jalur model.
    expect(mockBuildPersonalAnswer).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("baris BORROWED yang lewat jatuh tempo dilabeli 'terlambat', bukan 'sedang dipinjam'", async () => {
    mockBorrowFindMany.mockResolvedValue([overdueRow()]); // status BORROWED
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Buku apa saja yang sedang terlambat?"));

    expect(result.message).toContain("terlambat (belum dikembalikan)");
    // Regresi: judul daftar "terlambat" tidak boleh disertai status "sedang dipinjam".
    expect(result.message).not.toContain("sedang dipinjam");
  });

  it("ADMIN mendapat daftar keterlambatan yang sama", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "ADMIN" }));
    mockBorrowFindMany.mockResolvedValue([overdueRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Siapa saja yang terlambat mengembalikan buku?"));

    expect(result.intent).toBe("OPERATIONAL");
    expect(result.message).toContain("Budi");
    expect(mockBuildPersonalAnswer).not.toHaveBeenCalled();
  });

  it("variasi 'Tampilkan semua peminjaman terlambat.' juga operasional", async () => {
    mockBorrowFindMany.mockResolvedValue([overdueRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Tampilkan semua peminjaman terlambat."));

    expect(result.message).toContain("Fisika Dasar untuk SMA");
    expect(mockBuildPersonalAnswer).not.toHaveBeenCalled();
  });

  it("STUDENT tetap memakai jalur personal (bukan data seluruh sistem)", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "STUDENT" }));

    const result = await processChat(input("Buku apa saja yang sedang terlambat?"));

    expect(result.intent).toBe("MY_LOANS");
    expect(result.message).toBe("jawaban pribadi");
    expect(mockBuildPersonalAnswer).toHaveBeenCalled();
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("TEACHER juga tetap pada kebijakan personal", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "TEACHER" }));

    const result = await processChat(input("Buku apa saja yang sedang terlambat?"));

    expect(result.intent).toBe("MY_LOANS");
    expect(mockBuildPersonalAnswer).toHaveBeenCalled();
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("Pustakawan bertanya soal keterlambatan SENDIRI dijawab pesan peran non-peminjam", async () => {
    const result = await processChat(input("Apakah saya punya buku yang terlambat?"));

    expect(result.intent).toBe("MY_LOANS");
    expect(result.message).toBe(LIBRARIAN_NOT_A_BORROWER);
    expect(mockBuildPersonalAnswer).not.toHaveBeenCalled();
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("hasil kosong dinyatakan jujur 'tidak ada' (bukan error)", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockBorrowCount.mockResolvedValue(0);

    const result = await processChat(input("Buku apa saja yang sedang terlambat?"));

    expect(result.message).toContain("Tidak ada peminjaman yang sedang terlambat");
    expect(result.message).not.toContain("belum dapat diakses");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("kegagalan query dinyatakan sebagai keterbatasan, bukan 'tidak ada'", async () => {
    mockBorrowFindMany.mockRejectedValue(new Error("db down"));

    const result = await processChat(input("Buku apa saja yang sedang terlambat?"));

    expect(result.message).toBe(OPERATIONAL_BORROWS_UNAVAILABLE);
    expect(result.message).not.toContain("Tidak ada");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("buku arsip dengan keterlambatan tetap ditampilkan dan ditandai", async () => {
    mockBorrowFindMany.mockResolvedValue([
      overdueRow({
        book: {
          id: "book-arsip",
          title: "Dasar-Dasar Pemrograman",
          author: "Tim Penulis",
          archivedAt: new Date("2026-10-15T09:17:39.490Z"),
        },
      }),
    ]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Buku apa saja yang sedang terlambat?"));

    expect(result.message).toContain("Dasar-Dasar Pemrograman");
    expect(result.message).toContain("arsip");
    expect(result.references.map((r) => r.id)).toContain("book-arsip");
  });

  it("jam pada hasil memakai WIB, tanpa UTC mentah", async () => {
    mockBorrowFindMany.mockResolvedValue([overdueRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Buku apa saja yang sedang terlambat?"));

    expect(result.message).toContain("WIB");
    expect(result.message).not.toMatch(/T\d{2}:\d{2}/);
    expect(result.message).not.toContain("Z");
  });
});
