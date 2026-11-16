/**
 * Regresi audit chatbot — pemahaman bahasa, intent, dan query katalog.
 *
 * Bug yang dikunci di sini:
 *  1. Kata ganti ragam percakapan ("gue", "gw", "gua") tidak dikenali sebagai
 *     orang pertama → pertanyaan pinjaman sendiri salah jadi klarifikasi.
 *  2. "meminjam" tidak masuk konteks transaksi → "Siapa yang sedang meminjam?"
 *     jatuh ke jalur model dan berakhir gagal.
 *  3. "mempunyai denda" dianggap nama orang → klarifikasi pihak ketiga.
 *  4. Pertanyaan kategori tidak punya jalur deterministik → dijawab model.
 *  5. Kata tanya/penanda waktu ("apakah", "sekarang", "jumlahnya") dianggap
 *     kata kunci judul → "tidak ada buku ... ditemukan" padahal data ada.
 *  6. Follow-up hitung ("Berapa jumlahnya?") tidak mewarisi topik/format.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    book: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    category: { findMany: jest.fn(), count: jest.fn() },
    borrowRecord: { count: jest.fn() },
  },
}));

import {
  detectIntent,
  extractUserAuditSearch,
  isAmbiguousThirdPartyQuery,
  isBorrowerRankingQuery,
  isCurrentAffairsQuery,
  isGlobalActiveLoansQuery,
  isNamedThirdPartyDataRequest,
  isUserDirectoryQuery,
  normalizeQuery,
} from "@/lib/ai/intent";
import { extractSearchTerms, mergeCatalogQuery } from "@/lib/ai/catalog";

describe("normalisasi ragam percakapan", () => {
  it.each(["gue", "gw", "gua", "ane"])(
    "kata ganti '%s' dinormalisasi menjadi 'saya'",
    (pronoun) => {
      expect(normalizeQuery(`buku yang lagi ${pronoun} pinjam`)).toBe(
        "buku yang lagi saya pinjam"
      );
    }
  );
});

describe("detectIntent() — variasi yang sebelumnya gagal", () => {
  it.each([
    ["Siapa yang sedang meminjam?", "OPERATIONAL"],
    ["siapa aja yang minjem sekarang", "OPERATIONAL"],
    ["Siapa yang mempunyai denda?", "OPERATIONAL"],
    ["kategori apa aja yang ada?", "STATS"],
    ["Kalau kategori sejarah?", "STATS"],
    ["buku yang lagi gue pinjem apa aja", "MY_LOANS"],
    ["Sekarang buku apa saja?", "BOOK_PHYSICAL"],
    ["Apakah buku Bumi Manusia tersedia?", "BOOK_PHYSICAL"],
  ])("%s → %s", (query, expected) => {
    expect(detectIntent(query, false)).toBe(expected);
  });

  it("'kalau kategori ...' dengan riwayat tetap STATS (bukan topik baru)", () => {
    expect(detectIntent("Kalau kategori sejarah?", true)).toBe("STATS");
  });
});

describe("pertanyaan di luar cakupan — pengetahuan umum terkini", () => {
  it("pejabat publik yang menjabat sekarang ditolak deterministik", () => {
    expect(isCurrentAffairsQuery("Siapa presiden Indonesia sekarang?")).toBe(true);
    expect(isCurrentAffairsQuery("Siapa gubernur Jawa Timur saat ini?")).toBe(true);
    expect(detectIntent("Siapa presiden Indonesia sekarang?", false)).toBe("OUT_OF_SCOPE");
  });

  it("pertanyaan sejarah/konseptual tentang jabatan tetap jalur pembelajaran", () => {
    expect(isCurrentAffairsQuery("Siapa presiden pertama Indonesia?")).toBe(false);
    expect(isCurrentAffairsQuery("Apa tugas presiden?")).toBe(false);
    expect(detectIntent("Siapa presiden pertama Indonesia?", false)).not.toBe("OUT_OF_SCOPE");
  });

  it("pencarian buku yang menyebut tokoh bukan pertanyaan current affairs", () => {
    expect(isCurrentAffairsQuery("Cari buku tentang presiden Indonesia sekarang")).toBe(false);
  });
});

describe("peminjaman aktif — deteksi dan cakupan", () => {
  it("'meminjam' dan penanda waktu sekarang dikenali sebagai peminjaman aktif", () => {
    expect(isGlobalActiveLoansQuery("Siapa yang sedang meminjam?")).toBe(true);
    expect(isGlobalActiveLoansQuery("siapa aja yang minjem sekarang")).toBe(true);
  });

  it("pertanyaan katalog 'sekarang buku apa saja' BUKAN peminjaman aktif", () => {
    expect(isGlobalActiveLoansQuery("Sekarang buku apa saja?")).toBe(false);
  });

  it("kata ganti orang pertama tetap personal", () => {
    expect(isGlobalActiveLoansQuery("Buku yang lagi gue pinjam apa saja")).toBe(false);
  });
});

describe("peringkat peminjam", () => {
  it("'yang paling lama siapa' bukan peringkat peminjam", () => {
    expect(isBorrowerRankingQuery("Yang paling lama siapa?")).toBe(false);
  });

  it("'siapa yang paling sering meminjam' tetap peringkat", () => {
    expect(isBorrowerRankingQuery("Siapa yang paling sering meminjam buku?")).toBe(true);
  });
});

describe("pertanyaan denda pihak ketiga tidak dianggap nama/ambigu", () => {
  it("'mempunyai denda' bukan permintaan data orang tertentu", () => {
    expect(isNamedThirdPartyDataRequest("Siapa yang mempunyai denda?")).toBe(false);
    expect(isAmbiguousThirdPartyQuery("Siapa yang mempunyai denda?")).toBe(false);
  });
});

describe("ekstraksi kata kunci katalog", () => {
  it("kata tanya dan penanda waktu tidak menjadi kata kunci judul", () => {
    expect(extractSearchTerms("Apakah buku Bumi Manusia tersedia?")).toEqual([
      "bumi",
      "manusia",
    ]);
    expect(extractSearchTerms("Sekarang buku apa saja?")).toEqual([]);
    expect(extractSearchTerms("Berapa jumlahnya?")).toEqual([]);
    expect(extractSearchTerms("Kalau kategori sejarah?")).toEqual(["sejarah"]);
  });
});

describe("pertanyaan identitas pengguna berdasarkan role", () => {
  it.each([
    ["Siapa administrator?", "USER_DIRECTORY"],
    ["Siapa guru?", "USER_DIRECTORY"],
    ["Siapa pustakawan?", "USER_DIRECTORY"],
    ["Siapa saja siswa kelas XII IPA 1?", "USER_DIRECTORY"],
  ])("%s → %s (bukan klarifikasi/definisi model)", (query, expected) => {
    expect(isUserDirectoryQuery(query)).toBe(true);
    expect(detectIntent(query, false)).toBe(expected);
  });
});

describe("audit akun — penanda urutan bukan kata kunci nama", () => {
  it.each([
    "Siapa yang membuat akun terbaru?",
    "Siapa yang membuat akun terakhir?",
    "Akun siapa yang paling baru dibuat?",
  ])("'%s' tidak memfilter dengan kata urutan", (query) => {
    expect(extractUserAuditSearch(query)).toBeNull();
  });
});

describe("follow-up hitung mewarisi topik/format", () => {
  it("'Berapa jumlahnya?' setelah daftar ebook membawa konteks ebook", () => {
    const merged = mergeCatalogQuery("Berapa jumlahnya?", [
      "Ebook apa saja yang tersedia?",
    ]);
    expect(merged.toLowerCase()).toContain("ebook");
    expect(merged.toLowerCase()).toContain("jumlahnya");
  });

  it("'Berapa jumlahnya?' setelah daftar buku tetap konteks buku", () => {
    const merged = mergeCatalogQuery("Berapa jumlahnya?", [
      "Buku apa saja yang tersedia?",
    ]);
    expect(merged.toLowerCase()).toContain("buku");
  });

  it("follow-up hitung tidak mewarisi kata ketersediaan (metrik eksemplar)", () => {
    const merged = mergeCatalogQuery("Berapa jumlahnya?", [
      "Buku apa saja yang tersedia?",
    ]);
    expect(merged.toLowerCase()).toContain("buku");
    expect(merged.toLowerCase()).not.toContain("tersedia");
  });

  it("topik dengan kata kunci tetap digabung", () => {
    const merged = mergeCatalogQuery("Berapa jumlahnya?", [
      "Buku tentang sejarah apa saja?",
    ]);
    expect(merged).toContain("sejarah");
  });
});
