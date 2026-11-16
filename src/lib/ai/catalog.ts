import { prisma } from "@/lib/prisma";
import { SMK_MAJORS } from "@/lib/config/smk";
import { EBOOK_FORMAT, PHYSICAL_FORMAT } from "@/lib/config/ebook";
import {
  AVAILABLE_QUERY,
  BOOK_REFERENCE_QUERY,
  COUNT_QUERY,
  CatalogAnswer,
  STOCK_QUERY,
  buildBookSummaryAnswer,
  buildCatalogListAnswer,
  buildCategoryAnswer,
  buildCategoryNotFoundAnswer,
  buildSingleCategoryAnswer,
  buildAmbiguousCategoryAnswer,
  buildStatsAnswer,
} from "./catalogAnswer";
import {
  EBOOK,
  PHYSICAL,
  hasFormatCue,
  resolveCatalogFormat,
  type CatalogFormat,
  type CatalogFormatScope,
} from "./catalogFormat";

export interface CatalogBook {
  id: string;
  title: string;
  author: string;
  publisher: string | null;
  year: number | null;
  isbn: string | null;
  category: string;
  description: string;
  stock: number;
  available: number;
  coverUrl: string | null;
  /** Dimensi kurikulum SMK (opsional agar tetap kompatibel dengan data lama). */
  grade?: string | null;
  subject?: string | null;
  major?: string | null;
  format?: string;
}

export interface CatalogStats {
  /** Jumlah judul unik di katalog aktif. */
  totalTitles: number;
  /** Jumlah seluruh eksemplar fisik (sum stok buku aktif). */
  totalCopies: number;
  /** Eksemplar yang bisa dipinjam sekarang (stok âˆ’ peminjaman aktif). */
  totalAvailable: number;
  /** Jumlah judul berformat ebook. */
  totalEbooks: number;
  /** Jumlah judul buku fisik (format PHYSICAL) di katalog aktif. */
  physicalTitles: number;
  /** Total eksemplar buku fisik (sum stok format PHYSICAL). */
  physicalCopies: number;
  /** Eksemplar buku fisik yang bisa dipinjam sekarang. */
  physicalAvailable: number;
  /** Jumlah transaksi peminjaman yang sedang aktif (BORROWED/OVERDUE). */
  activeLoans: number;
  /** Jumlah transaksi peminjaman aktif + selesai (BORROWED/OVERDUE/RETURNED). */
  totalBorrows: number;
  categories: number;
  /** Jumlah judul di arsip (archived). */
  archivedTitles: number;
  /** Jumlah judul ebook di arsip. */
  archivedEbooks: number;
  /** Jumlah judul buku fisik di arsip. */
  archivedPhysicalTitles: number;
}

const ACTIVE_BORROW_STATUSES = ["BORROWED", "OVERDUE"];

const bookSelect = {
  id: true,
  title: true,
  author: true,
  publisher: true,
  year: true,
  isbn: true,
  description: true,
  stock: true,
  grade: true,
  subject: true,
  major: true,
  format: true,
  coverUrl: true,
  category: { select: { name: true } },
  _count: { select: { borrows: { where: { status: { in: ACTIVE_BORROW_STATUSES } } } } },
} as const;

type BookRow = {
  id: string;
  title: string;
  author: string;
  publisher: string | null;
  year: number | null;
  isbn: string | null;
  description: string | null;
  stock: number;
  grade: string | null;
  subject: string | null;
  major: string | null;
  format: string;
  coverUrl: string | null;
  category: { name: string } | null;
  _count: { borrows: number };
};

function toCatalogBook(row: BookRow): CatalogBook {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    year: row.year,
    isbn: row.isbn,
    category: row.category?.name ?? "-",
    description: (row.description ?? "").trim(),
    stock: row.stock,
    available: Math.max(0, row.stock - row._count.borrows),
    coverUrl: row.coverUrl,
    grade: row.grade,
    subject: row.subject,
    major: row.major,
    format: row.format,
  };
}

/**
 * Kata kunci yang terlalu umum tidak berguna untuk pencarian katalog.
 * Termasuk kata yang hanya menjelaskan ("ringkas buku ini") dan kata penanda
 * dimensi kurikulum ("kelas", "jurusan") yang sudah ditangani terpisah.
 */
const STOPWORDS = new Set([
  "yang", "dari", "untuk", "pada", "dengan", "adalah", "apa", "buku",
  "tolong", "carikan", "cari", "dong", "sih", "ya", "dalam", "tentang",
  "mengenai", "the", "and", "for", "sebuah", "atau", "saya", "kamu",
  "bisa", "boleh", "kah", "itu", "ini", "rangkum", "ringkas", "ringkasan",
  "summary", "summari", "bahas", "bahasakan", "jelaskan", "jelask",
  "sebutkan", "contoh", "tolong", "tolongnya", "dong", "coba", "mungkin",
  "boleh", "minta", "silakan",
  // Rujukan ke buku yang sudah dibahas, bukan kata kunci judul.
  "tadi", "tersebut",
  // Dimensi kurikulum & kata permintaan yang tidak berguna sebagai kata kunci.
  "kelas", "tingkat", "jurusan", "konsentrasi", "keahlian", "mapel",
  "pelajaran", "mata", "belajar", "butuh", "ingin", "pengen", "rekomendasi",
  "rekomendasikan", "saran", "sarankan", "ada", "punya", "sesuai", "cocok",
  "khusus", "tentangnya", "saja", "semua", "terdaftar", "perpustakaan",
  "perpustakaannya", "perpus", "perpusnya", "tersedia", "berapa", "jumlah", "banyak", "total",
  "ebook", "ebooks", "katalog", "katalognya", "kategori", "category",
  "judulnya", "namanya", "daftarnya", "rinciannya", "detail", "detailnya", "rinci", "rinciannya",
  "berikan", "kasih", "info", "informasi", "penulisnya", "pengarangnya", "siapa", "penulis", "pengarang", "pencipta", "penciptanya",
  // Sinonim ebook dan variasi digital/elektronik
  "digital", "elektronik", "digitalnya", "elektroniknya", "bacaan",
  // Penanda format buku fisik/cetak. Bukan kata kunci judul.
  "fisik", "fisiknya", "cetak", "cetakan", "hardcopy", "softcopy",
  // Singkatan dan slang bahasa Indonesia
  "aja", "yg", "gak", "ga", "nggak", "tidak", "mau", "tunjukin", "liat", "sini",
  "daftar", "kupinjam", "pinjamanku",
  // Kata kerja baca. "Ebook yang bisa dibaca" adalah pertanyaan ketersediaan,
  // bukan pencarian judul berkata "dibaca".
  "baca", "dibaca", "membaca",
  // Kata tampil dan koleksi. "Tampilkan semua koleksi" adalah permintaan
  // daftar, bukan pencarian judul berkata "tampilkan"/"koleksi".
  "tampilkan", "perlihatkan", "koleksi", "kita",
  // Kata ketersediaan/stok. Pertanyaan "stoknya berapa?" bukan mencari judul
  // berisi kata "stok"; topik buku tetap diambil dari konteks sebelumnya.
  "stok", "stoknya", "ketersediaan", "ketersediaannya", "persediaan",
  "bukunya", "versi", "versinya", "lain", "lainnya",
  // Kata tanya, sambung, dan penanda waktu. Ini BUKAN kata kunci judul, sehingga
  // "Apakah buku Bumi Manusia tersedia?" tidak boleh mencari judul "apakah bumi
  // manusia", dan "Sekarang buku apa saja?" tidak boleh mencari "sekarang".
  "apakah", "kalau", "kalo", "sekarang", "saat", "kini", "ketika",
  // Kata kuantitas turunan. "Berapa jumlahnya?" adalah pertanyaan hitung, bukan
  // pencarian judul "jumlahnya".
  "jumlahnya", "totalnya", "banyaknya", "keseluruhan", "seluruhnya",
  // Kata kerja penyajian hasil yang tidak muncul pada judul buku.
  "ditemukan", "menampilkan", "tampil", "mohon", "hendak", "perlu",
  // Instruksi jawaban (bukan topik pencarian buku).
  "jawab", "jawablah", "singkat", "data",
  // Status koleksi (aktif/arsip) adalah kualifikasi jumlah, bukan kata kunci judul.
  "aktif", "active", "arsip", "diarsipkan", "archived", "nonarsip", "non-arsip", "unarchived",
]);

/**
 * Kata pendek yang tetap bermakna di konteks perpustakaan sekolah, sehingga
 * tidak ikut terbuang oleh ambang panjang kata.
 */
const SHORT_DOMAIN_TERMS = new Set([
  "ipa", "ips", "ipb", "sma", "smk", "smp", "sdn", "mtk", "pai", "pjok",
  "ppkn", "informatika", "fisika", "kimia", "biologi", "rpl", "tkj", "dkv",
  "akl", "pm", "tp",
]);

export function extractSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\be\s*-?\s*books?\b|\bebooks?\b/g, " ")
    .replace(/\bbuku\s+digital(?:nya)?\b/g, " ")
    .replace(/\bbuku\s+elektronik(?:nya)?\b/g, " ")
    .replace(/\bbacaan\s+digital\b/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .filter((w) => w.length > 3 || SHORT_DOMAIN_TERMS.has(w));
}

/**
 * Kelompok istilah yang saling merujuk di katalog sekolah. Pengguna sering
 * menulis istilah sehari-hari ("coding") sementara judul buku memakai istilah
 * kurikulum ("Pemrograman"). Ekspansi ini HANYA menambah kata kunci pencarian,
 * tidak mengubah label kriteria yang ditampilkan ke pengguna.
 */
const SYNONYM_GROUPS: string[][] = [
  [
    "coding", "koding", "ngoding", "programming", "pemrograman", "pemrogaman",
    "program", "algoritma", "algoritme",
  ],
  ["komputer", "informatika", "tik", "rpl", "tkj", "jaringan"],
  ["matematika", "mtk", "math", "mathematics"],
  ["inggris", "english"],
  ["indonesia", "bahasa"],
  ["ipa", "sains", "science"],
  ["ips", "sosial"],
  ["biologi", "biology"],
  ["fisika", "physics"],
  ["kimia", "chemistry"],
  ["ekonomi", "economics", "akuntansi", "akl"],
  ["sejarah", "history"],
  ["geografi", "geography"],
  ["desain", "design", "dkv", "multimedia"],
  ["otomotif", "mesin", "teknik mesin"],
  ["keperawatan", "kesehatan"],
];

/** Tambahkan sinonim untuk setiap kata kunci (tetap mempertahankan aslinya). */
export function expandSearchTerms(terms: string[]): string[] {
  const expanded = new Set<string>();
  for (const term of terms) {
    expanded.add(term);
    for (const group of SYNONYM_GROUPS) {
      if (group.some((word) => word === term || word.includes(term) || term.includes(word))) {
        for (const word of group) expanded.add(word);
      }
    }
  }
  return Array.from(expanded);
}

/** Jarak edit Levenshtein sederhana untuk toleransi salah ketik. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Kemiripan 0..1 antara kata kunci dan sebuah kata pada data buku. */
function similarity(term: string, word: string): number {
  if (!term || !word) return 0;
  if (word.includes(term) || term.includes(word)) return 1;
  const distance = levenshtein(term, word);
  return 1 - distance / Math.max(term.length, word.length);
}

/**
 * Pencarian toleran salah ketik. Dipakai HANYA bila pencarian normal kosong,
 * sehingga tidak mengubah hasil pencarian yang sudah tepat. Kandidat dibaca
 * dari katalog aktif lalu dicocokkan dengan kemiripan kata (ambang 0,72).
 */
async function findFuzzyCatalogBooks(
  terms: string[],
  resolved: ResolvedCatalogQuery,
  format?: CatalogFormatScope
): Promise<CatalogBook[]> {
  if (terms.length === 0) return [];

  // Format juga difilter di query database, bukan hanya saat menyusun jawaban.
  const rows = await prisma.book.findMany({
    where: {
      archivedAt: null,
      ...(format && format !== "ALL" ? { format } : {}),
    },
    select: bookSelect,
  });
  const books = rows.map(toCatalogBook);
  const scored = books
    .map((book) => {
      const haystack = [
        book.title,
        book.author,
        book.subject ?? "",
        book.major ?? "",
        book.category,
        book.description,
      ]
        .join(" ")
        .toLowerCase();
      const words = haystack.split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
      let best = 0;
      for (const term of terms) {
        for (const word of words) {
          best = Math.max(best, similarity(term, word));
        }
      }
      return { book, score: best };
    })
    .filter((entry) => entry.score >= 0.72)
    .filter((entry) => !resolved.grade || entry.book.grade === resolved.grade)
    .filter(
      (entry) =>
        !resolved.major ||
        (entry.book.major ?? "").toLowerCase().includes(resolved.major.toLowerCase()) ||
        (entry.book.subject ?? "").toLowerCase().includes(resolved.major.toLowerCase())
    )
    .sort((a, b) => b.score - a.score);

  return scored.map((entry) => entry.book);
}

/** Pemetaan angka/romawi tingkat kelas ke kode yang tersimpan di database. */
const GRADE_BY_TOKEN: Record<string, string> = {
  "10": "X",
  "11": "XI",
  "12": "XII",
  x: "X",
  xi: "XI",
  xii: "XII",
};

/**
 * Ambil tingkat kelas dari pertanyaan. Mendukung "kelas 10", "kelas X",
 * "tingkat 11", dan "kelas XI" agar pengguna tidak harus tahu penulisan kode.
 */
export function extractGrade(query: string): string | null {
  const match = query
    .toLowerCase()
    .match(/\b(?:kelas|tingkat)\s*(10|11|12|xii|xi|x)\b/);
  return match ? GRADE_BY_TOKEN[match[1]] ?? null : null;
}

/**
 * Temukan jurusan yang disebut pengguna, baik lewat nama lengkap
 * ("Teknik Komputer dan Jaringan") maupun kode ("TKJ").
 */
export function extractMajor(query: string): string | null {
  const lower = query.toLowerCase();

  for (const major of SMK_MAJORS) {
    if (lower.includes(major.name.toLowerCase())) return major.name;
  }

  const tokens = lower.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const major of SMK_MAJORS) {
    if (tokens.includes(major.code.toLowerCase())) return major.name;
  }

  return null;
}

export interface ResolvedCatalogQuery {
  /** Kata kunci bebas (judul/penulis/mapel/jurusan). */
  terms: string[];
  /** Kode kelas yang diminta ("X"/"XI"/"XII"), bila ada. */
  grade: string | null;
  /** Nama jurusan yang diminta, bila ada. */
  major: string | null;
}

/** Uraikan pertanyaan menjadi kata kunci, kelas, dan jurusan. */
export function resolveCatalogQuery(query: string): ResolvedCatalogQuery {
  return {
    terms: extractSearchTerms(query),
    grade: extractGrade(query),
    major: extractMajor(query),
  };
}
/**
 * Pola pertanyaan katalog mandiri yang meminta daftar koleksi secara independen:
 * "Ada buku apa saja?", "Ebook apa saja yang tersedia?", "Buku apa saja yang tersedia?",
 * "Tampilkan semua koleksi", "Koleksi apa saja yang ada".
 */
export function isStandaloneCatalogQuery(query: string): boolean {
  const q = query.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  // Permintaan umum seluruh buku / koleksi katalog
  const generalBooks =
    /\b(?:ada\s+)?buku\s+(?:apa\s+saja|apa\s+aja|apaan\s+aja)\s*(?:yang\s+)?(?:ada|tersedia)?\b/.test(q) ||
    /\b(?:apa\s+saja|apa\s+aja)\s+buku\s+(?:yang\s+)?(?:ada|tersedia)?\b/.test(q) ||
    /\b(?:tampilkan|lihat|daftar|koleksi)\s+(?:semua\s+)?(?:buku|koleksi|perpustakaan)\b/.test(q) ||
    /\b(?:koleksi|buku)\s+apa\s+(?:saja|aja)\s+(?:yang\s+)?(?:ada|tersedia|dimiliki)\b/.test(q);

  if (generalBooks) return true;

  // Permintaan seluruh koleksi ebook
  if (hasFormatCue(query) && resolveCatalogFormat(query) === EBOOK) {
    const generalEbook =
      /\b(?:ada\s+)?(?:ebook|buku\s+digital)\s+(?:apa\s+saja|apa\s+aja|apaan\s+aja)\s*(?:yang\s+)?(?:ada|tersedia)?\b/.test(q) ||
      /\b(?:apa\s+saja|apa\s+aja)\s+(?:ebook|buku\s+digital)\s*(?:yang\s+)?(?:ada|tersedia)?\b/.test(q) ||
      /\b(?:daftar|koleksi|tampilkan)\s+(?:semua\s+)?(?:ebook|buku\s+digital)\b/.test(q) ||
      /\b(?:koleksi|daftar)\s+(?:ebook|buku\s+digital)\s+(?:yang\s+)?(?:ada|tersedia)?\b/.test(q);
    if (generalEbook) return true;
  }

  // Permintaan umum buku/ebook yang tersedia, termasuk bentuk
  // "buku apa yang tersedia di katalog" dan "ebook apa yang tersedia".
  // Pertanyaan ini mandiri: TIDAK boleh mewarisi topik/format sebelumnya.
  const availableBooks =
    /\b(?:buku|ebook|koleksi|katalog)\s+(?:apa\s+(?:saja|aja|yang)\s+)?(?:yang\s+)?(?:bisa\s+dipinjam|tersedia|ada|dimiliki|dapat\s+dipinjam|bisa\s+dibaca)\b/.test(
      q
    ) ||
    /\b(?:apa\s+saja|apa\s+aja)\s+(?:buku|ebook)\s+(?:yang\s+)?(?:tersedia|ada|bisa\s+dipinjam)\b/.test(
      q
    );

  if (availableBooks) return true;

  return false;
}

/**
 * Pertanyaan non-katalog dari riwayat sebelumnya yang DILARANG disuntikkan ke kueri katalog:
 * denda, pinjaman pribadi, profil akun, password, panduan sistem.
 */
function isNonCatalogTopic(text: string): boolean {
  const t = text.toLowerCase();
  // Topik model/provider/AI/role bukan katalog; jangan diwariskan.
  if (/\b(model|provider|ai|role)\b/.test(t)) return true;
  // Topik denda
  if (/\b(denda\w*|tagihan\w*|fine\w*)\b/.test(t)) return true;
  // Topik profil
  if (/\b(siapa\s+saya|profil\s+saya|akun\s+saya|identitas\s+saya)\b/.test(t)) return true;
  // Topik password/kredensial
  if (/\b(password|kata\s*sandi|token|kredensial)\b/.test(t)) return true;
  // Topik panduan
  if (/\b(bagaimana\s+cara|gimana\s+cara|aturan\s+perpustakaan|tata\s+cara)\b/.test(t)) return true;
  // Sapaan/terima kasih bukan topik katalog; jangan diwariskan ke pertanyaan lanjutan.
  if (
    /\b(hai|haii|halo|halo2|hei|hi|hey|selamat\s+(pagi|siang|sore|malam)|terima\s*kasih|makasih|thanks)\b/.test(
      t
    )
  ) {
    return true;
  }
  // Topik peminjaman pribadi murni (kapan kembali, jatuh tempo saya)
  if (/\b(jatuh\s*tempo|tenggat|kembalikan(?:nya)?\s+kapan|kapan\s+(?:harus\s+)?kembalikan)\b/.test(t)) return true;

  return false;
}

/**
 * Gabungkan pesan lanjutan dengan topik sebelumnya.
 *
 * Contoh: "Saya ingin belajar jaringan komputer." lalu "Yang untuk kelas 11 ada?".
 * Pesan kedua tidak punya kata kunci sendiri, jadi topik pesan sebelumnya
 * dipakai ulang sementara isyarat kelas dari pesan kedua tetap dipertahankan.
 *
 * Pertanyaan mandiri ("Ada buku apa saja?", "Ebook apa saja yang tersedia?", dsb.)
 * TIDAK PERNAH digabung dengan topik sebelumnya.
 */
export function mergeCatalogQuery(
  current: string,
  previousUserMessages: string[]
): string {
  // 1. Jika kueri saat ini adalah pertanyaan mandiri: proses secara independen.
  if (isStandaloneCatalogQuery(current)) {
    return current;
  }

  // 2. Jika kueri saat ini sudah punya kata kunci sendiri: pakai kueri saat ini.
  // Namun pertanyaan lanjutan yang hanya meminta judul/daftar/detail dari hasil
  // sebelumnya (mis. "Apa judulnya?", "Sebutkan judul buku dari kategori tersebut")
  // tetap harus mewarisi konteks, meskipun secara tekstual mengandung kata benda
  // generik. Kecuali ada dimensi/kata kunci spesifik baru, biarkan langkah
  // penggabungan konteks berjalan.
  const currentResolved = resolveCatalogQuery(current);
  const asksTitleOrListEarly =
    /\b(judul(?:nya)?|namanya|daftar(?:nya)?|sebutkan|tampilkan|apa\s+saja|apa\s+aja|detail(?:nya)?|rinci(?:an)?)\b/i.test(
      current
    );
  const hasOnlyFollowUpReference =
    asksTitleOrListEarly &&
    !/\b(kelas|tingkat|jurusan|konsentrasi|keahlian)\b/i.test(current);
  if (currentResolved.terms.length > 0 && !hasOnlyFollowUpReference) {
    return current;
  }

  // 3. Hanya gabungkan jika ada sinyal lanjutan yang jelas (dimensi kelas/jurusan,
  //    rujukan ke buku/koleksi sebelumnya, pertanyaan stok/ketersediaan/jumlah,
  //    atau permintaan menampilkan judul/detail dari hasil yang baru dibahas).
  const currentLower = current.toLowerCase();
  const hasDimension = currentResolved.grade !== null || currentResolved.major !== null;
  const refersToPreviousBook = BOOK_REFERENCE_QUERY.test(current);
  const asksStock = STOCK_QUERY.test(current);
  const asksAvailability = AVAILABLE_QUERY.test(currentLower);
  // Pertanyaan hitung ("Berapa jumlahnya?") setelah daftar katalog mewarisi
  // topik/format sebelumnya, sehingga "2 judul buku" atau "2 ebook" dijawab
  // sesuai koleksi yang barusan dibahas — bukan jatuh ke pencarian kata
  // "jumlahnya". Pola COUNT_QUERY peka huruf besar-kecil, jadi teks dinormalkan
  // lebih dulu ("Berapa" di awal kalimat tetap terdeteksi).
  const asksCount = COUNT_QUERY.test(currentLower);
  const asksTitleOrList =
    /\b(judul(?:nya)?|sebutkan|tampilkan|daftar|apa\s+saja|apa\s+aja|apa\s+saja\s+bukunya|bukunya\s+apa|apa\s+judul|yang\s+mana|detail(?:nya)?|rinci(?:an)?|daftarnya)\b/i.test(
      current
    );
  const hasFollowUpSignal =
    hasDimension ||
    refersToPreviousBook ||
    asksStock ||
    asksAvailability ||
    asksCount ||
    asksTitleOrList ||
    /\b(yang\s+(?:untuk|buat|tadi|lain|lainnya|itu|tersebut)|ada\s+(?:yang\s+)?lain|rekomendasi\s+lain|selain\s+itu|kalau\s+untuk|kalo\s+untuk|versi\s+lain|kategori\s+(?:itu|tersebut|tadi))\b/i.test(
      current
    );

  if (!hasFollowUpSignal) {
    return current;
  }

  // 4. Cari pesan sebelumnya yang relevan (topik katalog, bukan denda/profil/pinjaman pribadi).
  for (let i = previousUserMessages.length - 1; i >= 0; i -= 1) {
    const previous = previousUserMessages[i];
    if (isNonCatalogTopic(previous)) {
      continue;
    }
    const prevResolved = resolveCatalogQuery(previous);
    const previousHasCatalogContext =
      prevResolved.terms.length > 0 ||
      prevResolved.grade !== null ||
      prevResolved.major !== null ||
      hasFormatCue(previous) ||
      isStandaloneCatalogQuery(previous) ||
      /\b(kategori|category)\b/i.test(previous);
    // Query sebelumnya yang hanya menyebut format ("Ada versi ebook?") atau
    // bertanya daftar/kategori/judul koleksi tetap menjadi konteks topik/format
    // untuk lanjutan ("Berapa jumlahnya?", "Apa judulnya?", "Buku dari kategori
    // tersebut apa saja?").
    if (previousHasCatalogContext) {
      // Lanjutan hitung ("Berapa jumlahnya?") mewarisi TOPIK/FORMAT, tetapi
      // TIDAK mewarisi kata ketersediaan dari pertanyaan sebelumnya. Tanpa ini,
      // "Buku apa saja yang tersedia?" + "Berapa jumlahnya?" dihitung sebagai
      // 15 eksemplar (metrik berbeda), padahal yang ditanyakan adalah jumlah
      // judul yang baru saja didaftar (2 judul). Kata ketersediaan hanya
      // dipertahankan bila pertanyaan lanjutan sendiri menanyakannya.
      const topicContext =
        asksCount && !asksStock && !asksAvailability
          ? previous.replace(
              /\b(tersedia|bisa\s+dipinjam|dapat\s+dipinjam|bisa\s+dibaca)\b/gi,
              " "
            )
          : previous;
      return `${topicContext} ${current}`.replace(/\s+/g, " ").trim();
    }
  }

  return current;
}

function buildTermOr(terms: string[]) {
  return terms.flatMap((term) => [
    { title: { contains: term } },
    { author: { contains: term } },
    { description: { contains: term } },
    { subject: { contains: term } },
    { major: { contains: term } },
    { category: { name: { contains: term } } },
  ]);
}

/** Skor relevansi sederhana agar hasil paling sesuai tampil lebih dulu. */
function scoreBook(
  book: CatalogBook,
  { terms, grade, major }: ResolvedCatalogQuery
): number {
  const title = book.title.toLowerCase();
  const subject = (book.subject ?? "").toLowerCase();
  const bookMajor = (book.major ?? "").toLowerCase();
  const author = book.author.toLowerCase();
  const category = book.category.toLowerCase();
  const description = book.description.toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (subject.includes(term)) score += 4;
    if (bookMajor.includes(term)) score += 3;
    if (title.includes(term)) score += 3;
    if (author.includes(term)) score += 2;
    if (category.includes(term)) score += 2;
    if (description.includes(term)) score += 1;
  }
  if (grade && book.grade === grade) score += 5;
  if (major && bookMajor.includes(major.toLowerCase())) score += 5;
  if (book.available > 0) score += 1;
  return score;
}

function rankBooks(
  books: CatalogBook[],
  resolved: ResolvedCatalogQuery
): CatalogBook[] {
  return books
    .map((book, index) => ({ book, index, score: scoreBook(book, resolved) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.book);
}

export async function searchCatalogBooks(
  query: string,
  limit = 5,
  format?: CatalogFormatScope
): Promise<CatalogBook[]> {
  const resolved = resolveCatalogQuery(query);
  const { grade, major } = resolved;
  // Pencarian PERSIS memakai kata kunci asli. Sinonim dan toleransi salah
  // ketik hanya dipakai sebagai fallback saat hasil persis kosong, sehingga
  // pencarian yang sudah tepat tidak berubah.
  const strictTerms = resolved.terms;

  // Satu sumber kebenaran format. Query tetap menjadi acuan utama, argumen
  // `format` hanya dipakai jika query tidak menyebut format apa pun.
  const effectiveFormat = resolveCatalogFormat(query, format);

  if (strictTerms.length === 0 && !grade && !major) {
    // Pertahankan perilaku lama: pencarian kata kunci tanpa kata kunci konkret
    // mengembalikan kosong. Pemanggil yang memang ingin daftar koleksi harus
    // memakai listAllCatalogBooks() atau format eksplisit.
    if (format === undefined && !hasFormatCue(query)) return [];
    return listAllCatalogBooks("ALL", limit, effectiveFormat);
  }

  const base: Record<string, unknown> = { archivedAt: null };
  if (effectiveFormat !== "ALL") base.format = effectiveFormat;

  const fetchRows = async (where: Record<string, unknown>) => {
    const rows = await prisma.book.findMany({
      where: { ...where, ...base },
      select: bookSelect,
      take: limit,
    });
    return rows.map(toCatalogBook);
  };

  const queryWithTerms = async (terms: string[]): Promise<CatalogBook[]> => {
    const termOr = buildTermOr(terms);
    const majorOr = major
      ? [{ major: { contains: major } }, { subject: { contains: major } }]
      : [];

    if (terms.length > 0 && (grade || major)) {
      // Prioritaskan yang cocok pada kata kunci DAN kelas/jurusan sekaligus.
      const conjunction: Record<string, unknown>[] = [{ OR: termOr }];
      if (grade) conjunction.push({ grade });
      if (majorOr.length) conjunction.push({ OR: majorOr });
      const combined = await fetchRows({ AND: conjunction });
      // Jika terlalu sempit, longgarkan ke pencarian kata kunci saja.
      if (combined.length > 0) return combined;
      return fetchRows({ OR: termOr });
    }
    if (terms.length > 0) {
      return fetchRows({ OR: termOr });
    }

    // Hanya menyebut kelas/jurusan tanpa kata kunci (mis. "buku kelas XI").
    const dimensionOr: Record<string, unknown>[] = [];
    if (grade) dimensionOr.push({ grade });
    if (majorOr.length) dimensionOr.push({ OR: majorOr });
    return fetchRows({ OR: dimensionOr });
  };

  let usedTerms = strictTerms;
  let books = await queryWithTerms(strictTerms);

  // Fallback 1: sinonim istilah sehari-hari â†” kurikulum.
  if (books.length === 0 && strictTerms.length > 0) {
    const expanded = expandSearchTerms(strictTerms);
    if (expanded.length > strictTerms.length) {
      usedTerms = expanded;
      books = await queryWithTerms(expanded);
    }
  }

  // Fallback 2: toleransi salah ketik, hanya bila masih kosong. Query fuzzy
  // sudah difilter format di database, jadi hasilnya tidak bisa mencampur
  // buku fisik dan ebook.
  if (books.length === 0 && strictTerms.length > 0) {
    const fuzzy = await findFuzzyCatalogBooks(usedTerms, resolved, effectiveFormat);
    if (fuzzy.length > 0) return fuzzy.slice(0, limit);
  }

  return rankBooks(books, { ...resolved, terms: usedTerms }).slice(0, limit);
}

/**
 * Cari satu buku berdasarkan potongan judul/penulis/mapel/jurusan. Dipakai
 * untuk intent ringkasan buku, di mana pengguna menyebutnya secara eksplisit.
 */
export async function findBookByReference(
  query: string,
  format?: CatalogFormatScope
): Promise<CatalogBook | null> {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return null;

  // Format mengikuti pertanyaan (default PHYSICAL). Ini mencegah ringkasan
  // "buku X" menjawab dengan ebook berjudul mirip, dan sebaliknya.
  const effectiveFormat = resolveCatalogFormat(query, format);
  const formatFilter =
    effectiveFormat === "ALL" ? {} : { format: effectiveFormat };

  const row = await prisma.book.findFirst({
    where: {
      archivedAt: null,
      ...formatFilter,
      OR: terms.flatMap((term) => [
        { title: { contains: term } },
        { author: { contains: term } },
        { subject: { contains: term } },
        { major: { contains: term } },
      ]),
    },
    select: bookSelect,
    orderBy: { title: "asc" },
  });

  if (row) return toCatalogBook(row);

  // Fallback toleran salah ketik/sinonim HANYA bila rujukan persis tidak ada.
  // Pencocokan dilakukan pada metadata hasil query katalog (bukan tebakan
  // model), dan format sudah difilter di database.
  const fuzzy = await findFuzzyCatalogBooks(
    expandSearchTerms(terms),
    { terms, grade: null, major: null },
    effectiveFormat
  );
  return fuzzy[0] ?? null;
}

/** Ambil satu buku katalog aktif berdasarkan ID database (deterministik). */
export async function getCatalogBookById(id: string): Promise<CatalogBook | null> {
  if (!id || typeof id !== "string") return null;
  const row = await prisma.book.findFirst({
    where: { id, archivedAt: null },
    select: bookSelect,
  });
  return row ? toCatalogBook(row) : null;
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const [
    aggregate,
    physicalAggregate,
    totalTitles,
    totalEbooks,
    physicalTitles,
    activeBorrows,
    totalBorrows,
    categories,
    archivedTitles,
    archivedEbooks,
    archivedPhysicalTitles,
  ] = await Promise.all([
    prisma.book.aggregate({ where: { archivedAt: null }, _sum: { stock: true } }),
    prisma.book.aggregate({
      where: { archivedAt: null, format: PHYSICAL_FORMAT },
      _sum: { stock: true },
    }),
    prisma.book.count({ where: { archivedAt: null } }),
    prisma.book.count({ where: { archivedAt: null, format: EBOOK_FORMAT } }),
    prisma.book.count({ where: { archivedAt: null, format: PHYSICAL_FORMAT } }),
    prisma.borrowRecord.count({ where: { status: { in: ACTIVE_BORROW_STATUSES } } }),
    prisma.borrowRecord.count({
      where: { status: { in: [...ACTIVE_BORROW_STATUSES, "RETURNED"] } },
    }),
    prisma.category.count(),
    prisma.book.count({ where: { archivedAt: { not: null } } }),
    prisma.book.count({ where: { archivedAt: { not: null }, format: EBOOK_FORMAT } }),
    prisma.book.count({ where: { archivedAt: { not: null }, format: PHYSICAL_FORMAT } }),
  ]);

  const totalCopies = aggregate._sum.stock ?? 0;
  const physicalCopies = physicalAggregate._sum.stock ?? 0;

  return {
    totalTitles,
    totalCopies,
    totalAvailable: Math.max(0, totalCopies - activeBorrows),
    totalEbooks,
    physicalTitles,
    physicalCopies,
    physicalAvailable: Math.max(0, physicalCopies - activeBorrows),
    activeLoans: activeBorrows,
    totalBorrows,
    categories,
    archivedTitles,
    archivedEbooks,
    archivedPhysicalTitles,
  };
}

export async function countCatalogBooks(
  query: string,
  format?: CatalogFormatScope
): Promise<number> {
  const resolved = resolveCatalogQuery(query);
  const { grade, major } = resolved;
  const strictTerms = resolved.terms;
  const effectiveFormat = resolveCatalogFormat(query, format);
  const base: Record<string, unknown> = { archivedAt: null };
  if (effectiveFormat !== "ALL") base.format = effectiveFormat;

  if (strictTerms.length === 0 && !grade && !major) {
    // Sama seperti searchCatalogBooks: tanpa kata kunci dan tanpa permintaan
    // format eksplisit, pertahankan hasil 0 (bukan menghitung seluruh katalog).
    if (format === undefined && !hasFormatCue(query)) return 0;
    return countAllCatalogBooks("ALL", effectiveFormat);
  }

  const buildWhere = (terms: string[]): Record<string, unknown> => {
    const termOr = buildTermOr(terms);
    const majorOr = major
      ? [{ major: { contains: major } }, { subject: { contains: major } }]
      : [];

    if (terms.length > 0 && (grade || major)) {
      const conjunction: Record<string, unknown>[] = [{ OR: termOr }];
      if (grade) conjunction.push({ grade });
      if (majorOr.length) conjunction.push({ OR: majorOr });
      return { ...base, AND: conjunction };
    }
    if (terms.length > 0) {
      return { ...base, OR: termOr };
    }
    const dimensionOr: Record<string, unknown>[] = [];
    if (grade) dimensionOr.push({ grade });
    if (majorOr.length) dimensionOr.push({ OR: majorOr });
    return { ...base, OR: dimensionOr };
  };

  const countWithTerms = async (terms: string[]): Promise<number> => {
    const strictTotal = await prisma.book.count({ where: buildWhere(terms) });
    if (strictTotal > 0) return strictTotal;
    // Sama seperti searchCatalogBooks: bila kombinasi kata kunci + kelas/jurusan
    // terlalu sempit, hitung pencarian kata kunci saja sebelum mencoba sinonim.
    if (terms.length > 0 && (grade || major)) {
      return prisma.book.count({
        where: { ...base, OR: buildTermOr(terms) },
      });
    }
    return 0;
  };

  let usedTerms = strictTerms;
  const strictTotal = await countWithTerms(strictTerms);
  if (strictTotal > 0) return strictTotal;

  // Samakan dengan pencarian: sinonim lalu toleransi salah ketik, hanya bila
  // pencarian persis kosong.
  if (strictTerms.length > 0) {
    const expanded = expandSearchTerms(strictTerms);
    if (expanded.length > strictTerms.length) {
      usedTerms = expanded;
      const expandedTotal = await countWithTerms(expanded);
      if (expandedTotal > 0) return expandedTotal;
    }
  }

  if (usedTerms.length === 0) return 0;
  const fuzzy = await findFuzzyCatalogBooks(usedTerms, resolved, effectiveFormat);
  return fuzzy.length;
}

export interface CategoryCount {
  name: string;
  count: number;
}

export async function getCategoryCounts(
  format: CatalogFormatScope = PHYSICAL
): Promise<CategoryCount[]> {
  const bookWhere = {
    archivedAt: null,
    ...(format === "ALL" ? {} : { format }),
  };
  const categories = await prisma.category.findMany({
    select: { name: true, _count: { select: { books: { where: bookWhere } } } },
    orderBy: { name: "asc" },
  });
  return categories.map((c) => ({ name: c.name, count: c._count.books }));
}

/** Scope daftar koleksi tanpa kata kunci: seluruh katalog atau hanya yang tersedia. */
type CatalogListScope = "ALL" | "AVAILABLE";

/** Daftar seluruh koleksi aktif (tanpa kata kunci) untuk pertanyaan seperti "buku apa saja yang tersedia". */
export async function listAllCatalogBooks(
  scope: CatalogListScope = "ALL",
  limit = 8,
  format?: CatalogFormatScope
): Promise<CatalogBook[]> {
  // Scope AVAILABLE: ketersediaan = stok - peminjaman aktif, jadi buku fisik
  // yang seluruh eksemplarnya dipinjam (available 0) tidak boleh ikut. Ebook
  // tetap dianggap tersedia selama judulnya aktif di katalog.
  // Format difilter di query database; ALL hanya dipakai bila diminta eksplisit.
  const isAvailableScope = scope === "AVAILABLE";
  const includeEbooksInAvailability = format === "ALL" || format === EBOOK;
  const prefilterPhysicalStock = isAvailableScope && !includeEbooksInAvailability;

  const rows = await prisma.book.findMany({
    where: {
      archivedAt: null,
      ...(format && format !== "ALL" ? { format } : {}),
      ...(prefilterPhysicalStock ? { stock: { gt: 0 } } : {}),
    },
    select: bookSelect,
    orderBy: { title: "asc" },
    ...(isAvailableScope ? {} : { take: limit }),
  });

  const books = rows.map(toCatalogBook);
  if (isAvailableScope) {
    return books
      .filter((b) =>
        b.format === EBOOK_FORMAT ? includeEbooksInAvailability : b.available > 0
      )
      .slice(0, limit);
  }
  return books;
}

export async function countAllCatalogBooks(
  scope: CatalogListScope = "ALL",
  format?: CatalogFormatScope
): Promise<number> {
  if (scope === "AVAILABLE") {
    const includeEbooksInAvailability = format === "ALL" || format === EBOOK;
    const rows = await prisma.book.findMany({
      where: {
        archivedAt: null,
        ...(format && format !== "ALL" ? { format } : {}),
      },
      select: bookSelect,
    });
    return rows
      .map(toCatalogBook)
      .filter((b) =>
        b.format === EBOOK_FORMAT ? includeEbooksInAvailability : b.available > 0
      ).length;
  }

  return prisma.book.count({
    where: {
      archivedAt: null,
      ...(format && format !== "ALL" ? { format } : {}),
    },
  });
}

function combineFormatSections(
  sections: Array<{ label: string; answer: CatalogAnswer }>
): CatalogAnswer {
  const references: CatalogAnswer["references"] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const ref of section.answer.references) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      references.push(ref);
    }
  }
  return {
    message: sections
      .map((section) => `**${section.label}**\n\n${section.answer.message}`)
      .join("\n\n"),
    references,
  };
}

/**
 * True bila pertanyaan meminta rekapitulasi SEMUA kategori (bukan satu kategori
 * tertentu). Pola ini cukup spesifik untuk tidak bertabrakan dengan pertanyaan
 * seperti "Berapa buku kategori Biologi?".
 */
function isAllCategoriesQuery(q: string): boolean {
  return /\b(berdasarkan\s+kategori|per\s+kategori|tiap\s+kategori|setiap\s+kategori|masing[-\s]+masing\s+kategori|semua\s+kategori|seluruh\s+kategori|daftar\s+kategori|list\s+kategori|apa\s+(?:saja|aja)\s+kategori|kategori\s+apa\s+(?:saja|aja)|kategori\s+apa|ada\s+kategori\s+apa)\b/i.test(q);
}

function stripBukuPrefix(name: string): string {
  return name.replace(/^buku\s+/i, "").trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cakupan status koleksi untuk pertanyaan jumlah: aktif (non-arsip) vs arsip. */
export type CollectionArchiveScope = "ACTIVE" | "ARCHIVED";

/**
 * Deteksi apakah pertanyaan menanyakan jumlah/koleksi berdasarkan status arsip.
 * - ARCHIVED: menyebut arsip/diarsipkan.
 * - ACTIVE: menyebut aktif/tidak diarsipkan/non-arsip (kualifikasi eksplisit status aktif).
 * - null: tidak ada kualifikasi status arsip yang spesifik.
 */
export function detectCollectionArchiveScope(
  query: string
): CollectionArchiveScope | null {
  const q = query.toLowerCase();
  if (/\b(tidak\s+diarsipkan|non[\s-]?arsip|unarchived)\b/.test(q)) return "ACTIVE";
  if (/\b(arsip|diarsipkan|archived)\b/.test(q)) return "ARCHIVED";
  // "aktif"/"active" sebagai kualifikasi koleksi/buku/katalog (bukan status pinjaman lain)
  if (
    /\b(aktif|active)\b/.test(q) &&
    /\b(buku|koleksi|katalog|ebook|judul|perpustakaan)\b/.test(q)
  ) {
    return "ACTIVE";
  }
  return null;
}

/**
 * Pertanyaan hitung/jumlah koleksi buku secara global (bukan mencari judul/topik spesifik),
 * mis. "total koleksi buku", "berapa buku aktif", "berapa buku yang diarsipkan".
 * Digunakan agar kata status/kualifikasi tidak diperlakukan sebagai kata kunci pencarian.
 */
export function isGlobalCollectionCountQuery(query: string): boolean {
  const q = query.toLowerCase();
  const hasCount =
    /\b(berapa|jumlah|total|banyak|ada\s+berapa|how\s+many)\b/.test(q);
  const hasCollection =
    /\b(buku|koleksi|katalog|ebook|judul|perpustakaan)\b/.test(q);
  if (!hasCount || !hasCollection) return false;

  const resolved = resolveCatalogQuery(query);
  // Ada filter spesifik (topik/judul/mapel/kelas/jurusan) -> hitung hasil pencarian, bukan global.
  if (resolved.terms.length > 0 || resolved.grade || resolved.major) return false;

  const scope = detectCollectionArchiveScope(query);
  if (scope) return true;

  // "total koleksi buku" / "jumlah buku di perpustakaan" tanpa filter spesifik -> global
  if (
    /\b(total\s+(koleksi|buku|ebook|judul)|koleksi\s+(buku|ebook)?|jumlah\s+(koleksi|buku|ebook|judul))\b/.test(
      q
    )
  ) {
    return true;
  }

  // "ada berapa buku (di perpustakaan/katalog)?" tanpa filter -> global
  if (/\b(berapa|jumlah|total|banyak)\b/.test(q) && /\b(perpustakaan|katalog)\b/.test(q)) {
    return true;
  }

  return false;
}

function extractCategoryCandidate(query: string): string | null {
  const explicitMatch = query.match(
    /\b(?:kategori|category)\s+([A-Za-z][A-Za-z\s]{1,40}?)(?:\s*(?:berapa|yang|di|pada|saat\s+ini|ini|[?.!,]|$)|$)/i
  );
  if (explicitMatch) {
    const raw = explicitMatch[1].trim();
    const cleaned = raw.replace(/\b(berapa|total|jumlah|koleksi|judul|ada)\b/gi, "").trim();
    if (cleaned.length > 0) return cleaned;
  }
  const beforeMatch = query.match(
    /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\s+(?:kategori|category)\b/i
  );
  if (beforeMatch) {
    return beforeMatch[1].trim();
  }
  return null;
}

type CategoryMatchResult =
  | { type: "MATCH"; category: { id: string; name: string } }
  | { type: "AMBIGUOUS"; matches: Array<{ id: string; name: string }> }
  | { type: "NONE" };

function matchCategoryCandidate(
  candidate: string,
  categories: Array<{ id: string; name: string }>
): CategoryMatchResult {
  const raw = candidate.trim();
  if (!raw) return { type: "NONE" };
  const lower = raw.toLowerCase();
  const strippedCandidate = stripBukuPrefix(lower);

  // 1. Exact match (case-insensitive) pada nama lengkap
  const exactFull = categories.filter((c) => c.name.toLowerCase() === lower);
  if (exactFull.length === 1) return { type: "MATCH", category: exactFull[0] };
  if (exactFull.length > 1) return { type: "AMBIGUOUS", matches: exactFull };

  // 2. Exact match tanpa awalan "Buku "
  // contoh: candidate "teks pelajaran" vs category "Buku Teks Pelajaran"
  // atau candidate "buku teks pelajaran" vs category "Buku Teks Pelajaran"
  const exactWithoutPrefix = categories.filter(
    (c) => stripBukuPrefix(c.name).toLowerCase() === strippedCandidate
  );
  if (exactWithoutPrefix.length === 1) return { type: "MATCH", category: exactWithoutPrefix[0] };
  if (exactWithoutPrefix.length > 1) return { type: "AMBIGUOUS", matches: exactWithoutPrefix };

  // 3. Word-boundary match
  const termToTest = strippedCandidate.length > 0 ? strippedCandidate : lower;
  const boundaryRegex = new RegExp("(^|[^a-zA-Z0-9])" + escapeRegex(termToTest) + "([^a-zA-Z0-9]|$)", "i");
  const boundaryMatches = categories.filter((c) => {
    const catLower = c.name.toLowerCase();
    const catStripped = stripBukuPrefix(c.name).toLowerCase();
    // Cegah "fiksi" mencocokkan "nonfiksi"
    if (termToTest === "fiksi" && (catLower === "nonfiksi" || catStripped === "nonfiksi")) return false;
    return boundaryRegex.test(catLower) || boundaryRegex.test(catStripped);
  });
  if (boundaryMatches.length === 1) return { type: "MATCH", category: boundaryMatches[0] };
  if (boundaryMatches.length > 1) return { type: "AMBIGUOUS", matches: boundaryMatches };

  // 4. Substring / partial match jika hanya mengarah ke satu kategori
  if (termToTest.length >= 3) {
    const partialMatches = categories.filter((c) => {
      const catLower = c.name.toLowerCase();
      const catStripped = stripBukuPrefix(c.name).toLowerCase();
      if (termToTest === "fiksi" && (catLower.includes("nonfiksi") || catStripped.includes("nonfiksi"))) return false;
      return catLower.includes(termToTest) || catStripped.includes(termToTest);
    });
    if (partialMatches.length === 1) return { type: "MATCH", category: partialMatches[0] };
    if (partialMatches.length > 1) return { type: "AMBIGUOUS", matches: partialMatches };
  }

  return { type: "NONE" };
}

function findCategoryInText(
  query: string,
  categories: Array<{ id: string; name: string }>
): CategoryMatchResult {
  const q = query.toLowerCase();

  // 1. Cek nama lengkap kategori di dalam teks query
  const sorted = [...categories].sort((a, b) => b.name.length - a.name.length);
  const matchedFull: Array<{ id: string; name: string }> = [];
  for (const cat of sorted) {
    const lower = cat.name.toLowerCase();
    const regex = new RegExp("(^|[^a-zA-Z0-9])" + escapeRegex(lower) + "([^a-zA-Z0-9]|$)", "i");
    if (regex.test(q)) {
      matchedFull.push(cat);
    }
  }
  if (matchedFull.length === 1) return { type: "MATCH", category: matchedFull[0] };
  if (matchedFull.length > 1) return { type: "AMBIGUOUS", matches: matchedFull };

  // 2. Cek nama kategori tanpa awalan "Buku "
  const matchedStripped: Array<{ id: string; name: string }> = [];
  for (const cat of sorted) {
    const stripped = stripBukuPrefix(cat.name).toLowerCase();
    if (stripped.length < 3) continue;
    const regex = new RegExp("(^|[^a-zA-Z0-9])" + escapeRegex(stripped) + "([^a-zA-Z0-9]|$)", "i");
    if (regex.test(q)) {
      if (stripped === "fiksi" && /\bnonfiksi\b/i.test(q)) continue;
      matchedStripped.push(cat);
    }
  }
  if (matchedStripped.length === 1) return { type: "MATCH", category: matchedStripped[0] };
  if (matchedStripped.length > 1) return { type: "AMBIGUOUS", matches: matchedStripped };

  return { type: "NONE" };
}

async function buildCatalogAnswerForCategory(
  q: string,
  query: string,
  format: CatalogFormat
): Promise<CatalogAnswer | null> {
  if (isAllCategoriesQuery(q)) {
    const counts = await getCategoryCounts(format);
    return buildCategoryAnswer(counts, format);
  }

  const allCategories = await prisma.category.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const availableNames = allCategories.map((c) => c.name);

  const candidate = extractCategoryCandidate(query);

  if (candidate) {
    const result = matchCategoryCandidate(candidate, allCategories);
    if (result.type === "MATCH") {
      const total = await prisma.book.count({
        where: {
          archivedAt: null,
          categoryId: result.category.id,
          format,
        },
      });
      return buildSingleCategoryAnswer(result.category.name, total, format);
    }
    if (result.type === "AMBIGUOUS") {
      return buildAmbiguousCategoryAnswer(
        candidate,
        result.matches.map((m) => m.name),
        format
      );
    }
    return buildCategoryNotFoundAnswer(candidate, availableNames, format);
  }

  const inTextResult = findCategoryInText(query, allCategories);
  if (inTextResult.type === "MATCH") {
    const total = await prisma.book.count({
      where: {
        archivedAt: null,
        categoryId: inTextResult.category.id,
        format,
      },
    });
    return buildSingleCategoryAnswer(inTextResult.category.name, total, format);
  }
  if (inTextResult.type === "AMBIGUOUS") {
    return buildAmbiguousCategoryAnswer(
      query,
      inTextResult.matches.map((m) => m.name),
      format
    );
  }

  if (/\b(kategori|category)\b/i.test(q)) {
    const counts = await getCategoryCounts(format);
    return buildCategoryAnswer(counts, format);
  }

  return null;
}

/**
 * Jawaban untuk SATU format tertentu. Semua query di sini selalu menerima
 * `format` eksplisit sehingga tidak mungkin mencampur buku fisik dan ebook.
 */

async function buildCatalogAnswerForFormat(
  intent: string,
  query: string,
  format: CatalogFormat,
  resolved: ResolvedCatalogQuery
): Promise<CatalogAnswer> {
  const q = query.toLowerCase();

  if (intent === "BOOK_SUMMARY") {
    const book = await findBookByReference(query, format);
    // Bedakan "katalog format ini kosong" dari "judul tidak ditemukan".
    const catalogTotal = await countAllCatalogBooks("ALL", format);
    return buildBookSummaryAnswer(book, catalogTotal === 0, format);
  }

  if (intent === "STATS") {
    // Pertanyaan jumlah koleksi global (aktif/arsip/total koleksi) dijawab dari
    // statistik katalog, bukan pencarian kata kunci yang bisa tercemar kata status.
    if (isGlobalCollectionCountQuery(query)) {
      const stats = await getCatalogStats();
      return buildStatsAnswer(query, stats, format);
    }

    // Pertanyaan kategori (eksplisit kata "kategori", rekap per kategori, atau
    // penyebutan nama kategori di dalam teks seperti "koleksi buku Biologi").
    // Diletakkan sebelum hitung-berdasarkan-pencarian agar "Biologi" dikenali
    // sebagai kategori, bukan kata kunci judul.
    if (
      /\b(kategori|category|berdasarkan\s+kategori)\b/.test(q) ||
      /\b(total\s+koleksi|koleksi\s+buku)\b/.test(q)
    ) {
      const catAnswer = await buildCatalogAnswerForCategory(q, query, format);
      if (catAnswer) return catAnswer;
    }

    // "Berapa jumlah buku fisika?" menanyakan koleksi berfilter, bukan seluruh
    // katalog. Jawab dengan hitungan hasil pencarian yang sebenarnya.
    if (resolved.terms.length > 0 || resolved.grade || resolved.major) {
      const [books, total] = await Promise.all([
        searchCatalogBooks(query, 8, format),
        countCatalogBooks(query, format),
      ]);
      const catalogEmpty =
        total === 0 ? (await countAllCatalogBooks("ALL", format)) === 0 : false;
      return buildCatalogListAnswer(
        query,
        books,
        total,
        resolved,
        catalogEmpty,
        format
      );
    }
    const stats = await getCatalogStats();
    return buildStatsAnswer(query, stats, format);
  }

  // BOOK_PHYSICAL, EBOOK_CATALOG, dan CATALOG semuanya memakai jalur daftar
  // yang sama; format sudah ditentukan sebelum fungsi ini dipanggil.
  const { terms, grade, major } = resolved;
  const isCount = COUNT_QUERY.test(q);
  const archiveScope = detectCollectionArchiveScope(query);
  const globalCollectionCount = isGlobalCollectionCountQuery(query);
  const wantsAll = (terms.length === 0 && !grade && !major) || globalCollectionCount;
  const onlyAvailable = AVAILABLE_QUERY.test(q);

  // Pertanyaan global tanpa kata kunci: "Buku apa saja yang tersedia?",
  // "Ebook apa saja yang tersedia?", "Ada berapa buku di perpustakaan?".
  // Termasuk pertanyaan jumlah koleksi aktif/arsip (status bukan kata kunci judul).
  if (wantsAll && (isCount || globalCollectionCount || archiveScope)) {
    const stats = await getCatalogStats();
    return buildStatsAnswer(query, stats, format);
  }
  if (wantsAll) {
    const scope: CatalogListScope = onlyAvailable ? "AVAILABLE" : "ALL";
    const [books, total] = await Promise.all([
      listAllCatalogBooks(scope, 8, format),
      countAllCatalogBooks(scope, format),
    ]);
    const catalogEmpty =
      total === 0 ? (await countAllCatalogBooks("ALL", format)) === 0 : false;
    return buildCatalogListAnswer(
      query,
      books,
      total,
      resolved,
      catalogEmpty,
      format
    );
  }

  const [books, total] = await Promise.all([
    searchCatalogBooks(query, 8, format),
    countCatalogBooks(query, format),
  ]);
  const catalogEmpty =
    total === 0 ? (await countAllCatalogBooks("ALL", format)) === 0 : false;
  return buildCatalogListAnswer(
    query,
    books,
    total,
    resolved,
    catalogEmpty,
    format
  );
}

/**
 * Titik masuk jawaban katalog deterministik.
 *
 * `format` sebaiknya sudah dihitung pipeline dari pertanyaan TERBARU (atau
 * konteks lanjutan yang relevan). Bila tidak diberikan, resolver yang sama
 * dipakai sebagai default — selalu PHYSICAL kecuali ada penanda ebook atau
 * permintaan eksplisit kedua format.
 */
export async function buildCatalogAnswer(
  intent: string,
  query: string,
  format?: CatalogFormatScope
): Promise<CatalogAnswer> {
  const resolved = resolveCatalogQuery(query);
  const scope = format ?? resolveCatalogFormat(query);

  if (scope === "ALL") {
    const [physical, ebook] = await Promise.all([
      buildCatalogAnswerForFormat(intent, query, PHYSICAL, resolved),
      buildCatalogAnswerForFormat(intent, query, EBOOK, resolved),
    ]);
    return combineFormatSections([
      { label: "Buku fisik", answer: physical },
      { label: "Ebook", answer: ebook },
    ]);
  }

  return buildCatalogAnswerForFormat(intent, query, scope, resolved);
}

export async function getPopularBooks(limit = 4): Promise<CatalogBook[]> {
  const rows = await prisma.book.findMany({
    where: { archivedAt: null },
    select: bookSelect,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toCatalogBook);
}
