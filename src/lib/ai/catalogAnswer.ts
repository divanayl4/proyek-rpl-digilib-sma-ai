/**
 * Penyusun jawaban katalog, statistik, dan ringkasan buku.
 *
 * Seluruh angka dan judul di sini berasal dari hasil query database yang sah
 * (lihat catalog.ts). Fungsi di file ini murni (tanpa akses database) sehingga
 * tidak mungkin mengarang data: apa pun yang tidak ada pada argumen tidak akan
 * pernah muncul pada jawaban. Dengan begitu jawaban katalog bersifat
 * deterministik dan terbebas dari halusinasi model AI.
 */

import type { CatalogBook, CatalogStats } from "./catalog";
import { EBOOK_FORMAT } from "@/lib/config/ebook";
import {
  EBOOK,
  EBOOK_FORMAT_QUERY,
  PHYSICAL,
  hasEbookFormatCue,
  resolveCatalogFormat,
  type CatalogFormatScope,
} from "./catalogFormat";

export interface CatalogReference {
  id: string;
  title: string;
  author: string;
  /** Jumlah eksemplar yang bisa dipinjam sekarang (null bila tidak dihitung). */
  available?: number | null;
  coverUrl?: string | null;
}

export interface CatalogAnswer {
  message: string;
  references: CatalogReference[];
}

/** Dikirim HANYA saat query benar-benar gagal, bukan saat hasilnya kosong. */
export const CATALOG_DATA_UNAVAILABLE =
  "Data katalog belum dapat diakses. Silakan coba lagi sebentar lagi.";

export interface CatalogCriteria {
  terms: string[];
  grade: string | null;
  major: string | null;
}

function bullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

function reference(book: CatalogBook): CatalogReference {
  // Ebook tidak punya stok eksemplar; mengirim 0 akan membuat UI menandai
  // "Stok habis" untuk judul yang sebenarnya bisa dipinjam.
  const isEbook = book.format === EBOOK_FORMAT;
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    available: isEbook ? null : book.available,
    coverUrl: book.coverUrl,
  };
}

function referencesFrom(books: CatalogBook[], limit = 4): CatalogReference[] {
  const seen = new Set<string>();
  const refs: CatalogReference[] = [];
  for (const book of books) {
    if (seen.has(book.id)) continue;
    seen.add(book.id);
    refs.push(reference(book));
    if (refs.length >= limit) break;
  }
  return refs;
}

/**
 * Label kriteria pencarian, mis. "Fisika kelas X". Dipakai agar pengguna tahu
 * persis apa yang dicari, dan agar pesan "tidak ditemukan" tetap informatif.
 */
export function criteriaLabel(criteria: CatalogCriteria): string {
  const parts: string[] = [];
  if (criteria.terms.length > 0) parts.push(criteria.terms.join(" "));
  if (criteria.grade) parts.push(`kelas ${criteria.grade}`);
  if (criteria.major) parts.push(`jurusan ${criteria.major}`);
  return parts.join(" ");
}

export const COUNT_QUERY = /\b(berapa|jumlah|banyak|total)\b/;
export const AVAILABLE_QUERY = /\b(tersedia|bisa\s+dipinjam|dapat\s+dipinjam|bisa\s+dibaca)\b/;
export const STOCK_QUERY =
  /\b(stok|stoknya|persediaan|ketersediaan|ketersediaannya|sisa\s+stok)\b/i;
export const EBOOK_QUERY = EBOOK_FORMAT_QUERY;

/**
 * Rujukan ke buku yang sudah dibahas sebelumnya ("buku ini", "buku itu",
 * "buku tadi"). Dipakai untuk menggabungkan pertanyaan lanjutan dengan topik
 * katalog sebelumnya, bukan untuk menebak judul baru.
 */
export const BOOK_REFERENCE_QUERY =
  /\b(?:buku|ebook|judul)\s+(?:ini|itu|tadi|tersebut)\b|\b(?:ini|itu|tadi)\s+(?:buku|ebook)\b/i;

/** Apakah pertanyaan secara eksplisit menyebut ebook. */
export function wantsEbook(query: string): boolean {
  return hasEbookFormatCue(query.toLowerCase());
}

/**
 * Deskripsi stok yang membedakan tiga kondisi nyata:
 * - stok 0        → belum ada eksemplar sama sekali (bukan "sedang dipinjam");
 * - stok > 0 & 0 tersedia → semua eksemplar sedang dipinjam;
 * - tersedia > 0  → sebut jumlah yang bisa dipinjam sekarang.
 */
function stockDescription(book: CatalogBook): string {
  if (book.format === EBOOK_FORMAT) {
    return "ebook aktif di katalog (tanpa stok eksemplar fisik)";
  }
  if (book.stock <= 0) {
    return "stok kosong (0 eksemplar tercatat)";
  }
  if (book.available <= 0) {
    return `stok total ${book.stock} eksemplar, semuanya sedang dipinjam (0 tersedia)`;
  }
  const onLoan = Math.max(0, book.stock - book.available);
  const loanNote = onLoan > 0 ? `; ${onLoan} sedang dipinjam` : "";
  return `tersedia ${book.available} dari ${book.stock} eksemplar${loanNote}`;
}

/**
 * Jawaban daftar/jumlah buku dari hasil pencarian aktual.
 *
 * `total` adalah jumlah judul sebenarnya di database (bukan panjang `books`
 * yang dibatasi), sehingga pertanyaan "berapa" dijawab dengan angka yang tepat.
 */
export function buildCatalogListAnswer(
  query: string,
  books: CatalogBook[],
  total: number,
  criteria: CatalogCriteria,
  catalogEmpty = false,
  format?: CatalogFormatScope
): CatalogAnswer {
  const q = query.toLowerCase();
  const label = criteriaLabel(criteria);
  const ofLabel = label ? ` ${label}` : "";
  // Format yang dipakai adalah format HASIL RESOLUSI (dari pipeline/tool),
  // bukan tebakan ulang dari kata kunci. Ini mencegah jawaban buku fisik
  // memakai kata "ebook" hanya karena konteks percakapan sebelumnya.
  const scope = format ?? resolveCatalogFormat(query);
  const isEbookOnly = scope === EBOOK;
  const noun = isEbookOnly ? "ebook" : scope === "ALL" ? "buku/ebook" : "buku";

  if (books.length === 0 || total <= 0) {
    return {
      message: catalogEmpty
        ? `Katalog DigiLib belum memiliki ${noun} yang terdaftar.`
        : `Maaf, tidak ada ${noun}${ofLabel} yang ditemukan di katalog DigiLib.`,
      references: [],
    };
  }

  // Pertanyaan stok harus dijawab dengan angka stok/tersedia, BUKAN jumlah
  // judul. Dicek sebelum COUNT_QUERY karena "berapa stok ..." juga memuat
  // kata "berapa".
  if (STOCK_QUERY.test(query)) {
    if (isEbookOnly) {
      const intro =
        books.length === 1 || BOOK_REFERENCE_QUERY.test(query)
          ? `Ebook **${books[0].title}** tidak memiliki stok eksemplar fisik`
          : `Ebook tidak memiliki stok eksemplar fisik`;
      return {
        message: `${intro}; selama judulnya aktif di katalog, ebook dapat dibaca di DigiLib.`,
        references: referencesFrom(books),
      };
    }
    const refersToPrevious = BOOK_REFERENCE_QUERY.test(query);
    if (books.length === 1 || refersToPrevious) {
      const book = books[0];
      return {
        message: `Stok **${book.title}** — ${book.author}: ${stockDescription(book)}.`,
        references: referencesFrom([book], 1),
      };
    }

    const lines = books.map((book) => `- ${book.title}: ${stockDescription(book)}`);
    const header =
      total > books.length
        ? `Stok ${books.length} judul pertama dari ${total} judul yang cocok:`
        : `Stok ${total} judul yang cocok:`;
    return {
      message: `${header}\n\n${bullets(lines)}`,
      references: referencesFrom(books),
    };
  }

  if (COUNT_QUERY.test(q)) {
    const asksTitleList = /\b(judul(?:nya)?|apa\s+judul|sebutkan|daftarkan|apa\s+saja|apa\s+aja|namanya|daftarnya)\b/i.test(q);
    if (!asksTitleList) {
      return {
        message: `Ada ${total} judul ${noun}${ofLabel} di katalog DigiLib.`,
        references: referencesFrom(books),
      };
    }
  }

  let shown = books;
  // Ketersediaan berbasis stok hanya berlaku untuk buku fisik; ebook selalu
  // tersedia sebagai koleksi selama judulnya aktif di katalog.
  if (AVAILABLE_QUERY.test(q) && !isEbookOnly) {
    const available = books.filter((book) =>
      book.format === EBOOK_FORMAT ? scope !== PHYSICAL : book.available > 0
    );
    if (available.length === 0) {
      // Bedakan stok kosong dari semua eksemplar yang sedang dipinjam. Keduanya
      // membuat "tersedia 0", tetapi penyebab dan tindak lanjutnya berbeda.
      const hasStock = books.some((book) => book.stock > 0);
      const message = hasStock
        ? `Semua ${noun}${ofLabel} sedang dipinjam. Belum ada yang tersedia saat ini.`
        : `Belum ada eksemplar ${noun}${ofLabel} yang tersedia: stoknya kosong (0 eksemplar tercatat).`;
      return { message, references: [] };
    }
    shown = available;
  }

  const list = shown.slice(0, 8).map((book) => {
    // Ketersediaan berbasis stok hanya berlaku untuk buku fisik. Ebook tidak
    // punya eksemplar: selama judulnya aktif di katalog, ia bisa dipinjam.
    const availability =
      book.format === EBOOK_FORMAT
        ? "ebook"
        : book.available > 0
        ? `tersedia ${book.available}`
        : book.stock <= 0
        ? "stok kosong"
        : "sedang dipinjam semua";
    return `${book.title} — ${book.author} (${availability})`;
  });

  let message = `Ditemukan ${total} judul ${noun}${
    label ? ` untuk "${label}"` : ""
  }:\n\n${bullets(list)}`;
  if (total > list.length) {
    message += `\n\n... dan ${total - list.length} judul lainnya.`;
  }
  if (isEbookOnly) {
    message += `\n\nEbook dapat dibaca secara digital melalui web DigiLib.`;
  }

  return { message, references: referencesFrom(shown) };
}

/**
 * Jawaban statistik katalog global. Menjawab hanya angka yang ditanyakan agar
 * tetap singkat, dan selalu memberi label (judul/eksemplar/transaksi) supaya
 * tidak mencampur istilah.
 */
export function buildStatsAnswer(
  query: string,
  stats: CatalogStats,
  format?: CatalogFormatScope
): CatalogAnswer {
  const q = query.toLowerCase();
  const asksActiveExplicit = /\b(tidak\s+diarsipkan|non[\s-]?arsip|unarchived|aktif|active)\b/.test(q);
  const asksArchived =
    /\b(arsip|diarsipkan|archived)\b/.test(q) &&
    !/\b(tidak\s+diarsipkan|non[\s-]?arsip|unarchived)\b/.test(q);
  const asksCollectionTotal = /\b(total\s+(koleksi|buku|ebook|judul)|koleksi\s+(buku|ebook)?|jumlah\s+(koleksi|buku|ebook|judul)|berapa\s+(koleksi|buku|ebook|judul))\b/.test(q);
  let scope = format ?? resolveCatalogFormat(query);
  // "Total koleksi buku aktif/tidak diarsipkan" tanpa penanda format spesifik
  // dimaknai sebagai seluruh koleksi aktif (fisik + ebook), meski resolver default
  // format memberi PHYSICAL.
  if (
    !hasEbookFormatCue(query) &&
    !/\bfisik\b/.test(q) &&
    (asksActiveExplicit || asksCollectionTotal) &&
    !asksArchived
  ) {
    scope = "ALL";
  }

  if (asksArchived) {
    if (scope === EBOOK) {
      return {
        message: `Ada ${stats.archivedEbooks} judul ebook yang diarsipkan di katalog DigiLib.`,
        references: [],
      };
    }
    if (scope === "ALL") {
      return {
        message: `Ada ${stats.archivedTitles} judul koleksi yang diarsipkan di katalog DigiLib (${stats.archivedPhysicalTitles} buku fisik, ${stats.archivedEbooks} ebook).`,
        references: [],
      };
    }
    return {
      message: `Ada ${stats.archivedPhysicalTitles} judul buku fisik yang diarsipkan di katalog DigiLib.`,
      references: [],
    };
  }

  const asksStock = /\b(stok|persediaan|ketersediaan)\b/.test(q);
  const asksAvailable = AVAILABLE_QUERY.test(q) || asksStock;
  const asksCopies = /\beksemplar\b/.test(q) && !asksStock;
  const asksActiveLoans = /\b(sedang\s+dipinjam|peminjaman\s+aktif|dipinjam)\b/.test(q);
  const physicalNoun = /\bfisik\b/.test(q) ? "buku fisik" : "buku";
  const activeLabel = asksActiveExplicit ? " aktif (tidak diarsipkan)" : "";

  if (scope === EBOOK) {
    if (asksAvailable) {
      return {
        message: `Ebook tidak memiliki stok eksemplar; ada ${stats.totalEbooks} judul ebook${activeLabel} terdaftar di katalog DigiLib.`,
        references: [],
      };
    }
    return {
      message: `Ada ${stats.totalEbooks} judul ebook${activeLabel} terdaftar di katalog DigiLib.`,
      references: [],
    };
  }

  if (scope === "ALL") {
    if (asksAvailable) {
      return {
        message: `Total tersedia ${stats.physicalAvailable} eksemplar buku fisik. Ada juga ${stats.totalEbooks} judul ebook di katalog DigiLib.`,
        references: [],
      };
    }
    if (asksCopies) {
      return {
        message: `Ada ${stats.physicalCopies} eksemplar buku fisik dan ${stats.totalEbooks} judul ebook di katalog DigiLib.`,
        references: [],
      };
    }
    if (asksActiveLoans) {
      return {
        message: `Saat ini ada ${stats.activeLoans} transaksi peminjaman aktif.`,
        references: [],
      };
    }
    return {
      message: `Ada ${stats.totalTitles} judul koleksi${activeLabel} di katalog DigiLib (${stats.physicalTitles} buku fisik, ${stats.totalEbooks} ebook).`,
      references: [],
    };
  }

  if (asksAvailable) {
    return {
      message: `Total tersedia ${stats.physicalAvailable} eksemplar.`,
      references: [],
    };
  }

  if (asksCopies) {
    return {
      message: `Ada ${stats.physicalCopies} eksemplar ${physicalNoun === "buku" ? "buku" : "buku fisik"}.`,
      references: [],
    };
  }

  if (asksActiveLoans) {
    return {
      message: `Saat ini ada ${stats.activeLoans} transaksi peminjaman aktif.`,
      references: [],
    };
  }

  return {
    message: asksActiveExplicit
      ? `Ada ${stats.physicalTitles} judul ${physicalNoun} aktif (tidak diarsipkan) di katalog DigiLib.`
      : `Ada ${stats.physicalTitles} judul ${physicalNoun}.`,
    references: [],
  };
}

/** Jawaban jumlah buku per kategori (pertanyaan "berdasarkan kategori"). */
export function buildCategoryAnswer(
  counts: Array<{ name: string; count: number }>,
  format?: CatalogFormatScope
): CatalogAnswer {
  const noun = format === EBOOK ? "ebook" : format === "ALL" ? "buku/ebook" : "buku fisik";
  if (counts.length === 0) {
    return { message: `Belum ada data kategori ${noun} di katalog DigiLib.`, references: [] };
  }
  const list = bullets(counts.map((entry) => `${entry.name}: ${entry.count} judul`));
  return { message: `Jumlah judul ${noun} per kategori:\n\n${list}`, references: [] };
}

/**
 * Jawaban jumlah buku untuk SATU kategori spesifik yang ditanyakan.
 * Hanya melaporkan kategori yang diminta — tidak menampilkan kategori lain.
 */
export function buildSingleCategoryAnswer(
  categoryName: string,
  total: number,
  format?: CatalogFormatScope
): CatalogAnswer {
  const noun = format === EBOOK ? "ebook" : format === "ALL" ? "buku/ebook" : "buku fisik";
  if (total === 0) {
    return {
      message:
        `Kategori **${categoryName}** terdaftar di DigiLib, tetapi saat ini belum ada ` +
        `${noun} dalam kategori tersebut.`,
      references: [],
    };
  }
  return {
    message:
      `Terdapat **${total} judul** ${noun} dalam kategori **${categoryName}** di katalog DigiLib.`,
    references: [],
  };
}

/**
 * Jawaban ketika kategori yang ditanyakan tidak ditemukan di database.
 * Menyebutkan kategori yang tersedia agar pengguna bisa memperbaiki pertanyaan,
 * tanpa mengarang data.
 */
export function buildCategoryNotFoundAnswer(
  categoryName: string,
  availableCategories?: string[],
  format?: CatalogFormatScope
): CatalogAnswer {
  const noun = format === EBOOK ? "ebook" : format === "ALL" ? "buku/ebook" : "buku";
  let message =
    `Maaf, kategori **${categoryName}** tidak ditemukan di katalog ${noun} DigiLib.`;
  if (availableCategories && availableCategories.length > 0) {
    const listLabel =
      availableCategories.length <= 10
        ? bullets(availableCategories)
        : bullets(availableCategories.slice(0, 10)) +
          `\n... dan ${availableCategories.length - 10} kategori lainnya.`;
    message += `\n\nKategori yang tersedia:\n\n${listLabel}`;
  }
  return { message, references: [] };
}

/**
 * Jawaban ketika pencocokan kategori menghasilkan lebih dari satu kemungkinan (ambigu).
 * Tidak memilih secara sembarang dan meminta pengguna memperjelas kategori yang dimaksud.
 */
export function buildAmbiguousCategoryAnswer(
  candidate: string,
  matchedCategories: string[],
  format?: CatalogFormatScope
): CatalogAnswer {
  const noun = format === EBOOK ? "ebook" : format === "ALL" ? "buku/ebook" : "buku";
  const list = bullets(matchedCategories);
  return {
    message:
      `Terdapat beberapa kategori ${noun} yang cocok dengan "**${candidate}**":\n\n${list}\n\n` +
      `Silakan perjelas nama kategori yang ingin Anda ketahui.`,
    references: [],
  };
}

/**
 * Ringkasan buku. DigiLib hanya menyimpan metadata, jadi jawaban menyajikan
 * metadata aktual dan menyatakan terus terang bahwa isi lengkap belum tersedia
 * (tidak ada ringkasan isi yang dikarang).
 */
export function buildBookSummaryAnswer(
  book: CatalogBook | null,
  catalogEmpty = false,
  format?: CatalogFormatScope
): CatalogAnswer {
  if (!book) {
    const noun = format === EBOOK ? "ebook" : format === "ALL" ? "buku/ebook" : "buku";
    return {
      message: catalogEmpty
        ? `Katalog DigiLib belum memiliki ${noun} yang terdaftar, sehingga ${noun} tersebut belum dapat ditemukan.`
        : `Maaf, ${noun} tersebut tidak ditemukan di katalog DigiLib.`,
      references: [],
    };
  }

  const lines = [`**${book.title}**`, `Penulis: ${book.author}`];
  if (book.publisher) lines.push(`Penerbit: ${book.publisher}`);
  if (book.year) lines.push(`Tahun: ${book.year}`);
  if (book.grade) lines.push(`Kelas: ${book.grade}`);
  if (book.subject) lines.push(`Mata Pelajaran: ${book.subject}`);
  lines.push(`Kategori: ${book.category}`);
  if (book.format === EBOOK_FORMAT) {
    // Ebook tidak punya stok eksemplar; jangan tampilkan "habis".
    lines.push(`Format: ebook (dibaca online di DigiLib)`);
    lines.push(`Tersedia sekarang: ya, judul ebook aktif di katalog`);
  } else {
    lines.push(`Stok total: ${book.stock}`);
    lines.push(
      `Tersedia sekarang: ${
        book.available > 0
          ? `${book.available} eksemplar`
          : book.stock <= 0
          ? "belum ada (stok kosong)"
          : "habis (semua eksemplar sedang dipinjam)"
      }`
    );
  }

  return {
    message:
      `${lines.join("\n")}\n\n` +
      "Ringkasan isi lengkap belum tersedia karena DigiLib hanya menyimpan metadata buku.",
    references: [reference(book)],
  };
}
