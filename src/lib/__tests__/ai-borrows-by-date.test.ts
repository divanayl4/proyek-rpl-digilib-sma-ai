/**
 * AI Chat — Pertanyaan "transaksi peminjaman pada tanggal X" (Kasus B).
 *
 * Bug: "Tidak ada transaksi pada 15 Oktober" padahal ada, sementara
 * "Siapa yang meminjam buku pada 15 Oktober?" menampilkan daftar. Penyebabnya
 * pertanyaan ber-tanggal tanpa kata tanya ("Ada transaksi ... tanggal 15 Oktober")
 * tidak dikenali sebagai pertanyaan per-tanggal sehingga jatuh ke jalur model.
 *
 * Perbaikan: SEMUA pertanyaan transaksi/peminjaman dengan tanggal yang dapat
 * dipahami (rupanya apa pun) dijawab deterministik dari database oleh
 * Pustakawan/Admin, dan dua redaksi berbeda memberi hasil yang sama.
 */

const mockFindUnique = jest.fn();
const mockBorrowFindMany = jest.fn();
const mockEbookFindMany = jest.fn();
const mockChatWithTools = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockFindUnique },
    borrowRecord: { findMany: mockBorrowFindMany },
    ebookLoan: { findMany: mockEbookFindMany },
  },
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat, chatWithTools: mockChatWithTools }),
  isAIConfigured: () => mockIsConfigured(),
}));

import { processChat, resetRateLimits } from "@/lib/ai/pipeline";

const USER_ID = "user-pustakawan";

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

function message(content: string) {
  return { userId: USER_ID, messages: [{ role: "user", content }] };
}

/** Transaksi nyata 15 Okt 2026: 09:05 WIB (02:05 UTC). */
function borrowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-15",
    bookId: "bk-1",
    status: "RETURNED",
    borrowDate: new Date("2026-10-15T02:05:00.000Z"),
    dueDate: new Date("2026-10-22T02:05:00.000Z"),
    returnDate: new Date("2026-10-21T02:00:00.000Z"),
    book: { id: "bk-1", title: "Fisika Dasar untuk SMA", author: "Tim Penulis", archivedAt: null },
    user: { name: "Siswa Rajin", role: "STUDENT" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnique.mockResolvedValue(account());
  mockBorrowFindMany.mockResolvedValue([borrowRow()]);
  mockEbookFindMany.mockResolvedValue([]);
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
});

describe("Kasus B — dua redaksi memberi jawaban identik", () => {
  it("'Ada transaksi peminjaman pada tanggal 15 Oktober 2026?' dijawab deterministik", async () => {
    const result = await processChat(message("Ada transaksi peminjaman pada tanggal 15 Oktober 2026?"));
    expect(result.message).toContain("Siswa Rajin");
    expect(result.message).toContain("Fisika Dasar untuk SMA");
    expect(result.message).toContain("09:05 WIB");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("redaksi 'siapa yang meminjam' dan 'ada transaksi' menghasilkan jawaban sama", async () => {
    const a = await processChat(message("Ada transaksi peminjaman pada tanggal 15 Oktober 2026?"));
    const b = await processChat(message("Siapa yang meminjam buku pada tanggal 15 Oktober 2026?"));
    expect(a.message).toBe(b.message);
  });

  it("menyatakan jujur 'tidak ada' saat rentang kosong (bukan error)", async () => {
    mockBorrowFindMany.mockResolvedValue([]);
    const result = await processChat(message("Ada transaksi peminjaman pada tanggal 15 Oktober 2026?"));
    expect(result.message).toContain("Tidak ada transaksi peminjaman");
  });

  it("kegagalan query tidak disamarkan sebagai 'tidak ada transaksi'", async () => {
    mockBorrowFindMany.mockRejectedValue(new Error("db down"));
    const result = await processChat(message("Ada transaksi peminjaman pada tanggal 15 Oktober 2026?"));
    expect(result.message).not.toContain("Tidak ada transaksi");
    expect(result.message).toContain("belum dapat diakses");
  });

  it("pertanyaan ber-tanggal memfilter tanggal di level database (bukan daftar terbaru)", async () => {
    await processChat(message("Ada transaksi peminjaman pada tanggal 15 Oktober 2026?"));
    expect(mockBorrowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          borrowDate: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
        }),
      })
    );
  });
});
