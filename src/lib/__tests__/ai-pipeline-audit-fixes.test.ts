/**
 * Regresi audit chatbot — jalur pipeline deterministik.
 *
 * Fokus pengujian:
 *  1. "Siapa yang sedang meminjam?" dijawab dari transaksi aktif (bukan model,
 *     bukan katalog) dan hanya menghitung status aktif.
 *  2. "Siapa yang mempunyai denda?" menampilkan denda nyata dari database,
 *     tanpa memanggil model dan tanpa menganggap kata "mempunyai" sebagai nama.
 *  3. Follow-up "Yang paling lama siapa?" meneruskan urutan EARLIEST ke query
 *     database (borrowDate asc), bukan mengurutkan teks tanggal yang diformat.
 *  4. Pertanyaan jumlah peminjaman aktif dijawab angka dari database.
 *  5. Siswa yang meminta data denda pihak ketiga ditolak deterministik tanpa
 *     menyentuh database transaksi.
 */

const mockFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserCount = jest.fn();
const mockSettingFindMany = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockBorrowCount = jest.fn();
const mockBorrowGroupBy = jest.fn();
const mockBorrowAggregate = jest.fn();
const mockEbookFindMany = jest.fn();
const mockEbookCount = jest.fn();
const mockFineAggregate = jest.fn();
const mockChatWithTools = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockFindUnique, findMany: mockUserFindMany, count: mockUserCount },
    setting: { findMany: mockSettingFindMany },
    borrowRecord: {
      findMany: mockBorrowFindMany,
      count: mockBorrowCount,
      groupBy: mockBorrowGroupBy,
      aggregate: mockBorrowAggregate,
    },
    ebookLoan: {
      findMany: mockEbookFindMany,
      count: mockEbookCount,
      aggregate: jest.fn(),
    },
    finePayment: { aggregate: mockFineAggregate },
    notification: { findMany: jest.fn() },
    book: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    category: { count: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat, chatWithTools: mockChatWithTools }),
  isAIConfigured: () => mockIsConfigured(),
}));

import { processChat, resetRateLimits } from "@/lib/ai/pipeline";
import { extractSearchTerms } from "@/lib/ai/catalog";
import {
  OTHER_USER_FINE_REFUSAL,
  READING_ACTIVITY_ADMIN_ONLY,
  USER_DIRECTORY_LIMITED,
} from "@/lib/ai/personalAnswer";

const USER_ID = "user-1";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-20T04:00:00.000Z");

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

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

function input(content: string, role = "LIBRARIAN") {
  mockFindUnique.mockResolvedValue(account({ role }));
  return { userId: USER_ID, messages: [{ role: "user", content }] };
}

function borrowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "br-1",
    bookId: "book-1",
    status: "BORROWED",
    borrowDate: daysFromNow(-5),
    dueDate: daysFromNow(2),
    returnDate: null,
    book: { id: "book-1", title: "Fisika Dasar", author: "Yohanes Surya", archivedAt: null },
    user: { name: "Budi", role: "STUDENT", class: "XII IPA 1" },
    ...overrides,
  };
}

function olderBorrowRow() {
  return borrowRow({
    id: "br-2",
    bookId: "book-2",
    borrowDate: daysFromNow(-20),
    dueDate: daysFromNow(-10),
    book: { id: "book-2", title: "Bumi Manusia", author: "Pramoedya", archivedAt: null },
    user: { name: "Sari", role: "STUDENT", class: "XI IPA 2" },
  });
}

function fineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "br-fine-1",
    bookId: "book-fine",
    status: "RETURNED",
    borrowDate: daysFromNow(-30),
    dueDate: daysFromNow(-10),
    returnDate: daysFromNow(-8),
    fineAmount: 50000,
    lateFineAmount: 0,
    damageFineAmount: 50000,
    book: { title: "Fisika Dasar", author: "Yohanes Surya" },
    user: { name: "Guru", role: "TEACHER" },
    finePayments: [{ amount: 50000 }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnique.mockResolvedValue(account());
  mockUserFindMany.mockResolvedValue([]);
  mockUserCount.mockResolvedValue(0);
  mockSettingFindMany.mockResolvedValue([]);
  mockBorrowFindMany.mockResolvedValue([]);
  mockBorrowCount.mockResolvedValue(0);
  mockBorrowGroupBy.mockResolvedValue([]);
  mockBorrowAggregate.mockResolvedValue({ _sum: { fineAmount: 0 } });
  mockEbookFindMany.mockResolvedValue([]);
  mockEbookCount.mockResolvedValue(0);
  mockFineAggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
});

afterAll(() => jest.useRealTimers());

describe("pipeline — peminjaman aktif deterministik", () => {
  it("'Siapa yang sedang meminjam?' dijawab dari transaksi DB, bukan model", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Siapa yang sedang meminjam?"));

    expect(result.message).toContain("Budi");
    expect(result.message).toContain("Fisika Dasar");
    expect(result.message).toContain("sedang dipinjam");
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockBorrowFindMany.mock.calls[0][0].where.status.in).toEqual([
      "BORROWED",
      "OVERDUE",
    ]);
  });

  it("follow-up 'Yang paling lama siapa?' memakai urutan EARLIEST di database", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow(), olderBorrowRow()]);
    mockBorrowCount.mockResolvedValue(2);

    const result = await processChat({
      userId: USER_ID,
      messages: [
        { role: "user", content: "Siapa yang sedang meminjam?" },
        { role: "assistant", content: "Ada 2 peminjaman aktif." },
        { role: "user", content: "Yang paling lama siapa?" },
      ],
    });

    expect(result.message).toContain("diurutkan dari peminjaman paling lama");
    expect(result.message).toContain("Bumi Manusia");
    expect(result.message).toContain("Sari");
    // "Paling lama" = tanggal pinjam paling awal, bukan jatuh tempo terdekat.
    expect(mockBorrowFindMany.mock.calls[0][0].orderBy).toEqual({ borrowDate: "asc" });
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("'Berapa peminjaman aktif?' dijawab angka agregat database", async () => {
    mockBorrowCount.mockImplementation((args: { where?: { status?: { in?: string[] } } }) => {
      const statuses = args?.where?.status?.in;
      if (statuses) return Promise.resolve(2);
      return Promise.resolve(0);
    });

    const result = await processChat(input("Berapa peminjaman aktif?"));

    expect(result.message).toMatch(/2 peminjaman buku fisik aktif/i);
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

describe("pipeline — denda operasional deterministik", () => {
  it("'Siapa yang mempunyai denda?' menampilkan denda nyata dari DB", async () => {
    mockBorrowCount.mockResolvedValue(1);
    mockBorrowFindMany.mockResolvedValue([fineRow()]);

    const result = await processChat(input("Siapa yang mempunyai denda?"));

    expect(result.message).toContain("Guru");
    expect(result.message).toContain("Fisika Dasar");
    expect(result.message).toContain("Rp50.000");
    expect(result.message).toContain("lunas");
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockBorrowFindMany).toHaveBeenCalled();
  });

  it("Siswa meminta denda pihak ketiga ditolak tanpa membaca transaksi", async () => {
    mockFindUnique.mockResolvedValue(account({ name: "Siswa", role: "STUDENT" }));

    const result = await processChat({
      userId: "student-1",
      messages: [{ role: "user", content: "Siapa yang mempunyai denda?" }],
    });

    expect(result.message).toBe(OTHER_USER_FINE_REFUSAL);
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(mockBorrowCount).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

describe("pipeline — direktori pengguna berdasarkan role/kelas", () => {
  function adminUserRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "u-1",
      name: "Najla Putri",
      email: "najla@sma.id",
      role: "STUDENT",
      isActive: true,
      identityNumber: "12345",
      class: "XII IPA 1",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("'Siapa administrator?' untuk ADMIN dijawab dari direktori, bukan klarifikasi", async () => {
    mockUserFindMany.mockResolvedValue([
      adminUserRow({ id: "admin-1", name: "Admin DigiLib", email: "admin@sma.id", role: "ADMIN", class: null }),
    ]);
    mockUserCount.mockResolvedValue(1);

    const result = await processChat(input("Siapa administrator?", "ADMIN"));

    expect(result.intent).toBe("USER_DIRECTORY");
    expect(result.message).toContain("Admin DigiLib");
    expect(mockUserFindMany).toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("'Siapa saja siswa kelas XII IPA 1?' memakai filter kelas tanpa search 'kelas xii ipa'", async () => {
    mockUserFindMany.mockResolvedValue([
      adminUserRow(),
      adminUserRow({ id: "u-2", name: "Marza Bulan", email: "marza@sma.id" }),
    ]);
    mockUserCount.mockResolvedValue(2);

    const result = await processChat(input("Siapa saja siswa kelas XII IPA 1?", "ADMIN"));

    expect(result.intent).toBe("USER_DIRECTORY");
    expect(result.message).toContain("Najla Putri");
    expect(result.message).toContain("Marza Bulan");
    const where = mockUserFindMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.role).toBe("STUDENT");
    expect(where.class).toBe("XII IPA 1");
    expect(where.OR).toBeUndefined();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("Pustakawan tidak memperoleh daftar identitas pengguna", async () => {
    const result = await processChat(input("Siapa administrator?", "LIBRARIAN"));

    expect(result.intent).toBe("USER_DIRECTORY");
    expect(result.message).toBe(USER_DIRECTORY_LIMITED);
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("Siswa yang bertanya 'Siapa guru?' ditolak tanpa query direktori", async () => {
    const result = await processChat(input("Siapa guru?", "STUDENT"));

    expect(result.verified).toBe(true);
    expect(result.message).not.toContain("Daftar pengguna DigiLib");
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

describe("pipeline — aktivitas membaca ebook global khusus Admin", () => {
  it("Pustakawan mendapat penolakan spesifik aktivitas membaca, bukan pengaturan sistem", async () => {
    const result = await processChat(input("Aktivitas membaca ebook", "LIBRARIAN"));

    expect(result.message).toBe(READING_ACTIVITY_ADMIN_ONLY);
    expect(result.message).not.toContain("pengaturan sistem");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

describe("pipeline — bahasa sehari-hari dan riwayat per periode", () => {
  it("'perpus' bukan kata kunci judul buku", () => {
    expect(extractSearchTerms("brp buku yg ad di perpus?")).toEqual([]);
    expect(extractSearchTerms("buku fisika di perpustakaan")).toContain("fisika");
    expect(extractSearchTerms("buku fisika di perpustakaan")).not.toContain("perpus");
  });

  it("'pinjaman saya bulan Oktober ada berapa?' dihitung dari periode, bukan pinjaman aktif", async () => {
    mockFindUnique.mockResolvedValue(account({ name: "Siswa", role: "STUDENT" }));
    mockBorrowFindMany.mockResolvedValue([
      {
        bookId: "book-1",
        status: "RETURNED",
        borrowDate: new Date("2026-10-05T03:00:00.000Z"),
        returnDate: new Date("2026-10-12T03:00:00.000Z"),
        book: { title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
      },
    ]);
    mockEbookFindMany.mockResolvedValue([
      {
        bookId: "book-2",
        borrowedAt: new Date("2026-10-06T03:00:00.000Z"),
        expiresAt: new Date("2026-10-13T03:00:00.000Z"),
        returnedAt: null,
        book: { title: "Fisika Dasar (Ebook)", author: "Yohanes Surya" },
      },
    ]);

    const result = await processChat(
      input("pinjaman saya bulan Oktober ada berapa?", "STUDENT")
    );

    expect(result.message).toContain("Oktober 2026");
    expect(result.message).toContain("2** transaksi");
    expect(result.message).toContain("1 buku fisik");
    expect(result.message).toContain("1 ebook");
    expect(result.message).not.toContain("peminjaman aktif");
    expect(mockBorrowFindMany).toHaveBeenCalled();
    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe(USER_ID);
    expect(where.borrowDate.gte.getTime()).toBeLessThan(where.borrowDate.lt.getTime());
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });
});
