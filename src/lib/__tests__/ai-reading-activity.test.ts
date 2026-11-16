const mockUserFindUnique = jest.fn();
const mockSessionFindMany = jest.fn();
const mockSessionCount = jest.fn();
const mockSessionGroupBy = jest.fn();
const mockChatWithTools = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, count: jest.fn() },
    setting: { findMany: jest.fn() },
    borrowRecord: { findMany: jest.fn(), count: jest.fn() },
    ebookLoan: { findMany: jest.fn() },
    ebookReadingSession: {
      findMany: (...args: unknown[]) => mockSessionFindMany(...args),
      count: (...args: unknown[]) => mockSessionCount(...args),
      groupBy: (...args: unknown[]) => mockSessionGroupBy(...args),
    },
  },
}));

jest.mock("@/lib/ai", () => ({
  getAIProvider: () => ({ chat: mockChat, chatWithTools: mockChatWithTools }),
  isAIConfigured: () => mockIsConfigured(),
}));

import { processChat, resetRateLimits } from "@/lib/ai/pipeline";
import { READING_ACTIVITY_ADMIN_ONLY } from "@/lib/ai/personalAnswer";

const NOW = new Date("2026-10-22T04:00:00.000Z");
const USER_ID = "user-1";

function account(overrides: Record<string, unknown> = {}) {
  return {
    name: "Siswa Satu",
    role: "STUDENT",
    gender: "FEMALE",
    class: "XII IPA 1",
    isActive: true,
    ...overrides,
  };
}

function input(content: string) {
  return { userId: USER_ID, messages: [{ role: "user", content }] };
}

function readingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    user: {
      id: USER_ID,
      name: "Siswa Satu",
      role: "STUDENT",
      class: "XII IPA 1",
      identityNumber: "12345",
    },
    book: {
      id: "book-1",
      title: "Matematika Terapan",
      author: "Tim Guru",
      pageCount: 100,
    },
    loan: null,
    firstOpenedAt: new Date(NOW.getTime() - 20 * 60 * 1000),
    lastActivityAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    endedAt: null,
    activityCount: 2,
    lastPage: null,
    progressPercent: null,
    ...overrides,
  };
}

function setRowSession() {
  mockUserFindUnique.mockResolvedValue(account());
  mockSessionFindMany.mockResolvedValue([readingRow()]);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockUserFindUnique.mockResolvedValue(account());
  mockSessionFindMany.mockResolvedValue([]);
  mockSessionCount.mockResolvedValue(0);
  mockSessionGroupBy.mockResolvedValue([]);
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
});

afterAll(() => jest.useRealTimers());

describe("chatbot aktivitas membaca pribadi", () => {
  it("menjawab dari sesi membaca milik pengguna, bukan dari EbookLoan", async () => {
    setRowSession();

    const result = await processChat(input("Ebook apa yang terakhir saya buka?"));

    expect(result.message).toContain("Matematika Terapan");
    expect(result.message).toContain("Aktivitas membaca ebook terakhir yang tercatat");
    expect(result.message).toContain("aktivitas terakhir");
    expect(result.message).not.toContain("sedang membaca");
    expect(mockChatWithTools).not.toHaveBeenCalled();

    const where = mockSessionFindMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: USER_ID })])
    );
  });

  it("tidak mengarang halaman/progres saat viewer tidak melaporkannya", async () => {
    setRowSession();

    const result = await processChat(
      input("Sampai halaman berapa saya membaca ebook Matematika?")
    );

    expect(result.message).toContain("tidak dapat memastikan");
    expect(result.message).toContain("tidak dikarang");
    expect(result.message).not.toContain("Halaman 0");
    expect(result.message).not.toContain("0%");
  });

  it("melaporkan halaman/progres hanya bila nilainya valid dan tersedia", async () => {
    mockSessionFindMany.mockResolvedValue([
      readingRow({ lastPage: 50, progressPercent: 50 }),
    ]);

    const result = await processChat(
      input("Sampai halaman berapa saya membaca ebook Matematika?")
    );

    expect(result.message).toContain("Halaman terakhir yang dilaporkan: 50");
    expect(result.message).toContain("50%");
  });

  it("tetap menampilkan halaman bila total halaman tidak tersedia", async () => {
    mockSessionFindMany.mockResolvedValue([
      readingRow({
        book: {
          id: "book-1",
          title: "Matematika Terapan",
          author: "Tim Guru",
          pageCount: null,
        },
        lastPage: 12,
        progressPercent: null,
      }),
    ]);

    const result = await processChat(
      input("Sampai halaman berapa saya membaca ebook Matematika?")
    );

    expect(result.message).toContain("Halaman terakhir yang dilaporkan: 12");
    expect(result.message).toContain("persentase progres tidak dihitung");
  });

  it("menyatakan belum ada aktivitas tanpa mengubah peminjaman menjadi bacaan", async () => {
    mockSessionFindMany.mockResolvedValue([]);

    const result = await processChat(
      input("Ebook apa yang terakhir saya baca bulan ini?")
    );

    expect(result.message).toContain("Belum ada aktivitas membaca ebook");
    expect(result.message).toContain("tidak otomatis");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

describe("chatbot aktivitas membaca global", () => {
  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue(account({ role: "ADMIN", name: "Admin Satu" }));
  });

  it("membedakan sesi, pengguna unik, dan ebook unik untuk ADMIN", async () => {
    mockSessionCount
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2);
    mockSessionGroupBy
      .mockResolvedValueOnce([
        { userId: "u1" },
        { userId: "u2" },
        { userId: "u3" },
      ])
      .mockResolvedValueOnce([{ bookId: "b1" }, { bookId: "b2" }]);

    const result = await processChat(
      input("Berapa pengguna unik yang membuka ebook bulan ini?")
    );

    expect(result.message).toContain("7 sesi");
    expect(result.message).toContain("3 pengguna unik");
    expect(result.message).toContain("2 ebook unik");
    expect(result.message).toContain("Jumlah sesi tidak sama dengan jumlah pengguna");
    expect(result.message).not.toContain("sedang membaca");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("menampilkan aktivitas terakhir dengan status yang jujur", async () => {
    mockSessionFindMany.mockResolvedValue([
      readingRow({
        user: {
          id: "u1",
          name: "Budi",
          role: "STUDENT",
          class: "XI IPA",
          identityNumber: "1",
        },
        activityCount: 2,
      }),
    ]);
    mockSessionCount.mockResolvedValue(1);
    mockSessionGroupBy.mockResolvedValue([{ userId: "u1" }]);

    const result = await processChat(
      input("Siapa yang terakhir membuka ebook Matematika?")
    );

    expect(result.message).toContain("Budi");
    expect(result.message).toContain("Matematika Terapan");
    expect(result.message).toContain("bukan bukti");
    expect(result.message).not.toContain("Budi sedang membaca");
  });

  it("tidak memberi Pustakawan akses global baru", async () => {
    mockUserFindUnique.mockResolvedValue(
      account({ role: "LIBRARIAN", name: "Pustakawan Satu" })
    );

    const result = await processChat(
      input("Tampilkan aktivitas membaca ebook bulan ini")
    );

    expect(result.message).toBe(READING_ACTIVITY_ADMIN_ONLY);
    expect(mockSessionFindMany).not.toHaveBeenCalled();
    expect(mockSessionCount).not.toHaveBeenCalled();
  });

  it("tidak memberi Siswa akses data membaca pengguna lain", async () => {
    mockUserFindUnique.mockResolvedValue(account());
    const result = await processChat(
      input("Siapa yang aktivitas membacanya masih aktif?")
    );

    expect(result.message).toBe(READING_ACTIVITY_ADMIN_ONLY);
    expect(mockSessionFindMany).not.toHaveBeenCalled();
  });
});
