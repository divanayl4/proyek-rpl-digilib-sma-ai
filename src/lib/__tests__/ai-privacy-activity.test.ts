/**
 * AI Chat — Privasi data pengguna lain & pertanyaan peringkat (Bagian B).
 *
 * Skenario yang diuji:
 *  - Siswa/Guru menanyakan aktivitas/peringkat pengguna lain
 *    ("siswa rajin siapa?", "siapa paling sering meminjam buku?",
 *    "siswa dengan peminjaman terbanyak?", "apa riwayat peminjaman siswa lain?")
 *    → DITOLAK deterministik, tanpa menyebut nama/fungsi, dan diarahkan ke fitur
 *    "Riwayat Peminjaman".
 *  - Pustakawan/Admin boleh mendapat agregat NYATA dari database (bukan karangan
 *    model), dan model tidak dipanggil.
 */

const mockFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
const mockBorrowGroupBy = jest.fn();
const mockChatWithTools = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);
const mockBuildPersonalAnswer = jest.fn();
const mockBuildCatalogAnswer = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockFindUnique, findMany: mockUserFindMany },
    borrowRecord: { groupBy: mockBorrowGroupBy },
  },
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat, chatWithTools: mockChatWithTools }),
  isAIConfigured: () => mockIsConfigured(),
}));

jest.mock("@/lib/ai/personal", () => ({
  buildPersonalAnswer: (...args: unknown[]) => mockBuildPersonalAnswer(...args),
  getMyBorrowsByDate: jest.fn(),
}));

jest.mock("@/lib/ai/catalog", () => {
  const actual = jest.requireActual("@/lib/ai/catalog");
  return { ...actual, buildCatalogAnswer: (...args: unknown[]) => mockBuildCatalogAnswer(...args) };
});

import {
  OTHER_USER_FINE_REFUSAL,
  OTHER_USER_REFUSAL,
} from "@/lib/ai/personalAnswer";
import { processChat, resetRateLimits } from "@/lib/ai/pipeline";

const USER_ID = "user-siswa";

function account(overrides: Record<string, unknown> = {}) {
  return {
    name: "Siswa Rajin",
    role: "STUDENT",
    gender: "MALE",
    class: "XII IPA 1",
    isActive: true,
    ...overrides,
  };
}

function input(content: string) {
  return { userId: USER_ID, messages: [{ role: "user", content }] };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnique.mockResolvedValue(account());
  mockBuildPersonalAnswer.mockResolvedValue({ message: "jawaban pribadi", references: [] });
  mockBuildCatalogAnswer.mockResolvedValue({ message: "jawaban katalog", references: [] });
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
  mockUserFindMany.mockResolvedValue([]);
  mockBorrowGroupBy.mockResolvedValue([]);
});

const OTHER_ACTIVITY_QUESTIONS = [
  "siswa rajin siapa?",
  "siapa yang paling sering meminjam buku?",
  "siswa dengan peminjaman terbanyak?",
  "siswa yang paling rajin",
  "apa riwayat peminjaman siswa lain?",
  "siapa siswa paling aktif meminjam?",
];

describe("processChat() — Siswa/Guru ditolak untuk aktivitas pengguna lain", () => {
  for (const question of OTHER_ACTIVITY_QUESTIONS) {
    it(`menolak deterministik: "${question}"`, async () => {
      const result = await processChat(input(question));

      expect(result.message).toBe(OTHER_USER_REFUSAL);
      // Tidak ada nama siswa lain / tidak ada nama tool internal.
      expect(result.message).not.toMatch(/get_[a-z_]+/);
      expect(result.message).not.toContain("tool");
      // Diarahkan ke fitur nyata.
      expect(result.message).toContain("Riwayat Peminjaman");
      // Model TIDAK pernah dipanggil.
      expect(mockChatWithTools).not.toHaveBeenCalled();
      expect(mockChat).not.toHaveBeenCalled();
    });
  }

  it("Guru juga ditolak (bukan hanya Siswa)", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "TEACHER", name: "Guru" }));
    const result = await processChat(input("siapa yang paling sering meminjam buku?"));
    expect(result.message).toBe(OTHER_USER_REFUSAL);
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("pertanyaan denda pengguna lain memakai penolakan denda", async () => {
    const result = await processChat(input("tampilkan denda siswa lain"));
    expect(result.message).toBe(OTHER_USER_FINE_REFUSAL);
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("tidak menawarkan tool apa pun saat menolak", async () => {
    const result = await processChat(input("siswa rajin siapa?"));
    expect(result.message.toLowerCase()).not.toContain("fungsi");
    expect(result.message.toLowerCase()).not.toContain("api");
  });
});

describe("processChat() — Pustakawan/Admin mendapat agregat nyata", () => {
  it("peringkat peminjam dibangun dari database, bukan model", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "LIBRARIAN", name: "Budi Pustakawan" }));
    mockBorrowGroupBy.mockResolvedValue([
      { userId: "u1", _count: { userId: 4 } },
      { userId: "u2", _count: { userId: 2 } },
    ]);
    mockUserFindMany.mockResolvedValue([
      { id: "u1", name: "Bela Nuraini", role: "STUDENT" },
      { id: "u2", name: "Guru", role: "TEACHER" },
    ]);

    const result = await processChat(input("siapa yang paling sering meminjam buku?"));

    expect(mockBorrowGroupBy).toHaveBeenCalled();
    expect(result.message).toContain("Bela Nuraini");
    expect(result.message).toContain("4 peminjaman");
    expect(result.message).not.toMatch(/get_[a-z_]+/);
    // Deterministik → model tidak dipanggil.
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("menyatakan jujur saat belum ada transaksi (bukan mengarang)", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "ADMIN", name: "Admin Utama" }));
    mockBorrowGroupBy.mockResolvedValue([]);

    const result = await processChat(input("siswa dengan peminjaman terbanyak?"));
    expect(result.message).toContain("Belum ada transaksi peminjaman");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("kegagalan query tidak disamarkan sebagai 'tidak ada'", async () => {
    mockFindUnique.mockResolvedValue(account({ role: "LIBRARIAN", name: "Budi Pustakawan" }));
    mockBorrowGroupBy.mockRejectedValue(new Error("db down"));

    const result = await processChat(input("siapa yang paling sering meminjam buku?"));
    expect(result.message).not.toContain("Belum ada transaksi peminjaman");
    expect(result.message).toContain("belum dapat diakses");
  });
});
