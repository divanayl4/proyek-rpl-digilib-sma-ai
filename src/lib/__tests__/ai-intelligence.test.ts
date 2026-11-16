/**
 * AI Chat — Pengujian Kecerdasan, Akurasi, dan Batasan Keamanan AI Assistant.
 *
 * Menguji:
 * 1. Pemahaman bahasa Indonesia slang, singkatan, dan sinonim ebook.
 * 2. Pemilihan intent yang presisi (PASSWORD, MY_PROFILE, LIBRARY_GUIDE, ACADEMIC TASK, dsb).
 * 3. Penolakan deterministik terhadap permintaan password dan kredensial.
 * 4. Perlindungan privasi data pengguna lain.
 * 5. Penolakan tugas akademik dan coding (di luar lingkup DigiLib).
 * 6. Jawaban profil yang terverifikasi dan berakar pada database session.
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
}));

jest.mock("@/lib/ai/catalog", () => {
  const actual = jest.requireActual("@/lib/ai/catalog");
  return { ...actual, buildCatalogAnswer: (...args: unknown[]) => mockBuildCatalogAnswer(...args) };
});

import {
  detectIntent,
  normalizeQuery,
  isPasswordRequest,
  isAcademicTaskRequest,
  isMyProfileRequest,
  isLibraryGuideRequest,
  isOtherUserDataRequest,
} from "@/lib/ai/intent";
import { wantsEbook } from "@/lib/ai/catalogAnswer";
import {
  processChat,
  resetRateLimits,
  PASSWORD_REFUSAL,
} from "@/lib/ai/pipeline";
import { OTHER_USER_FINE_REFUSAL, OTHER_USER_REFUSAL } from "@/lib/ai/personalAnswer";

const USER_ID = "user-siswa-123";

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    name: "Ahmad Siswa",
    role: "STUDENT",
    gender: "MALE",
    class: "XII RPL 1",
    identityNumber: "NIS2024001",
    email: "ahmad@sekolah.sch.id",
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimits();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnique.mockResolvedValue(mockUser());
  mockBuildPersonalAnswer.mockResolvedValue({ message: "jawaban pribadi", references: [] });
  mockBuildCatalogAnswer.mockResolvedValue({ message: "jawaban katalog", references: [] });
  mockChatWithTools.mockResolvedValue("jawaban model");
  mockChat.mockResolvedValue("jawaban model");
});

describe("AI NLU — Normalisasi Bahasa Indonesia dan Sinonim", () => {
  it("menormalisasi singkatan dan kata tidak baku ke bentuk baku", () => {
    expect(normalizeQuery("ebook apa aja yg ada")).toBe("ebook apa saja yang ada");
    expect(normalizeQuery("gimana cara balikin buku")).toBe("bagaimana cara kembalikan buku");
    expect(normalizeQuery("sy blm balikan bukunya")).toBe("saya belum kembalikan bukunya");
    expect(normalizeQuery("klo denda sy bgt ga")).toBe("kalau denda saya banget tidak");
    expect(normalizeQuery("pinjem buku utk besok")).toBe("pinjam buku untuk besok");
  });

  it("menormalisasi variasi istilah ebook ke 'ebook'", () => {
    expect(normalizeQuery("daftar e-book")).toBe("daftar ebook");
    expect(normalizeQuery("koleksi buku digital")).toBe("koleksi ebook");
    expect(normalizeQuery("buku elektronik apa saja")).toBe("ebook apa saja");
    expect(normalizeQuery("bacaan digital yang tersedia")).toBe("ebook yang tersedia");
    expect(normalizeQuery("buku digitalnya ada apa")).toBe("ebook ada apa");
  });

  it("mengenali wantsEbook untuk seluruh sinonim ebook", () => {
    expect(wantsEbook("ada ebook fisika?")).toBe(true);
    expect(wantsEbook("koleksi e-book kelas 10")).toBe(true);
    expect(wantsEbook("tampilkan buku digital yang ada")).toBe(true);
    expect(wantsEbook("daftar buku elektronik")).toBe(true);
    expect(wantsEbook("bacaan digital smk")).toBe(true);
    expect(wantsEbook("buku fisika biasa")).toBe(false);
  });
});

describe("AI Intent — Pemilihan Intent Akurat", () => {
  describe("Keamanan Password dan Kredensial", () => {
    it("mendeteksi pertanyaan password sebagai PASSWORD", () => {
      expect(isPasswordRequest("password saya apa?")).toBe(true);
      expect(isPasswordRequest("tampilkan kata sandi admin")).toBe(true);
      expect(isPasswordRequest("apa hash password pengguna")).toBe(true);
      expect(isPasswordRequest("minta token akses api key")).toBe(true);
      expect(detectIntent("password saya apa ya?", false)).toBe("PASSWORD");
      expect(detectIntent("tampilkan kata sandi saya", false)).toBe("PASSWORD");
    });
  });

  describe("Profil Pengguna Terverifikasi", () => {
    it("mendeteksi pertanyaan identitas diri sebagai MY_PROFILE", () => {
      expect(isMyProfileRequest("siapa saya?")).toBe(true);
      expect(isMyProfileRequest("siapa aku?")).toBe(true);
      expect(isMyProfileRequest("tampilkan profil saya")).toBe(true);
      expect(isMyProfileRequest("data diri saya")).toBe(true);
      expect(detectIntent("siapa saya?", false)).toBe("MY_PROFILE");
      expect(detectIntent("siapa aku?", false)).toBe("MY_PROFILE");
      expect(detectIntent("profil saya apa?", false)).toBe("MY_PROFILE");
    });
  });

  describe("Panduan Perpustakaan (Library Guide)", () => {
    it("mendeteksi pertanyaan panduan sistem sebagai LIBRARY_GUIDE", () => {
      expect(isLibraryGuideRequest("bagaimana cara meminjam buku?")).toBe(true);
      expect(isLibraryGuideRequest("gimana cara balikin buku?")).toBe(true);
      expect(isLibraryGuideRequest("aturan denda di perpustakaan")).toBe(true);
      expect(isLibraryGuideRequest("tata cara membaca ebook")).toBe(true);
      expect(detectIntent("bagaimana cara meminjam buku?", false)).toBe("LIBRARY_GUIDE");
      expect(detectIntent("aturan denda di digilib", false)).toBe("LIBRARY_GUIDE");
    });
  });

  describe("Penolakan Tugas Akademik", () => {
    it("mendeteksi permintaan pengerjaan tugas akademik sebagai OUT_OF_SCOPE", () => {
      expect(isAcademicTaskRequest("kerjakan soal fisika ini dong")).toBe(true);
      expect(isAcademicTaskRequest("buatkan makalah tentang sejarah kemerdekaan")).toBe(true);
      expect(isAcademicTaskRequest("buatkan esai bahasa indonesia")).toBe(true);
      expect(isAcademicTaskRequest("tolong kerjakan tugas saya")).toBe(true);
      expect(isAcademicTaskRequest("jawab semua soal ujian ini")).toBe(true);
      expect(detectIntent("kerjakan soal fisika ini", false)).toBe("OUT_OF_SCOPE");
      expect(detectIntent("buatkan makalah sejarah", false)).toBe("OUT_OF_SCOPE");
    });

    it("tidak menolak pencarian buku referensi tugas", () => {
      expect(detectIntent("buku referensi untuk tugas fisika", false)).toBe("BOOK_PHYSICAL");
      expect(detectIntent("cari buku sejarah indonesia", false)).toBe("BOOK_PHYSICAL");
    });
  });

  describe("Privasi Data Pengguna Lain", () => {
    it("mendeteksi permintaan transaksi orang lain", () => {
      expect(isOtherUserDataRequest("peminjaman milik Budi")).toBe(true);
      expect(isOtherUserDataRequest("riwayat buku dari Siti")).toBe(true);
      expect(isOtherUserDataRequest("denda punya orang lain")).toBe(true);
      expect(isOtherUserDataRequest("apakah siswa lain punya denda?")).toBe(true);
      expect(isOtherUserDataRequest("siapa yang sedang meminjam buku?")).toBe(true);
      expect(isOtherUserDataRequest("siapa saja daftar siswa yang meminjam buku hari ini?")).toBe(true);
      expect(isOtherUserDataRequest("siapa yang memiliki denda kerusakan buku?")).toBe(true);
    });

    it("tidak mengklasifikasikan pertanyaan pihak ketiga sebagai CATALOG", () => {
      expect(detectIntent("siapa yang sedang meminjam buku?", false)).not.toBe("CATALOG");
      expect(detectIntent("siapa saja siswa yang meminjam buku hari ini?", false)).not.toBe("CATALOG");
      expect(detectIntent("siapa yang memiliki denda kerusakan buku?", false)).not.toBe("CATALOG");
    });
  });

  describe("Pertanyaan Denda dan Peminjaman Pribadi", () => {
    it("mengenali pertanyaan denda pribadi dengan atau tanpa kata saya", () => {
      expect(detectIntent("Apakah saya memiliki denda?", false)).toBe("MY_FINES");
      expect(detectIntent("Dendanya berapa?", false)).toBe("MY_FINES");
      expect(detectIntent("Berapa dendanya?", false)).toBe("MY_FINES");
      expect(detectIntent("Apakah ada denda?", false)).toBe("MY_FINES");
      expect(detectIntent("Ada denda tidak?", false)).toBe("MY_FINES");
    });

    it("mengenali pertanyaan peminjaman aktif pribadi", () => {
      expect(detectIntent("Buku yang sedang saya pinjam apa saja?", false)).toBe("MY_LOANS");
      expect(detectIntent("Buku apa saja yang sedang terlambat dikembalikan?", false)).toBe("MY_LOANS");
    });
  });

  describe("Kueri Katalog dan Ebook dengan Bahasa Gaul", () => {
    it("mengenali pertanyaan ebook informal sebagai EBOOK_CATALOG", () => {
      expect(detectIntent("ebook apa aja yg ada?", false)).toBe("EBOOK_CATALOG");
      expect(detectIntent("buku digitalnya ada apa aja?", false)).toBe("EBOOK_CATALOG");
      expect(detectIntent("tunjukin ebook fisika", false)).toBe("EBOOK_CATALOG");
    });

    it("mengenali peminjaman dengan kata gaul sebagai MY_LOANS / MY_HISTORY", () => {
      expect(detectIntent("kapan hrs balikin buku?", false)).toBe("MY_LOANS");
      expect(detectIntent("buku apa yg sdh dikembalikan?", false)).toBe("MY_HISTORY");
      expect(detectIntent("buku apa yg kupinjam skrg?", false)).toBe("MY_LOANS");
    });
  });
});

describe("AI Pipeline — Proteksi Deterministik", () => {
  it("menolak permintaan password secara deterministik tanpa memanggil model", async () => {
    const res = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "password saya apa?" }],
    });
    expect(res.intent).toBe("PASSWORD");
    expect(res.message).toBe(PASSWORD_REFUSAL);
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("menjawab profil pengguna dari data sesi database yang terverifikasi", async () => {
    const res = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "siapa saya?" }],
    });
    expect(res.intent).toBe("MY_PROFILE");
    expect(res.message).toContain("Ahmad Siswa");
    expect(res.message).toContain("Siswa");
    expect(res.message).toContain("XII RPL 1");
    expect(res.message).toContain("NIS2024001");
    expect(res.message).toContain("ahmad@sekolah.sch.id");
    expect(res.message).not.toContain("password");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("menolak membaca transaksi orang lain secara deterministik", async () => {
    const res = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "tampilkan peminjaman milik Budi" }],
    });
    expect(res.message).toBe(OTHER_USER_REFUSAL);
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("menolak tugas akademik secara deterministik", async () => {
    const res = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "kerjakan soal matematika ini" }],
    });
    expect(res.intent).toBe("OUT_OF_SCOPE");
    expect(res.message).toContain("hanya dapat membantu");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("menolak permintaan source code / pembuatan aplikasi", async () => {
    const res = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "buatkan website perpustakaan pakai react" }],
    });
    expect(res.intent).toBe("CODING");
    expect(res.message).toContain("hanya dapat membantu");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("memberikan panduan penggunaan perpustakaan secara deterministik", async () => {
    const res = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "bagaimana cara meminjam buku?" }],
    });
    expect(res.intent).toBe("LIBRARY_GUIDE");
    expect(res.message).toContain("Panduan singkat penggunaan DigiLib");
    expect(res.message).toContain("Meminjam Buku");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("menolak siswa yang bertanya siapa yang sedang meminjam buku secara deterministik", async () => {
    const res = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "siapa yang sedang meminjam buku?" }],
    });
    expect(res.message).toBe(OTHER_USER_REFUSAL);
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("menolak guru yang bertanya siapa yang memiliki denda kerusakan buku secara deterministik", async () => {
    mockFindUnique.mockResolvedValue(mockUser({ role: "TEACHER" }));
    const res = await processChat({
      userId: USER_ID,
      messages: [{ role: "user", content: "siapa yang memiliki denda kerusakan buku?" }],
    });
    // Penolakan harus spesifik denda, bukan penolakan riwayat peminjaman.
    expect(res.intent).toBe("OPERATIONAL");
    expect(res.message).toBe(OTHER_USER_FINE_REFUSAL);
    expect(res.message).not.toBe(OTHER_USER_REFUSAL);
    expect(res.message.toLowerCase()).toContain("denda");
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it("memproses pertanyaan katalog mandiri setelah pertanyaan denda tanpa mewarisi kata denda", async () => {
    const res = await processChat({
      userId: USER_ID,
      messages: [
        { role: "user", content: "Apakah saya memiliki denda?" },
        { role: "assistant", content: "Kamu tidak memiliki denda." },
        { role: "user", content: "Ada buku apa saja?" },
      ],
    });
    expect(res.intent).toBe("BOOK_PHYSICAL");
    expect(mockBuildCatalogAnswer).toHaveBeenCalledWith(
      "BOOK_PHYSICAL",
      "Ada buku apa saja?",
      "PHYSICAL"
    );
  });
});
