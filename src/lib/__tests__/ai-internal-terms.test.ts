/**
 * AI Chat — Kebocoran istilah internal (Bagian B).
 *
 * Model sesekali menyebut nama fungsi/tool internal (mis. `get_my_history`),
 * menyuruh pengguna "memanggil fungsi", atau menyebut istilah implementasi
 * (intent, pipeline, endpoint, tool). Semua itu TIDAK boleh muncul pada jawaban.
 *
 * Berkas ini menguji:
 *  - modul murni `internalTerms` (deteksi + pembersihan + fallback aman);
 *  - pipeline `answerWithModel` membersihkan jawaban model yang bocor;
 *  - nama tool internal apa pun tidak lolos ke `message`.
 */

const mockFindUnique = jest.fn();
const mockChatWithTools = jest.fn();
const mockChat = jest.fn();
const mockIsConfigured = jest.fn(() => true);
const mockBuildPersonalAnswer = jest.fn();
const mockBuildCatalogAnswer = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mockFindUnique } },
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
  INTERNAL_TERM_REFUSAL,
  INTERNAL_TOOL_NAMES,
  containsInternalTermLeak,
  sanitizeInternalTerms,
  stripInternalTerms,
} from "@/lib/ai/internalTerms";
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
});

describe("internalTerms — deteksi & pembersihan", () => {
  it("mengenali nama seluruh tool internal", () => {
    for (const name of INTERNAL_TOOL_NAMES) {
      expect(containsInternalTermLeak(`Silakan pakai ${name} untuk itu.`)).toBe(true);
    }
  });

  it("mengenali pola fungsi internal gaya snake_case", () => {
    expect(containsInternalTermLeak("coba panggil get_something_custom")).toBe(true);
    expect(containsInternalTermLeak("hasil dari search_custom_tool")).toBe(true);
  });

  it("mengenali frasa pemanggilan fungsi/tool dan istilah teknis", () => {
    expect(containsInternalTermLeak("saya bisa memanggil fungsi internal")).toBe(true);
    expect(containsInternalTermLeak("lewat tool internal aplikasi")).toBe(true);
    expect(containsInternalTermLeak("intent MY_HISTORY dipakai")).toBe(true);
    expect(containsInternalTermLeak("diproses oleh pipeline")).toBe(true);
    expect(containsInternalTermLeak("endpoint api tidak tersedia")).toBe(true);
    expect(containsInternalTermLeak("system prompt saya")).toBe(true);
  });

  it("TIDAK salah menandai kalimat perpustakaan biasa", () => {
    expect(
      containsInternalTermLeak(
        "Kamu bisa melihat riwayat peminjamanmu melalui menu Riwayat Peminjaman di DigiLib."
      )
    ).toBe(false);
    expect(
      containsInternalTermLeak('Buku "Fisika Dasar" sedang dipinjam, jatuh tempo 25 Oktober 2026.')
    ).toBe(false);
    // Kata "fungsi" biasa (bukan nama fungsi internal) tidak dianggap kebocoran.
    expect(
      containsInternalTermLeak("Fungsi tombol Pinjam adalah mengajukan peminjaman buku.")
    ).toBe(false);
    expect(
      containsInternalTermLeak("Fungsi menu Riwayat Peminjaman adalah menampilkan riwayatmu.")
    ).toBe(false);
  });

  it("membuang hanya kalimat yang bocor, menyisakan sisanya", () => {
    const answer =
      "Maaf, saya tidak dapat mengungkap riwayat pengguna lain. " +
      "Kalau mau, saya bisa bantu dengan memanggil fungsi get_my_history untukmu.";
    const cleaned = stripInternalTerms(answer);
    expect(cleaned).toContain("tidak dapat mengungkap riwayat pengguna lain");
    expect(cleaned).not.toContain("get_my_history");
    expect(cleaned).not.toContain("memanggil fungsi");
  });

  it("mengganti jawaban yang seluruhnya bocor dengan pesan aman", () => {
    const answer = "Saya akan memanggil fungsi get_my_history sekarang.";
    expect(sanitizeInternalTerms(answer)).toBe(INTERNAL_TERM_REFUSAL);
    expect(INTERNAL_TERM_REFUSAL).not.toContain("get_my_history");
    expect(containsInternalTermLeak(INTERNAL_TERM_REFUSAL)).toBe(false);
  });

  it("membiarkan jawaban bersih apa adanya", () => {
    const answer = "Buku yang tersedia: Fisika Dasar, Bumi Manusia.";
    expect(sanitizeInternalTerms(answer)).toBe(answer);
  });
});

describe("processChat() — jawaban model tidak pernah memuat istilah internal", () => {
  it("membersihkan nama tool dari jawaban model", async () => {
    mockChatWithTools.mockResolvedValue(
      "Untuk riwayatmu, saya bisa memanggil fungsi get_my_history."
    );
    const result = await processChat(input("halo, apa yang bisa kamu lakukan untuk riwayatku?"));
    expect(result.message).not.toMatch(/get_[a-z_]+/);
    expect(result.message).not.toContain("memanggil fungsi");
    expect(result.message).not.toContain("tool");
  });

  it("memakai pesan aman bila seluruh jawaban model bocor", async () => {
    mockChatWithTools.mockResolvedValue("Saya panggil get_my_history dulu ya.");
    const result = await processChat(input("halo, bantu aku dong"));
    expect(result.message).toBe(INTERNAL_TERM_REFUSAL);
    expect(result.message).not.toMatch(/get_[a-z_]+/);
  });

  it("meneruskan jawaban model yang bersih tanpa perubahan", async () => {
    const clean = "Halo! Ada yang bisa saya bantu seputar perpustakaan DigiLib?";
    mockChatWithTools.mockResolvedValue(clean);
    const result = await processChat(input("halo, bantu aku dong"));
    expect(result.message).toBe(clean);
  });
});
