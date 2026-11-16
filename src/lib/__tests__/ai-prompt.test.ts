/**
 * AI Chat — Penyusun System Prompt
 *
 * Fokus: prompt harus (a) mengizinkan percakapan umum & bantuan belajar,
 * (b) memaksa AI memakai data katalog nyata, dan (c) mencegah AI mengklaim
 * telah membaca isi buku yang sebenarnya tidak tersimpan di DigiLib.
 */

import { buildSystemPrompt, FULL_TEXT_NOTE } from "@/lib/ai/prompt";
import { CATALOG_CONTEXT_MARKER } from "@/lib/ai/types";
import type { CatalogBook, CatalogStats } from "@/lib/ai/catalog";

const sampleBook: CatalogBook = {
  id: "book-1",
  title: "Fisika SMA Kelas X",
  author: "Budi Santoso",
  publisher: "Erlangga",
  year: 2021,
  isbn: "978-123",
  category: "IPA",
  description: "Buku teks fisika untuk SMA kelas X.",
  stock: 5,
  available: 2,
  coverUrl: null,
};

const sampleStats: CatalogStats = {
  totalTitles: 120,
  totalCopies: 300,
  totalAvailable: 275,
  totalEbooks: 18,
  physicalTitles: 102,
  physicalCopies: 300,
  physicalAvailable: 275,
  activeLoans: 25,
  totalBorrows: 640,
  categories: 8,
  archivedTitles: 0,
  archivedEbooks: 0,
  archivedPhysicalTitles: 0,
};

describe("buildSystemPrompt()", () => {
  it("mengizinkan jawaban umum dan bantuan belajar pada prompt dasar", () => {
    const prompt = buildSystemPrompt({
      intent: "CHITCHAT",
      books: [],
      stats: null,
      hasHistory: false,
    });

    expect(prompt).toContain("ASISTEN PERCAKAPAN");
    expect(prompt).toContain("ASISTEN BELAJAR");
    expect(prompt).toContain("Jelaskan konsep");
    expect(prompt).toContain("buatkan soal latihan");
    // Tidak boleh ada larangan menjawab di luar katalog.
    expect(prompt).not.toMatch(/HANYA boleh menjawab pertanyaan tentang katalog/i);
  });

  it("tidak menyertakan data katalog untuk percakapan umum", () => {
    const prompt = buildSystemPrompt({
      intent: "CHITCHAT",
      books: [],
      stats: null,
      hasHistory: false,
    });
    expect(prompt).not.toContain(CATALOG_CONTEXT_MARKER);
  });

  it("menyertakan data katalog nyata untuk pertanyaan koleksi", () => {
    const prompt = buildSystemPrompt({
      intent: "CATALOG",
      books: [sampleBook],
      stats: null,
      hasHistory: false,
    });

    expect(prompt).toContain(CATALOG_CONTEXT_MARKER);
    expect(prompt).toContain(sampleBook.title);
    expect(prompt).toContain(sampleBook.author);
    expect(prompt).toContain("Tersedia sekarang: 2 eksemplar");
  });

  it("memuat aturan gaya jawaban ringkas pada setiap intent", () => {
    const prompt = buildSystemPrompt({
      intent: "CATALOG",
      books: [sampleBook],
      stats: null,
      hasHistory: false,
    });
    expect(prompt).toContain("GAYA JAWABAN (WAJIB)");
    expect(prompt).toContain("Jawab LANGSUNG ke inti pertanyaan");
    expect(prompt).toContain("JANGAN mengulang pertanyaan pengguna");
    expect(prompt).toContain("JANGAN menutup dengan tawaran bantuan");
  });

  it("melarang pengubahan data katalog secara bebas", () => {
    const prompt = buildSystemPrompt({
      intent: "CATALOG",
      books: [sampleBook],
      stats: null,
      hasHistory: false,
    });
    expect(prompt).toContain("JANGAN mengarang judul buku");
  });

  it("tidak menyertakan penanda internal ke dalam prompt", () => {
    const prompt = buildSystemPrompt({
      intent: "CATALOG",
      books: [sampleBook],
      stats: null,
      hasHistory: false,
    });
    expect(prompt).not.toContain("BOOK_ID");
  });

  it("menyatakan honestly saat buku sedang tidak ada di katalog", () => {
    const prompt = buildSystemPrompt({
      intent: "CATALOG",
      books: [],
      stats: null,
      hasHistory: false,
    });
    expect(prompt).toContain("tidak menghasilkan buku yang cocok");
    expect(prompt).not.toContain("Judul:");
  });

  it("meminta AI menyatakan jujur soal isi lengkap yang tidak tersedia", () => {
    const prompt = buildSystemPrompt({
      intent: "BOOK_SUMMARY",
      books: [sampleBook],
      stats: null,
      hasHistory: false,
    });

expect(prompt).toContain(FULL_TEXT_NOTE);
    expect(prompt).toContain("JANGAN menulis ringkasan isi");
    expect(prompt).toContain(sampleBook.title);
    // Metadata buku tetap boleh diberikan agar jawaban tetap informatif.
    expect(prompt).toContain("Penulis: Budi Santoso");
  });

  it("berjujur saat buku yang dirujuk tidak bisa diidentifikasi", () => {
    const prompt = buildSystemPrompt({
      intent: "BOOK_SUMMARY",
      books: [],
      stats: null,
      hasHistory: false,
    });
    expect(prompt).toContain("tidak dapat diidentifikasi");
    expect(prompt).toContain(FULL_TEXT_NOTE);
  });

  it("menyertakan angka statistik aktual untuk pertanyaan jumlah koleksi", () => {
    const prompt = buildSystemPrompt({
      intent: "STATS",
      books: [],
      stats: sampleStats,
      hasHistory: false,
    });

    expect(prompt).toContain("Jumlah judul buku fisik: 102");
    expect(prompt).toContain("Total eksemplar buku fisik: 300");
    expect(prompt).toContain("Eksemplar buku fisik yang bisa dipinjam sekarang: 275");
    expect(prompt).toContain("Jumlah ebook terdaftar (format EBOOK, bukan buku fisik): 18");
    expect(prompt).toContain("Transaksi peminjaman aktif: 25");
    expect(prompt).toContain(
      "Transaksi peminjaman aktif + selesai (tanpa pengajuan/ditolak/dibatalkan): 640"
    );
    expect(prompt).toContain("Jangan mengarang angka lain");
  });

  it("tidak menyertakan statistik untuk intent lain", () => {
    const prompt = buildSystemPrompt({
      intent: "LEARNING",
      books: [],
      stats: sampleStats,
      hasHistory: true,
    });
    expect(prompt).not.toContain("Jumlah judul buku: 120");
    expect(prompt).toContain("riwayat");
  });

  it("menandai adanya riwayat percakapan untuk pertanyaan lanjutan", () => {
    const withHistory = buildSystemPrompt({
      intent: "LEARNING",
      books: [],
      stats: null,
      hasHistory: true,
    });
    const withoutHistory = buildSystemPrompt({
      intent: "LEARNING",
      books: [],
      stats: null,
      hasHistory: false,
    });

    expect(withHistory).toContain("merujuk ke jawaban sebelumnya");
    expect(withoutHistory).toContain("Belum ada riwayat percakapan");
  });

  it("memakai konteks katalog bila tersedia pada permintaan pembelajaran", () => {
    const prompt = buildSystemPrompt({
      intent: "LEARNING",
      books: [sampleBook],
      stats: null,
      hasHistory: false,
    });
    expect(prompt).toContain(CATALOG_CONTEXT_MARKER);
    expect(prompt).toContain(sampleBook.title);
  });

  it("membatasi deskripsi buku agar prompt tetap ringkas", () => {
    const longBook = { ...sampleBook, description: "x".repeat(5000) };
    const prompt = buildSystemPrompt({
      intent: "CATALOG",
      books: [longBook],
      stats: null,
      hasHistory: false,
    });
    const line = prompt.split("\n").find((l) => l.includes("Deskripsi:")) ?? "";
    expect(line.length).toBeLessThan(400);
  });
});

describe("buildSystemPrompt() — personalisasi identitas", () => {
  it("menyertakan identitas akun beserta sapaan yang benar", () => {
    const prompt = buildSystemPrompt({
      intent: "CHITCHAT",
      books: [],
      stats: null,
      hasHistory: false,
      identity: { name: "Yoga", role: "TEACHER", gender: "MALE" },
    });

    expect(prompt).toContain("IDENTITAS PENGGUNA");
    expect(prompt).toContain("Yoga");
    expect(prompt).toContain("TEACHER");
    expect(prompt).toContain('"Pak Yoga"');
    expect(prompt).toContain("JANGAN meminta pengguna mengetik namanya");
  });

  it("memakai nama polos bila gender tidak tersedia", () => {
    const prompt = buildSystemPrompt({
      intent: "CHITCHAT",
      books: [],
      stats: null,
      hasHistory: false,
      identity: { name: "Staf Tata Usaha", role: "STAFF", gender: null },
    });

    expect(prompt).toContain('"Staf Tata Usaha"');
    expect(prompt).not.toContain('"Pak Staf Tata Usaha"');
    expect(prompt).not.toContain('"Bu Staf Tata Usaha"');
  });

  it("tetap kompatibel tanpa identitas", () => {
    const prompt = buildSystemPrompt({
      intent: "CHITCHAT",
      books: [],
      stats: null,
      hasHistory: false,
    });
    expect(prompt).not.toContain("IDENTITAS PENGGUNA");
  });
});

describe("buildSystemPrompt() — larangan source code dan lingkup DigiLib", () => {
  const allIntents = [
    "CHITCHAT",
    "LEARNING",
    "CATALOG",
    "BOOK_SUMMARY",
    "STATS",
    "CODING",
  ] as const;

  it.each(allIntents)("melarang source code pada intent %s", (intent) => {
    const prompt = buildSystemPrompt({
      intent,
      books: [],
      stats: null,
      hasHistory: false,
    });

    expect(prompt).toContain("JANGAN PERNAH menampilkan source code");
    expect(prompt).toContain(
      "Maaf, saya hanya dapat membantu seputar perpustakaan DigiLib"
    );
    expect(prompt).toContain("konsep pemrograman");
  });

  it("menegaskan lingkup bantuan hanya perpustakaan dan pembelajaran SMK", () => {
    const prompt = buildSystemPrompt({
      intent: "CHITCHAT",
      books: [],
      stats: null,
      hasHistory: false,
    });

    expect(prompt).toContain("perpustakaan DigiLib");
    expect(prompt).toContain("siswa SMK");
    expect(prompt).toContain("HANYA bantu hal yang berkaitan");
    expect(prompt).toContain("pertanyaan ringan mata pelajaran SMK");
  });

  it("melarang pembuatan kode meski beralasan tugas sekolah", () => {
    const prompt = buildSystemPrompt({
      intent: "LEARNING",
      books: [],
      stats: null,
      hasHistory: false,
    });

    expect(prompt).toContain("beralasan tugas sekolah");
    expect(prompt).toContain("blok kode (tanda ```)");
  });

  it("melarang kebocoran instruksi sistem dan kredensial", () => {
    const prompt = buildSystemPrompt({
      intent: "CHITCHAT",
      books: [],
      stats: null,
      hasHistory: false,
    });

    expect(prompt).toContain("system prompt / instruksi Anda");
    expect(prompt).toContain("environment variable");
    expect(prompt).toContain("API key");
    expect(prompt).toContain("kredensial");
    expect(prompt).toContain("membangun ulang sistem");
  });

  it("mengarahkan intent CODING untuk menolak tanpa menampilkan kode", () => {
    const prompt = buildSystemPrompt({
      intent: "CODING",
      books: [],
      stats: null,
      hasHistory: false,
    });

    expect(prompt).toContain("PETUNJUK UNTUK PESAN INI");
    expect(prompt).toContain("DILARANG dipenuhi");
    expect(prompt).toContain("JANGAN menyertakan blok kode");
    expect(prompt).toContain("konsep pemrograman");
    expect(prompt).toContain("langkah membuat program");
  });

  it("melarang penjelasan konsep pemrograman tanpa kode", () => {
    const prompt = buildSystemPrompt({
      intent: "LEARNING",
      books: [],
      stats: null,
      hasHistory: false,
    });

    expect(prompt).toContain("konsep pemrograman");
    expect(prompt).toContain("langkah membuat program");
    expect(prompt).not.toContain(
      "Menjelaskan konsep pemrograman secara umum tanpa menuliskan kode tetap boleh"
    );
  });
});