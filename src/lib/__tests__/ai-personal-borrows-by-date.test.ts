/**
 * AI Chat — Akurasi riwayat MILIK SENDIRI pada tanggal tertentu (Kasus A/C).
 *
 * Kasus A: Najla (akun dibuat 18 Okt 2026) ditampilkan sebagai peminjam pada
 * 17 Oktober 2026 untuk buku yang sebenarnya ia pinjam pada 18 Oktober. Itu
 * misatribusi tanggal oleh model (memakai jawaban sebelumnya + "kemarin").
 *
 * Perbaikan yang diuji: pertanyaan transaksi MILIK SENDIRI ber-tanggal (termasuk
 * lanjutan singkat "kemarin?") dijawab DETERMINISTIK dari database pengguna,
 * sehingga:
 *  - tidak ada transaksi bertanggal yang dikarang model;
 *  - jawaban "tidak ada transaksi" jujur bila memang kosong;
 *  - tanggal parsial minta klarifikasi, bukan menebak;
 *  - tanggal/jam memakai zona Asia/Jakarta.
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
import { OTHER_USER_REFUSAL } from "@/lib/ai/personalAnswer";

const USER_ID = "user-najla";

function account(overrides: Record<string, unknown> = {}) {
  return {
    name: "Najla",
    role: "STUDENT",
    gender: "FEMALE",
    class: "X",
    isActive: true,
    ...overrides,
  };
}

/** Satu transaksi nyata Najla: dipinjam 18 Okt 2026 pukul 10:32 WIB (03:32 UTC). */
function borrowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    bookId: "bk-bumi",
    status: "BORROWED",
    borrowDate: new Date("2026-10-18T03:32:00.000Z"),
    dueDate: new Date("2026-10-25T03:32:00.000Z"),
    returnDate: null,
    book: { title: "Bumi Manusia", author: "Pramoedya Ananta Toer" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnique.mockResolvedValue(account());
  mockBorrowFindMany.mockResolvedValue([]);
  mockEbookFindMany.mockResolvedValue([]);
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
});

describe("Kasus A — lanjutan 'kemarin?' tidak mengarang transaksi bertanggal", () => {
  it("menjawab 'tidak ada transaksi' bila memang kosong, tanpa memanggil model", async () => {
    const result = await processChat({
      userId: USER_ID,
      messages: [
        { role: "user", content: "riwayat peminjaman saya" },
        { role: "assistant", content: "Berikut riwayat peminjamanmu..." },
        { role: "user", content: "kemarin?" },
      ],
    });

    expect(result.message).toContain("tidak memiliki transaksi peminjaman");
    // Tidak ada judul/buku yang dikarang.
    expect(result.message).not.toContain("Bumi Manusia");
    expect(result.message).not.toContain("Fisika Dasar");
    // Deterministik → model tidak pernah dipanggil.
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("hanya menampilkan transaksi yang benar-benar ada di database", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow()]);

    const result = await processChat({
      userId: USER_ID,
      messages: [
        { role: "user", content: "riwayat peminjaman saya" },
        { role: "assistant", content: "..." },
        { role: "user", content: "18 Oktober 2026?" },
      ],
    });

    expect(result.message).toContain("Bumi Manusia");
    // Jam ditampilkan dalam WIB (10:32), bukan UTC (03:32).
    expect(result.message).toContain("10:32 WIB");
    expect(result.message).not.toContain("03:32");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

describe("pertanyaan milik sendiri bertanggal dijawab dari database", () => {
  it("'kapan saya meminjam buku pada 18 Oktober 2026?' memakai data sendiri", async () => {
    mockBorrowFindMany.mockResolvedValue([borrowRow({ status: "RETURNED", returnDate: new Date("2026-10-18T06:00:00.000Z") })]);

    const result = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "kapan saya meminjam buku pada 18 Oktober 2026?" }],
    });

    expect(result.message).toContain("Bumi Manusia");
    // Query dibatasi ke userId dari sesi.
    expect(mockBorrowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID }),
      })
    );
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("tanggal parsial minta klarifikasi, bukan menebak", async () => {
    const result = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "saya meminjam apa tanggal 18?" }],
    });

    expect(result.message).toContain("tanpa bulan dan tahun");
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("kegagalan query tidak disamarkan sebagai 'tidak ada transaksi'", async () => {
    mockBorrowFindMany.mockRejectedValue(new Error("db down"));

    const result = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "kapan saya meminjam buku pada 18 Oktober 2026?" }],
    });

    expect(result.message).not.toContain("tidak memiliki transaksi");
    expect(result.message).toContain("belum dapat diakses");
  });
});

describe("Konteks pihak ketiga tidak berubah menjadi data pribadi (S4)", () => {
  it("lanjutan 'kemarin?' setelah konteks nama orang lain TIDAK dijawab sebagai riwayat penanya", async () => {
    const result = await processChat({
      userId: USER_ID,
      messages: [
        { role: "user", content: "Tampilkan riwayat peminjaman Budi." },
        { role: "assistant", content: "..." },
        { role: "user", content: "kemarin?" },
      ],
    });

    // Tidak ada query transaksi pribadi yang dijalankan dan tidak ada judul pribadi.
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
    expect(result.message).not.toContain("Bumi Manusia");
  });

  it("pertanyaan bertanggal bernama pada konteks pribadi tetap ditolak, bukan dijawab sebagai data sendiri", async () => {
    const result = await processChat({
      userId: USER_ID,
      messages: [
        { role: "user", content: "riwayat peminjaman saya" },
        { role: "assistant", content: "..." },
        { role: "user", content: "riwayat peminjaman Budi 18 Oktober 2026" },
      ],
    });

    expect(result.message).toBe(OTHER_USER_REFUSAL);
    expect(mockBorrowFindMany).not.toHaveBeenCalled();
  });
});
