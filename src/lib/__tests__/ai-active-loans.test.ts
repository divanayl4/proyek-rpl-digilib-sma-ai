/**
 * AI Chat — Peminjaman AKTIF (belum dikembalikan).
 *
 * Bug yang diuji:
 *  - "buku apa saja yang sedang dipinjam" / "peminjaman yang belum dikembalikan"
 *    dianggap pencarian KATALOG sehingga dijawab "tidak ada di katalog" padahal
 *    transaksi peminjaman ada di database;
 *  - "belum selesai" salah dibaca sebagai riwayat karena kata "selesai";
 *  - "siapa yang belum mengembalikan buku" tidak dikenali sebagai data pihak
 *    ketiga (bisa bocor ke data pribadi penanya).
 *
 * Kontrak yang diuji:
 *  - Pertanyaan transaksi dijawab dari BorrowRecord/EbookLoan, bukan katalog.
 *  - Hanya transaksi BORROWED/OVERDUE (fisik) dan ebook dengan masa akses
 *    berlaku yang dihitung aktif; RETURNED/REQUESTED tidak.
 *  - Data ditemukan / kosong / query gagal dibedakan tegas.
 *  - RBAC: Siswa hanya data sendiri; permintaan data orang lain ditolak;
 *    Pustakawan/Admin mendapat data global.
 *  - Payload tool memuat ID transaksi, media, status, tanggal, keterlambatan,
 *    dan identitas peminjam.
 */

const mockFindUnique = jest.fn();
const mockSettingFindMany = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockBorrowCount = jest.fn();
const mockBorrowGroupBy = jest.fn();
const mockEbookFindMany = jest.fn();
const mockEbookCount = jest.fn();
const mockChatWithTools = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockFindUnique, count: jest.fn() },
    setting: { findMany: mockSettingFindMany },
    borrowRecord: {
      findMany: mockBorrowFindMany,
      count: mockBorrowCount,
      groupBy: mockBorrowGroupBy,
    },
    ebookLoan: { findMany: mockEbookFindMany, count: mockEbookCount },
    finePayment: { aggregate: jest.fn() },
    notification: { findMany: jest.fn() },
    book: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    category: { count: jest.fn() },
  },
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat, chatWithTools: mockChatWithTools }),
  isAIConfigured: () => mockIsConfigured(),
}));

import { processChat, resetRateLimits } from "@/lib/ai/pipeline";
import { executeTool } from "@/lib/ai/tools";
import { detectIntent, isGlobalActiveLoansQuery } from "@/lib/ai/intent";
import {
  OPERATIONAL_BORROWS_UNAVAILABLE,
  OTHER_USER_REFUSAL,
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

function overdueRow(overrides: Record<string, unknown> = {}) {
  return borrowRow({
    id: "br-late",
    bookId: "book-late",
    status: "BORROWED",
    dueDate: daysFromNow(-4),
    book: { id: "book-late", title: "Biologi Terlambat", author: "Siti", archivedAt: null },
    user: { name: "Sari", role: "STUDENT", class: "XI IPA 2" },
    ...overrides,
  });
}

function ebookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "el-1",
    bookId: "eb-1",
    status: "ACTIVE",
    borrowedAt: daysFromNow(-2),
    expiresAt: daysFromNow(5),
    returnedAt: null,
    book: { id: "eb-1", title: "Matematika Digital", author: "Tim Penulis" },
    user: { name: "Dewi", role: "STUDENT", class: "X" },
    ...overrides,
  };
}

/** Jadikan mock findMany menghormati filter status aktif seperti query Prisma. */
function mockPhysicalActiveOnly(rows: Array<Record<string, unknown>>) {
  mockBorrowFindMany.mockImplementation((args: { where?: { status?: { in?: string[] } } }) => {
    const statuses = args?.where?.status?.in;
    if (!statuses) return Promise.resolve(rows);
    return Promise.resolve(rows.filter((row) => statuses.includes(String(row.status))));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnique.mockResolvedValue(account());
  mockSettingFindMany.mockResolvedValue([]);
  mockBorrowFindMany.mockResolvedValue([]);
  mockBorrowCount.mockResolvedValue(0);
  mockBorrowGroupBy.mockResolvedValue([]);
  mockEbookFindMany.mockResolvedValue([]);
  mockEbookCount.mockResolvedValue(0);
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
});

afterAll(() => jest.useRealTimers());

describe("processChat() — peminjaman aktif dari TRANSAKSI, bukan katalog", () => {
  it("Pustakawan: 'Buku apa saja yang sedang dipinjam?' dijawab dari transaksi nyata", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Buku apa saja yang sedang dipinjam?"));

    expect(result.message).toContain("Fisika Dasar");
    expect(result.message).toContain("Budi");
    expect(result.message).toContain("sedang dipinjam");
    // Kata "buku" TIDAK boleh membelokkan pertanyaan ke katalog.
    expect(result.message.toLowerCase()).not.toContain("katalog");
    expect(mockChatWithTools).not.toHaveBeenCalled();
    // Query transaksi dibatasi status aktif, bukan seluruh katalog.
    const where = mockBorrowFindMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(["BORROWED", "OVERDUE"]);
  });

  it("'Tampilkan peminjaman yang belum selesai' bukan riwayat", async () => {
    mockBorrowFindMany.mockResolvedValue([overdueRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Tampilkan peminjaman yang belum selesai"));

    expect(result.message).toContain("Biologi Terlambat");
    expect(result.message).toContain("Sari");
    expect(result.message).not.toContain("riwayat");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("transaksi RETURNED tidak dihitung aktif (filter status ketat)", async () => {
    mockPhysicalActiveOnly([
      borrowRow(),
      borrowRow({
        id: "br-returned",
        bookId: "book-returned",
        status: "RETURNED",
        returnDate: daysFromNow(-1),
        book: { id: "book-returned", title: "Sudah Kembali", author: "A", archivedAt: null },
      }),
    ]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Buku apa saja yang sedang dipinjam?"));

    expect(result.message).toContain("Fisika Dasar");
    expect(result.message).not.toContain("Sudah Kembali");
    expect(mockBorrowFindMany.mock.calls[0][0].where.status.in).not.toContain("RETURNED");
  });

  it("keterlambatan ditandai dengan jumlah hari (belum dikembalikan)", async () => {
    mockBorrowFindMany.mockResolvedValue([overdueRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Peminjaman aktif"));

    expect(result.message).toContain("terlambat 4 hari (belum dikembalikan)");
  });

  it("menampilkan beberapa peminjam sekaligus", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow(), overdueRow()]);
    mockBorrowCount.mockResolvedValue(2);

    const result = await processChat(input("Buku apa saja yang sedang dipinjam?"));

    expect(result.message).toContain("Budi");
    expect(result.message).toContain("Sari");
    expect(result.message).toContain("Total 2 buku fisik");
  });

  it("hasil kosong dinyatakan jujur, bukan error", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    mockBorrowCount.mockResolvedValue(0);

    const result = await processChat(input("Buku apa saja yang sedang dipinjam?"));

    expect(result.message).toContain("Tidak ada buku fisik yang sedang dipinjam");
    expect(result.message).not.toBe(OPERATIONAL_BORROWS_UNAVAILABLE);
  });

  it("query gagal TIDAK disamarkan sebagai 'tidak ada'", async () => {
    mockBorrowFindMany.mockRejectedValue(new Error("db down"));
    mockBorrowCount.mockResolvedValue(0);

    const result = await processChat(input("Buku apa saja yang sedang dipinjam?"));

    expect(result.message).toBe(OPERATIONAL_BORROWS_UNAVAILABLE);
    expect(result.message).not.toContain("Tidak ada");
  });

  it("ebook eksplisit memakai transaksi ebook yang masih berlaku", async () => {
    mockEbookFindMany.mockResolvedValue([ebookRow()]);
    mockEbookCount.mockResolvedValue(1);

    const result = await processChat(input("Ebook apa saja yang sedang dipinjam?"));

    expect(result.message).toContain("Matematika Digital");
    expect(result.message).toContain("masa akses aktif");
    expect(result.message).toContain("Dewi");
    const where = mockEbookFindMany.mock.calls[0][0].where;
    expect(where.returnedAt).toBeNull();
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });
});

describe("processChat() — RBAC peminjaman aktif", () => {
  it("Siswa dijawab dari data pribadinya sendiri", async () => {
    mockFindUnique.mockResolvedValue(account({ name: "Siswa Sendiri", role: "STUDENT" }));
    mockBorrowFindMany.mockResolvedValue([
      borrowRow({
        id: "br-mine",
        book: { id: "book-mine", title: "Buku Milik Sendiri", author: "A", archivedAt: null },
        user: { name: "Siswa Sendiri", role: "STUDENT", class: "X" },
      }),
    ]);

    const result = await processChat({
      userId: "student-1",
      messages: [{ role: "user", content: "Buku apa saja yang sedang dipinjam?" }],
    });

    expect(result.message).toContain("Buku Milik Sendiri");
    // Query personal WAJIB memakai userId sesi.
    expect(mockBorrowFindMany.mock.calls[0][0].where.userId).toBe("student-1");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("Siswa meminta peminjaman orang lain ditolak (tidak menjawab dari data sendiri)", async () => {
    mockFindUnique.mockResolvedValue(account({ name: "Siswa", role: "STUDENT" }));

    const result = await processChat({
      userId: "student-1",
      messages: [{ role: "user", content: "Tampilkan peminjaman Budi" }],
    });

    expect(result.message).toBe(OTHER_USER_REFUSAL);
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("Siswa bertanya 'siapa yang belum mengembalikan buku' ditolak", async () => {
    mockFindUnique.mockResolvedValue(account({ name: "Siswa", role: "STUDENT" }));

    const result = await processChat({
      userId: "student-1",
      messages: [{ role: "user", content: "Siapa yang belum mengembalikan buku?" }],
    });

    expect(result.message).toBe(OTHER_USER_REFUSAL);
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("Pustakawan mendapat data global untuk pertanyaan pihak ketiga", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const result = await processChat(input("Siapa yang belum mengembalikan buku?"));

    expect(result.message).toContain("Budi");
    expect(result.message).toContain("Fisika Dasar");
    expect(result.message).not.toBe(OTHER_USER_REFUSAL);
    expect(mockBorrowFindMany.mock.calls[0][0].where.userId).toBeUndefined();
  });
});

describe("detectIntent() — variasi pertanyaan peminjaman aktif", () => {
  it.each([
    "Buku apa saja yang sedang dipinjam?",
    "Buku yang belum dikembalikan",
    "Tampilkan peminjaman yang belum selesai",
    "Buku yang belum saya kembalikan",
    "Pinjaman aktif",
    "Buku yang melewati tanggal pengembalian",
  ])("%s → transaksi pinjaman (MY_LOANS), bukan katalog", (query) => {
    expect(detectIntent(query, false)).toBe("MY_LOANS");
  });

  it("pertanyaan 'siapa yang belum mengembalikan buku' adalah data operasional", () => {
    expect(detectIntent("Siapa yang belum mengembalikan buku?", false)).toBe("OPERATIONAL");
  });

  it("cakupan global hanya untuk pertanyaan tanpa kata ganti orang pertama", () => {
    expect(isGlobalActiveLoansQuery("Buku apa saja yang sedang dipinjam?")).toBe(true);
    expect(isGlobalActiveLoansQuery("Siapa yang belum mengembalikan buku?")).toBe(true);
    expect(isGlobalActiveLoansQuery("Buku apa saja yang sedang saya pinjam?")).toBe(false);
  });
});

describe("executeTool('get_active_loans') — payload terstruktur & RBAC", () => {
  it("mengembalikan ID transaksi, media, status, tanggal, keterlambatan, dan peminjam", async () => {
    mockBorrowFindMany.mockResolvedValue([overdueRow()]);
    mockBorrowCount.mockResolvedValue(1);

    const raw = await executeTool("get_active_loans", { format: "PHYSICAL" }, USER_ID, "LIBRARIAN");
    const result = JSON.parse(raw);

    expect(result.format).toBe("PHYSICAL");
    expect(result.total).toBe(1);
    expect(result.activeBorrows[0]).toMatchObject({
      transactionId: "br-late",
      bookId: "book-late",
      media: "PHYSICAL",
      title: "Biologi Terlambat",
      status: "BORROWED",
      statusLabel: "terlambat (belum dikembalikan)",
      userName: "Sari",
      userRole: "STUDENT",
      userClass: "XI IPA 2",
      returnDate: null,
    });
    expect(result.activeBorrows[0].daysLate).toBeGreaterThanOrEqual(4);
    expect(result.activeBorrows[0].dueDate).toContain("WIB");
    expect(result.activeEbooks).toEqual([]);
  });

  it("format EBOOK hanya membaca EbookLoan aktif", async () => {
    mockEbookFindMany.mockResolvedValue([ebookRow()]);
    mockEbookCount.mockResolvedValue(1);

    const raw = await executeTool("get_active_loans", { format: "EBOOK" }, USER_ID, "LIBRARIAN");
    const result = JSON.parse(raw);

    expect(result.format).toBe("EBOOK");
    expect(result.activeBorrows).toEqual([]);
    expect(result.activeEbooks[0]).toMatchObject({
      transactionId: "el-1",
      media: "EBOOK",
      title: "Matematika Digital",
      statusLabel: "masa akses aktif",
      userName: "Dewi",
    });
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });

  it("format ALL memisahkan buku fisik dan ebook", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);
    mockBorrowCount.mockResolvedValue(1);
    mockEbookFindMany.mockResolvedValue([ebookRow()]);
    mockEbookCount.mockResolvedValue(1);

    const raw = await executeTool("get_active_loans", { format: "ALL" }, USER_ID, "LIBRARIAN");
    const result = JSON.parse(raw);

    expect(result.format).toBe("ALL");
    expect(result.total).toBe(2);
    expect(result.activeCounts).toEqual({ physical: 1, ebook: 1 });
    expect(result.activeBorrows).toHaveLength(1);
    expect(result.activeEbooks).toHaveLength(1);
  });

  it("Siswa tidak berwenang memanggil tool operasional", async () => {
    const raw = await executeTool("get_active_loans", {}, USER_ID, "STUDENT");
    const result = JSON.parse(raw);

    expect(result.error).toContain("Akses ditolak");
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });
});
