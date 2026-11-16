/**
 * Penyusun jawaban ringkas untuk pertanyaan data pribadi (pinjaman aktif,
 * riwayat peminjaman, dan denda).
 *
 * Semua angka dan judul di sini berasal dari query database yang sudah
 * dibatasi ke `session.user.id` (lihat personal.ts). Fungsi di file ini murni
 * (tanpa akses database) agar jawaban dapat diuji dan tidak mungkin mengarang
 * data: yang tidak ada di argumen tidak akan pernah muncul di jawaban.
 *
 * PEMISAHAN FORMAT: buku fisik (BorrowRecord) dan ebook (EbookLoan) adalah dua
 * sumber data berbeda. Pertanyaan yang menyebut "buku" tanpa penanda digital
 * dijawab dari buku fisik saja; pertanyaan yang menyebut "ebook" dijawab dari
 * EbookLoan saja; permintaan "semua"/"apa saja" menampilkan keduanya dalam
 * bagian terpisah.
 */

import { formatWibDateTime, jakartaDayRange, jakartaParts } from "./datetime";

export type PersonalIntent = "MY_LOANS" | "MY_HISTORY" | "MY_FINES";

export interface PersonalBorrowItem {
  id: string;
  bookId: string;
  title: string;
  author: string;
  status: string;
  borrowDate: Date;
  dueDate: Date;
  returnDate: Date | null;
  daysLate: number;
  overdue: boolean;
}

/**
 * Transaksi EbookLoan milik pengguna. `status` dan `daysRemaining` diturunkan
 * dari timestamp (borrowedAt/expiresAt/returnedAt), bukan dari kolom status
 * yang lazy — sama dengan aturan akses di halaman baca.
 */
export interface PersonalEbookLoanItem {
  id: string;
  bookId: string;
  title: string;
  author: string;
  /** ACTIVE | RETURNED | EXPIRED */
  status: string;
  borrowDate: Date;
  /** Akhir masa akses (EbookLoan.expiresAt). */
  dueDate: Date;
  returnDate: Date | null;
  daysRemaining: number;
  overdue: boolean;
}

export interface PersonalFineItem {
  id: string;
  bookId: string;
  title: string;
  author: string;
  amount: number;
  lateAmount: number;
  damageAmount: number;
  conditionLabel: string | null;
  daysLate: number;
  paid: number;
  outstanding: number;
  status: "UNPAID" | "PARTIAL" | "PAID";
}

export interface PersonalReference {
  id: string;
  title: string;
  author: string;
}

export interface PersonalAnswer {
  message: string;
  references: PersonalReference[];
}

export const NO_ACTIVE_LOANS = "Saat ini kamu tidak memiliki peminjaman aktif.";
export const NO_HISTORY = "Kamu belum memiliki riwayat peminjaman.";
export const NO_FINES = "Belum ada riwayat denda tercatat.";
export const PERSONAL_DATA_UNAVAILABLE = "Data belum dapat diakses. Silakan coba lagi.";
export const OTHER_USER_REFUSAL =
  "Maaf, saya tidak dapat mengungkap informasi pribadi atau riwayat peminjaman pengguna lain. " +
  "Jika kamu ingin melihat riwayat peminjamanmu sendiri, kamu bisa membukanya melalui menu Riwayat Peminjaman di DigiLib.";

/**
 * Penolakan spesifik untuk permintaan data DENDA pengguna lain / global.
 * Memakai istilah jenis denda yang benar-benar didukung sistem (keterlambatan
 * dan kerusakan) agar kategori penolakan sesuai dengan pertanyaan.
 */
export const OTHER_USER_FINE_REFUSAL =
  "Maaf, kamu hanya dapat melihat informasi denda milikmu sendiri, termasuk denda akibat keterlambatan maupun kerusakan buku. Saya tidak dapat menampilkan data denda seluruh siswa atau pengguna lain karena informasi tersebut dibatasi berdasarkan hak akses.";

/** Penolakan untuk pertanyaan pengaturan sistem yang menanyakan role non-Admin. */
export const ADMIN_ONLY_REFUSAL =
  "Maaf, pengaturan sistem hanya dapat dilihat oleh Administrator. Saya tidak dapat menampilkan informasi tersebut untuk peran Anda.";

/**
 * Penolakan khusus pemantauan aktivitas membaca ebook SELURUH pengguna.
 * Dibatasi untuk Administrator; Pustakawan maupun pengguna lain tidak otomatis
 * memperoleh akses ini. Pesan dibuat spesifik agar tidak tertukar dengan
 * penolakan pengaturan sistem.
 */
export const READING_ACTIVITY_ADMIN_ONLY =
  "Maaf, data aktivitas membaca ebook seluruh pengguna hanya dapat dipantau oleh Administrator. " +
  "Saya tidak dapat menampilkan sesi membaca, durasi, atau progres pengguna lain untuk peran Anda. " +
  "Anda tetap dapat menanyakan aktivitas membaca ebook milik Anda sendiri.";


/**
 * Pengungkapan keterbatasan untuk pertanyaan daftar identitas pengguna.
 * Jumlah pengguna agregat dan daftar identitas pengguna adalah izin yang
 * berbeda — asisten ini tidak menyediakan daftar identitas.
 */
export const USER_DIRECTORY_LIMITED =
  "Maaf, saya tidak dapat menampilkan daftar identitas pengguna. Saya hanya dapat menyebutkan jumlah pengguna secara agregat.";

/** Keterbatasan saat query direktori pengguna Admin gagal. */
export const USER_DIRECTORY_UNAVAILABLE =
  "Data daftar pengguna belum dapat diakses saat ini. Silakan coba lagi.";

/** Keterbatasan saat riwayat pengguna tertentu (Admin) gagal diambil. */
export const USER_HISTORY_UNAVAILABLE =
  "Data riwayat pengguna tersebut belum dapat diakses saat ini. Silakan coba lagi.";

export const USER_COUNT_UNAVAILABLE =
  "Data jumlah pengguna belum dapat diakses. Silakan coba lagi.";

/**
 * Filter demografis yang tidak dapat diterapkan. Jangan pernah menggantinya
 * dengan total pengguna umum karena itu menjawab pertanyaan yang berbeda.
 */
export const USER_COUNT_FILTER_UNSUPPORTED =
  "Maaf, filter pengguna yang diminta belum dapat diterapkan. " +
  "Data pengguna hanya menyimpan role, status akun, kelas, dan gender. " +
  "Silakan sebutkan kelas (mis. \"XII IPA 1\") atau gender (laki-laki/perempuan).";

/** Penolakan jumlah pengguna untuk role selain Administrator. */
export const USER_COUNT_ADMIN_ONLY =
  "Maaf, rincian jumlah pengguna per peran hanya dapat dilihat oleh Administrator. " +
  "Saya tidak dapat menampilkan informasi tersebut untuk peran Anda.";

/**
 * ADMIN dan PUSTAKAWAN bukan peminjam, sehingga tidak memiliki data
 * peminjaman/denda pribadi. Pesan dibedakan per peran agar tidak menyiratkan
 * bahwa akun mereka rusak atau datanya hilang.
 */
export const ADMIN_NOT_A_BORROWER =
  "Sebagai Administrator, Anda tidak terdaftar sebagai peminjam sehingga tidak memiliki data peminjaman pribadi. " +
  "Anda dapat memantau aktivitas peminjaman pengguna melalui menu Transaksi atau Laporan pada dasbor admin.";

export const LIBRARIAN_NOT_A_BORROWER =
  "Sebagai Pustakawan, Anda tidak terdaftar sebagai peminjam sehingga tidak memiliki data peminjaman pribadi. " +
  "Anda dapat memantau aktivitas peminjaman pengguna melalui menu Peminjaman.";

/** Pesan yang tepat untuk peran non-peminjam, atau null bila bukan non-peminjam. */
export function nonBorrowerPersonalMessage(role: string | null | undefined): string | null {
  if (role === "ADMIN") return ADMIN_NOT_A_BORROWER;
  if (role === "LIBRARIAN") return LIBRARIAN_NOT_A_BORROWER;
  return null;
}

/**
 * ADMIN dan PUSTAKAWAN tetap dapat memiliki denda pribadi (mis. pernah meminjam
 * sebelum menjabat, atau tercatat sebagai peminjam pada data lama). Karena itu
 * pertanyaan denda pribadi TIDAK boleh langsung dijawab dengan pesan
 * "bukan peminjam"; data milik `userId` sesi tetap diperiksa lebih dulu.
 * Pesan ini hanya dipakai bila hasil query benar-benar kosong.
 */
export const ADMIN_NO_FINES =
  "Sebagai Administrator, Anda tidak memiliki denda pribadi yang tercatat. " +
  "Denda pengguna lain dapat dipantau melalui menu Denda.";

export const LIBRARIAN_NO_FINES =
  "Sebagai Pustakawan, Anda tidak memiliki denda pribadi yang tercatat. " +
  "Denda pengguna lain dapat dipantau melalui menu Denda.";

/** Pesan "tidak ada denda" khusus peran non-peminjam, atau null bila bukan. */
export function nonBorrowerNoFinesMessage(role: string | null | undefined): string | null {
  if (role === "ADMIN") return ADMIN_NO_FINES;
  if (role === "LIBRARIAN") return LIBRARIAN_NO_FINES;
  return null;
}

export const SYSTEM_SETTINGS_UNAVAILABLE =
  "Data pengaturan sistem belum dapat diakses. Silakan coba lagi.";

/**
 * Keterbatasan saat query denda operasional gagal. Dipakai agar error TIDAK
 * pernah disamarkan menjadi jawaban "tidak ada denda".
 */
export const OPERATIONAL_FINES_UNAVAILABLE =
  "Data denda belum dapat diakses saat ini. Silakan coba lagi.";

/**
 * Keterbatasan saat query transaksi peminjaman per tanggal gagal. Dipakai agar
 * kegagalan query TIDAK pernah disamarkan sebagai "tidak ada peminjam" —
 * pengguna harus tahu bedanya data kosong dan data tidak dapat diakses.
 */
export const OPERATIONAL_BORROWS_UNAVAILABLE =
  "Data transaksi peminjaman belum dapat diakses saat ini. Silakan coba lagi.";

export const OPERATIONAL_READING_UNAVAILABLE =
  "Data aktivitas membaca ebook belum dapat diakses saat ini. Silakan coba lagi.";

/**
 * Penolakan untuk pertanyaan RIWAYAT AUDIT pembuatan/penghapusan akun. Pesan ini
 * sengaja seragam dan TIDAK mengungkapkan apakah akun tertentu ada, dibuat, atau
 * dihapus — hanya menyatakan bahwa informasi tersebut khusus Administrator.
 */
export const AUDIT_ADMIN_ONLY =
  "Maaf, riwayat pembuatan dan penghapusan akun pengguna hanya dapat diakses oleh Administrator. Saya tidak dapat menampilkan informasi tersebut untuk peran Anda.";

/**
 * Keterbatasan saat query audit gagal. Dipakai agar kegagalan query TIDAK
 * pernah disamarkan sebagai "tidak ada aktivitas audit".
 */
export const USER_AUDIT_UNAVAILABLE =
  "Data riwayat audit pengguna belum dapat diakses saat ini. Silakan coba lagi.";

/**
 * Penolakan deterministik untuk permintaan yang mencoba MENGUBAH data/role
 * melalui percakapan. Chat tidak memiliki kemampuan mutasi database.
 */
export const MUTATION_REFUSAL =
  "Maaf, asisten DigiLib tidak dapat mengubah data, peran, akun, password, koleksi, atau transaksi melalui percakapan. " +
  "Silakan gunakan menu administrasi yang sesuai di DigiLib. Untuk tindakan yang membutuhkan wewenang, hubungi Administrator.";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function formatDateID(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

export function formatRupiah(amount: number): string {
  return `Rp${Math.round(amount).toLocaleString("id-ID")}`;
}

function reference(item: { bookId: string; title: string; author: string }): PersonalReference {
  return { id: item.bookId, title: item.title, author: item.author };
}

function referencesFrom(
  items: Array<{ bookId: string; title: string; author: string }>,
  limit = 4
): PersonalReference[] {
  const seen = new Set<string>();
  const refs: PersonalReference[] = [];
  for (const item of items) {
    if (seen.has(item.bookId)) continue;
    seen.add(item.bookId);
    refs.push(reference(item));
    if (refs.length >= limit) break;
  }
  return refs;
}

function numbered(lines: string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

function bulleted(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

/** Kata yang tidak pernah menjadi bagian judul buku pada pertanyaan pengguna. */
const QUERY_STOPWORDS = new Set([
  "yang", "dari", "untuk", "pada", "dengan", "adalah", "apa", "apakah",
  "buku", "judul", "saya", "aku", "kamu", "punya", "milik", "sedang", "masih",
  "lagi", "belum", "sudah", "telah", "pernah", "kapan", "tanggal", "hari",
  "harus", "wajib", "dikembalikan", "kembalikan", "mengembalikan", "kembali",
  "jatuh", "tempo", "tenggat", "terlambat", "telat", "overdue", "aktif",
  "jumlah", "berapa", "banyak", "total", "tampilkan", "lihat", "daftar",
  "riwayat", "terakhir", "bulan", "tahun", "minggu", "ini", "lalu", "kemarin",
  "denda", "tagihan", "penyebab", "menyebabkan", "akibat", "karena", "lunas",
  "dibayar", "bayar", "mana", "saja", "kali", "meminjam", "pinjam", "peminjaman",
  "pinjaman", "pengembalian", "semua", "masing", "tolong", "coba", "sekarang",
  // Penanda FORMAT dan cakupan, bukan judul buku. "fisik" harus dibedakan dari
  // mata pelajaran "Fisika"; "seluruh"/"keseluruhan" hanya menandakan cakupan.
  "fisik", "fisiknya", "cetak", "cetakan", "hardcopy", "softcopy",
  "digital", "digitalnya", "elektronik", "elektroniknya",
  "seluruh", "keseluruhan", "semuanya",
  // Kata umum soal membaca, bukan judul buku.
  "baca", "membaca", "bacaan", "pembacaan",
]);

/**
 * Menyeragamkan penulisan ebook ("e-book", "e book", "ebooks") agar deteksi
 * sumber data EbookLoan tidak bergantung pada tanda hubung.
 */
function normalizeFormatWords(query: string): string {
  return query.toLowerCase().replace(/\be[\s-]?books?\b/g, "ebook");
}

/** Kata kunci judul buku yang mungkin disebut pengguna. */
function titleTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !QUERY_STOPWORDS.has(w));
}

function filterByTitle<T extends { title: string; author: string }>(
  items: T[],
  query: string
): T[] {
  const terms = titleTerms(query);
  if (terms.length === 0) return items;
  const matched = items.filter((item) => {
    const haystack = `${item.title} ${item.author}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
  return matched.length > 0 ? matched : items;
}

/** Sama seperti filterByTitle tapi TIDAK mengembalikan seluruh daftar saat tidak cocok. */
function strictMatchByTitle<T extends { title: string; author: string }>(
  items: T[],
  terms: string[]
): T[] {
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const haystack = `${item.title} ${item.author}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
}

/**
 * Perkiraan "hari lagi" (positif) atau keterlambatan dari selisih tanggal.
 */
function relativeDays(dueDate: Date, now: Date): string {
  const diff = Math.ceil((dueDate.getTime() - now.getTime()) / MS_PER_DAY);
  if (diff < 0) return `terlambat ${Math.abs(diff)} hari`;
  if (diff === 0) return "jatuh tempo hari ini";
  return `${diff} hari lagi`;
}

/** Sisa masa akses ebook dalam bahasa Indonesia. */
function ebookRelativeDays(dueDate: Date, now: Date): string {
  const diff = Math.ceil((dueDate.getTime() - now.getTime()) / MS_PER_DAY);
  if (diff < 0) return `kedaluwarsa ${Math.abs(diff)} hari yang lalu`;
  if (diff === 0) return "berakhir hari ini";
  return `tersisa ${diff} hari`;
}

/**
 * Catatan pembeda untuk pertanyaan ebook: EbookLoan hanya mencatat masa
 * akses/peminjaman, sedangkan aktivitas membaca dicatat terpisah sebagai sesi
 * reader (EbookReadingSession). Status ACTIVE bukan bukti ebook sudah dibaca.
 */
export const EBOOK_LOAN_VS_READING_NOTE =
  "Catatan: masa akses/peminjaman ebook berbeda dari aktivitas membaca. Aktivitas membaca dicatat terpisah saat ebook dibuka di reader.";

const EBOOK_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "masa akses aktif",
  RETURNED: "sudah dikembalikan",
  EXPIRED: "kedaluwarsa",
};

interface LoanFlags {
  wantsCount: boolean;
  wantsStart: boolean;
  wantsDue: boolean;
  wantsRemaining: boolean;
  wantsIsActive: boolean;
}

/** Flag tambahan untuk jawaban buku fisik (tidak ada "masa akses"). */
interface PhysicalLoanFlags extends LoanFlags {
  /** Teks pertanyaan asli — dipakai untuk pencocokan judul. */
  query: string;
  wantsOverdue: boolean;
  wantsNearest: boolean;
}

interface CombinedLoan {
  title: string;
  author: string;
  start: Date;
  end: Date;
  isEbook: boolean;
  ref: PersonalReference;
}

/**
 * Cakupan format untuk pertanyaan peminjaman pribadi.
 *
 * - "EBOOK"    : pengguna secara eksplisit menyebut ebook/buku digital.
 * - "PHYSICAL" : pengguna menyebut buku fisik/cetak, ATAU menyebut "buku"
 *                tanpa penanda digital (default produk: buku fisik).
 * - "ALL"      : pengguna meminta semua peminjaman ("semua", "apa saja") atau
 *                memakai kalimat umum tanpa menyebut format sama sekali
 *                (mis. "apa yang sedang saya pinjam?").
 *
 * Fungsi ini adalah SATU-SATUNYA sumber kebenaran format. Dipakai di lapisan
 * data (personal.ts) untuk MEMBATAS QUERY, dan di lapisan jawaban untuk
 * memisahkan bagian hasil.
 */
export type PersonalLoanScope = "PHYSICAL" | "EBOOK" | "ALL";

const EXPLICIT_EBOOK_SCOPE =
  /\b(e-?books?|buku\s+digital(?:nya)?|buku\s+elektronik(?:nya)?|bacaan\s+digital|versi\s+digital)\b/;
const EXPLICIT_PHYSICAL_SCOPE =
  /\b(buku\s+fisik|buku\s+cetak|versi\s+fisik|versi\s+cetak|hardcopy|softcopy)\b/;
const ALL_SCOPE_WORDS = /\b(semua|apa\s+saja|seluruh|keseluruhan)\b/;
const BOOK_NOUN = /\b(buku|ebook|peminjaman|pinjaman)\b/;

export function resolvePersonalLoanScope(query: string): PersonalLoanScope {
  const q = ` ${query.toLowerCase()} `;
  if (EXPLICIT_EBOOK_SCOPE.test(q)) return "EBOOK";
  if (EXPLICIT_PHYSICAL_SCOPE.test(q)) return "PHYSICAL";
  if (ALL_SCOPE_WORDS.test(q) && BOOK_NOUN.test(q)) return "ALL";
  // "buku" tanpa penanda digital → buku fisik (default produk).
  if (/\bbuku\b/.test(q)) return "PHYSICAL";
  // Kalimat umum tanpa menyebut format → tampilkan keduanya (dipisahkan).
  return "ALL";
}

/** Jawaban khusus untuk pertanyaan tentang ebook dengan masa akses aktif. */
function buildEbookLoansAnswer(
  ebooks: PersonalEbookLoanItem[],
  now: Date,
  flags: LoanFlags
): PersonalAnswer {
  if (flags.wantsRemaining) {
    if (ebooks.length === 1) {
      return {
        message: `Masa akses ebook kamu tersisa ${ebooks[0].daysRemaining} hari.`,
        references: referencesFrom(ebooks),
      };
    }
    const list = numbered(
      ebooks.map((e) => `${e.title} — ${ebookRelativeDays(e.dueDate, now)}`)
    );
    return {
      message: `Sisa masa akses ebook kamu:\n\n${list}`,
      references: referencesFrom(ebooks),
    };
  }

  if (flags.wantsCount) {
    return {
      message: `Kamu memiliki ${ebooks.length} ebook dengan masa akses aktif.\n\n${EBOOK_LOAN_VS_READING_NOTE}`,
      references: referencesFrom(ebooks),
    };
  }

  if (flags.wantsStart) {
    if (ebooks.length === 1) {
      return {
        message: `Masa akses ebook ${ebooks[0].title} dimulai pada ${formatDateID(ebooks[0].borrowDate)}.`,
        references: referencesFrom(ebooks),
      };
    }
    const list = numbered(
      ebooks.map((e) => `${e.title} — sejak ${formatDateID(e.borrowDate)}`)
    );
    return {
      message: `Masa akses ebook kamu dimulai:\n\n${list}`,
      references: referencesFrom(ebooks),
    };
  }

  if (flags.wantsDue) {
    if (ebooks.length === 1) {
      return {
        message: `Masa akses ebook ${ebooks[0].title} berakhir pada ${formatDateID(ebooks[0].dueDate)}.`,
        references: referencesFrom(ebooks),
      };
    }
    const list = numbered(ebooks.map((e) => `${e.title} — ${formatDateID(e.dueDate)}`));
    return {
      message: `Akhir masa akses ebook kamu:\n\n${list}`,
      references: referencesFrom(ebooks),
    };
  }

  if (flags.wantsIsActive) {
    const first = ebooks[0];
    return {
      message: `Ya, masa akses ebook kamu masih aktif (${first.title}, tersisa ${first.daysRemaining} hari).`,
      references: referencesFrom(ebooks),
    };
  }

  if (ebooks.length === 1) {
    return {
      message: `Kamu memiliki masa akses aktif untuk ebook ${ebooks[0].title} karya ${ebooks[0].author}.\n\n${EBOOK_LOAN_VS_READING_NOTE}`,
      references: referencesFrom(ebooks),
    };
  }
  const list = numbered(ebooks.map((e) => `${e.title} karya ${e.author}`));
  return {
    message: `Kamu memiliki masa akses aktif untuk ${ebooks.length} ebook:\n\n${list}\n\n${EBOOK_LOAN_VS_READING_NOTE}`,
    references: referencesFrom(ebooks),
  };
}

/**
 * Jawaban untuk peminjaman buku FISIK saja (sumber BorrowRecord).
 * Tidak pernah menampilkan EbookLoan.
 */
function buildPhysicalLoansAnswer(
  active: PersonalBorrowItem[],
  now: Date,
  flags: PhysicalLoanFlags
): PersonalAnswer {
  if (flags.wantsOverdue) {
    const late = active.filter((item) => item.overdue);
    if (late.length === 0) {
      return { message: "Tidak ada buku yang terlambat.", references: [] };
    }
    const list = numbered(late.map((item) => `${item.title} (terlambat ${item.daysLate} hari)`));
    return {
      message: `Kamu memiliki ${late.length} buku terlambat:\n\n${list}`,
      references: referencesFrom(late),
    };
  }

  if (flags.wantsNearest) {
    const nearest = [...active].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    return {
      message: `Jatuh tempo terdekat: ${nearest.title} — ${formatDateID(nearest.dueDate)} (${relativeDays(
        nearest.dueDate,
        now
      )}).`,
      references: [reference(nearest)],
    };
  }

  if (flags.wantsStart) {
    if (active.length === 1) {
      return {
        message: `Kamu mulai meminjam ${active[0].title} pada ${formatDateID(active[0].borrowDate)}.`,
        references: [reference(active[0])],
      };
    }
    const list = numbered(active.map((item) => `${item.title} — sejak ${formatDateID(item.borrowDate)}`));
    return {
      message: `Kamu mulai meminjam:\n\n${list}`,
      references: active.map((item) => reference(item)),
    };
  }

  if (flags.wantsDue) {
    const filtered = filterByTitle(active, flags.query);
    if (filtered.length === 1) {
      return {
        message: `Jatuh tempo ${filtered[0].title} adalah ${formatDateID(filtered[0].dueDate)}.`,
        references: [reference(filtered[0])],
      };
    }
    const list = numbered(filtered.map((item) => `${item.title} — ${formatDateID(item.dueDate)}`));
    return {
      message: `Jatuh tempo peminjamanmu:\n\n${list}`,
      references: filtered.map((item) => reference(item)),
    };
  }

  if (flags.wantsIsActive) {
    const list = numbered(active.map((item) => item.title));
    return {
      message: `Ya, kamu masih memiliki ${active.length} peminjaman buku fisik yang aktif:\n\n${list}`,
      references: referencesFrom(active),
    };
  }

  if (flags.wantsCount) {
    return {
      message: `Kamu sedang meminjam ${active.length} buku fisik.`,
      references: referencesFrom(active),
    };
  }

  const list = numbered(active.map((item) => item.title));
  return {
    message: `Kamu sedang meminjam ${active.length} buku fisik:\n\n${list}`,
    references: referencesFrom(active),
  };
}

/**
 * Jawaban untuk permintaan SEMUA peminjaman: buku fisik dan ebook ditampilkan
 * dalam bagian TERPISAH agar keduanya tidak tercampur menjadi satu daftar.
 */
function buildCombinedLoansAnswer(
  active: PersonalBorrowItem[],
  activeEbooks: PersonalEbookLoanItem[],
  pending: PersonalBorrowItem[],
  now: Date,
  flags: PhysicalLoanFlags
): PersonalAnswer {
  const references = referencesFrom([
    ...active.map((item) => ({ bookId: item.bookId, title: item.title, author: item.author })),
    ...activeEbooks.map((e) => ({ bookId: e.bookId, title: e.title, author: e.author })),
  ]);

  if (active.length === 0 && activeEbooks.length === 0) {
    let message = NO_ACTIVE_LOANS;
    if (pending.length > 0) {
      message += ` Ada ${pending.length} pengajuan yang menunggu persetujuan.`;
    }
    return { message, references: [] };
  }

  if (flags.wantsCount) {
    let message = `Kamu sedang meminjam ${active.length} buku fisik dan ${activeEbooks.length} ebook.`;
    if (pending.length > 0) {
      message += ` Ada ${pending.length} pengajuan yang menunggu persetujuan.`;
    }
    return { message, references };
  }

  const sections: string[] = [];

  if (active.length > 0) {
    if (flags.wantsOverdue) {
      const late = active.filter((item) => item.overdue);
      sections.push(
        late.length > 0
          ? `Buku fisik (terlambat):\n${numbered(late.map((i) => `${i.title} (terlambat ${i.daysLate} hari)`))}`
          : "Buku fisik: tidak ada yang terlambat."
      );
    } else {
      sections.push(`Buku fisik:\n${numbered(active.map((i) => i.title))}`);
    }
  } else {
    sections.push("Buku fisik: tidak ada yang sedang dipinjam.");
  }

  if (activeEbooks.length > 0) {
    sections.push(`Ebook:\n${numbered(activeEbooks.map((e) => e.title))}`);
  } else {
    sections.push("Ebook: tidak ada yang sedang dipinjam.");
  }

  const header = "Pinjaman kamu saat ini:\n\n";

  let message = `${header}${sections.join("\n\n")}`;
  if (pending.length > 0) {
    message += `\n\nAda ${pending.length} pengajuan yang menunggu persetujuan.`;
  }

  return { message, references };
}

/**
 * Jawaban untuk pertanyaan "apa yang sedang saya pinjam".
 *
 * PEMISAHAN FORMAT (aturan produk):
 * - menyebut "ebook"  → hanya EbookLoan
 * - menyebut fisik    → hanya BorrowRecord
 * - "semua"/"apa saja" → keduanya, bagian terpisah
 * - default ("buku")  → hanya BorrowRecord (buku fisik)
 */
export function buildLoansAnswer(
  query: string,
  active: PersonalBorrowItem[],
  pending: PersonalBorrowItem[],
  now: Date = new Date(),
  activeEbooks: PersonalEbookLoanItem[] = []
): PersonalAnswer {
  const q = query.toLowerCase();
  const scope = resolvePersonalLoanScope(query);
  const wantsEbook = scope === "EBOOK";
  const wantsPhysical = scope === "PHYSICAL";
  const wantsAll = scope === "ALL";

  const wantsCount = /\b(berapa|jumlah|banyak)\b/.test(q);
  const wantsOverdue =
    /\b(terlambat|telat|overdue)\b/.test(q) ||
    /\b(?:melewati|melebihi|lewat)\s+(?:dari\s+)?(?:batas|jatuh\s*tempo|tanggal\s+(?:pengembalian|kembali))\b/.test(
      q
    );
  const wantsNearest = /\b(paling\s+)?(dekat|cepat|dulu)\b/.test(q) && /\bjatuh\s*tempo/.test(q);
  const wantsStart =
    /\b(sejak\s+kapan|sejak\s+meminjam|sejak\s+membaca)\b/.test(q) ||
    /\bkapan\s+(?:saya|aku)\s+mulai\b/.test(q) ||
    /\b(mulai\s+membaca|mulai\s+meminjam)\b/.test(q) ||
    (/\bkapan\s+(?:membaca|meminjam)\b/.test(q) && /\b(mulai|buku\s+ini)\b/.test(q));
  const wantsDue =
    !wantsNearest &&
    /\b(kapan|tanggal|jatuh\s*tempo|tenggat|dikembalikan|kembali|berakhir|selesai|habis)\b/.test(q);
  const wantsRemaining =
    /\b(sisa|tersisa)\b/.test(q) ||
    /\bberapa\s+hari\s+lagi\b/.test(q) ||
    /\bmasa\s+akses\s+(?:habis|sisa|lagi|tersisa)\b/.test(q);
  const wantsIsActive =
    (/\bapakah\b/.test(q) && /\b(aktif|masih|habis|berakhir|selesai|berlaku)\b/.test(q)) ||
    /\bmasih\s+(?:aktif|punya|boleh|bisa)\b/.test(q);

  // Pertanyaan yang menyebut "ebook" dijawab murni dari transaksi EbookLoan.
  if (wantsEbook) {
    if (activeEbooks.length === 0) {
      return {
        message: "Saat ini kamu tidak memiliki ebook dengan masa akses aktif.",
        references: [],
      };
    }
    return buildEbookLoansAnswer(activeEbooks, now, {
      wantsCount,
      wantsStart,
      wantsDue,
      wantsRemaining,
      wantsIsActive,
    });
  }

  // Pertanyaan yang eksplisit meminta buku fisik.
  if (wantsPhysical) {
    if (active.length === 0) {
      return {
        message: "Saat ini kamu tidak memiliki buku fisik yang sedang dipinjam.",
        references: [],
      };
    }
    return buildPhysicalLoansAnswer(active, now, {
      query,
      wantsCount,
      wantsOverdue,
      wantsNearest,
      wantsStart,
      wantsDue,
      wantsRemaining,
      wantsIsActive,
    });
  }

  // Pertanyaan yang meminta semua format ("semua", "apa saja", atau kalimat umum).
  if (wantsAll) {
    return buildCombinedLoansAnswer(active, activeEbooks, pending, now, {
      query,
      wantsCount,
      wantsOverdue,
      wantsNearest,
      wantsStart,
      wantsDue,
      wantsRemaining,
      wantsIsActive,
    });
  }

  // Default: hanya buku fisik (sumber BorrowRecord).
  if (active.length === 0) {
    let message = "Saat ini kamu tidak memiliki buku fisik yang sedang dipinjam.";
    if (pending.length > 0) {
      message += ` Ada ${pending.length} pengajuan yang menunggu persetujuan.`;
    }
    return { message, references: [] };
  }

  const answer = buildPhysicalLoansAnswer(active, now, {
    query,
    wantsCount,
    wantsOverdue,
    wantsNearest,
    wantsStart,
    wantsDue,
    wantsRemaining,
    wantsIsActive,
  });

  if (pending.length > 0) {
    answer.message += ` Ada ${pending.length} pengajuan yang menunggu persetujuan.`;
  }

  return answer;
}

/**
 * Awal bulan (tengah malam tanggal 1) menurut zona Asia/Jakarta, dikembalikan
 * sebagai instant UTC. `monthOffset` menggeser bulan (mis. -1 = bulan lalu).
 *
 * Batas periode HARUS memakai zona yang sama dengan tampilan tanggal pengguna
 * (Asia/Jakarta); memakai waktu lokal server membuat "bulan ini" bergeser pada
 * server yang bukan WIB (mis. UTC), sehingga transaksi awal bulan bisa
 * salah masuk ke "bulan lalu".
 */
function jakartaStartOfMonth(date: Date, monthOffset = 0): Date {
  const { year, month } = jakartaParts(date);
  const index = year * 12 + (month - 1) + monthOffset;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  return jakartaDayRange(targetYear, targetMonth, 1).start;
}

export function historyPeriod(
  query: string,
  now: Date
): { from: Date | null; to: Date | null; label: string } {
  const q = query.toLowerCase();
  if (/\bbulan\s+ini\b/.test(q)) {
    return { from: jakartaStartOfMonth(now), to: null, label: "bulan ini" };
  }
  if (/\bbulan\s+lalu\b/.test(q)) {
    return {
      from: jakartaStartOfMonth(now, -1),
      to: jakartaStartOfMonth(now),
      label: "bulan lalu",
    };
  }
  if (/\btahun\s+ini\b/.test(q)) {
    return { from: jakartaDayRange(year(now), 1, 1).start, to: null, label: "tahun ini" };
  }
  if (/\btahun\s+lalu\b/.test(q)) {
    return {
      from: jakartaDayRange(year(now) - 1, 1, 1).start,
      to: jakartaDayRange(year(now), 1, 1).start,
      label: "tahun lalu",
    };
  }
  return { from: null, to: null, label: "" };
}

/** Tahun berjalan menurut zona Asia/Jakarta. */
function year(date: Date): number {
  return jakartaParts(date).year;
}

const STATUS_LABEL: Record<string, string> = {
  BORROWED: "sedang dipinjam",
  OVERDUE: "terlambat",
  RETURNED: "sudah dikembalikan",
};

export function buildHistoryAnswer(
  query: string,
  history: PersonalBorrowItem[],
  now: Date = new Date(),
  ebookHistory: PersonalEbookLoanItem[] = [],
  activeEbooks: PersonalEbookLoanItem[] = []
): PersonalAnswer {
  const q = normalizeFormatWords(query);
  const period = historyPeriod(query, now);

  const inPeriod = (d: Date): boolean => {
    const t = d.getTime();
    if (period.from && t < period.from.getTime()) return false;
    if (period.to && t >= period.to.getTime()) return false;
    return true;
  };

  // Semua transaksi ebook milik pengguna (aktif + selesai + kedaluwarsa).
  const allEbooks = [...activeEbooks, ...ebookHistory];

  // Pertanyaan yang menyebut ebook (termasuk "e-book"/"buku digital") dijawab
  // murni dari EbookLoan. Memakai resolver format yang sama dengan lapisan
  // data agar sumber data dan jawaban tidak pernah berbeda.
  if (resolvePersonalLoanScope(q) === "EBOOK") {
    if (allEbooks.length === 0) {
      return { message: "Kamu belum pernah meminjam ebook.", references: [] };
    }
    const periodEbooks = allEbooks.filter((e) => inPeriod(e.borrowDate));
    const pool = periodEbooks.length > 0 && (period.from || period.to) ? periodEbooks : allEbooks;

    const wantsCount = /\b(berapa|jumlah|banyak|total)\b/.test(q);
    const wantsUnique = /\bjudul\b/.test(q);
    const wantsLast =
      /\bterakhir\b/.test(q) && !wantsCount;
    const wantsLastReturned =
      /\b(terakhir|baru)\b/.test(q) &&
      /\b(kembalikan|mengembalikan|dikembalikan|kembali|selesai|selesaikan)\b/.test(q) &&
      !wantsCount;
    const wantsReturned =
      /\b(?:sudah|telah)\s+(?:saya\s+|aku\s+)?(?:kembalikan|mengembalikan|selesaikan|menyelesaikan)\b/.test(q) ||
      /\bsudah\s+(?:dikembalikan|selesai)\b/.test(q);

    if (wantsCount) {
      if (wantsUnique) {
        const unique = new Set(pool.map((item) => item.bookId)).size;
        return {
          message: `Kamu pernah meminjam ${unique} judul ebook${period.label ? ` (${period.label})` : ""}.`,
          references: referencesFrom(pool),
        };
      }
      return {
        message: `Kamu pernah meminjam ${pool.length} transaksi ebook${period.label ? ` (${period.label})` : ""}.`,
        references: referencesFrom(pool),
      };
    }

    if (wantsLastReturned) {
      const returned = pool.filter((item) => item.returnDate);
      if (returned.length === 0) {
        return { message: "Kamu belum mengembalikan ebook apa pun.", references: [] };
      }
      const last = [...returned].sort(
        (a, b) => (b.returnDate as Date).getTime() - (a.returnDate as Date).getTime()
      )[0];
      return {
        message: `Ebook terakhir yang kamu selesaikan: ${last.title} (dikembalikan ${formatDateID(last.returnDate as Date)}).`,
        references: [reference(last)],
      };
    }

    if (wantsLast) {
      const last = [...pool].sort((a, b) => b.borrowDate.getTime() - a.borrowDate.getTime())[0];
      return {
        message: `Terakhir kali kamu meminjam ebook ${last.title} pada ${formatDateID(last.borrowDate)}.`,
        references: [reference(last)],
      };
    }

    if (wantsReturned) {
      const returned = pool.filter((item) => item.status === "RETURNED");
      if (returned.length === 0) {
        return { message: "Kamu belum mengembalikan ebook apa pun.", references: [] };
      }
      const list = bulleted(
        returned.map(
          (item) =>
            `${item.title}${item.returnDate ? ` (dikembalikan ${formatDateID(item.returnDate)})` : ""}`
        )
      );
      return {
        message: `Kamu sudah mengembalikan ${returned.length} ebook:\n\n${list}`,
        references: referencesFrom(returned),
      };
    }

    const shown = [...pool].sort((a, b) => b.borrowDate.getTime() - a.borrowDate.getTime()).slice(0, 20);
    const list = bulleted(
      shown.map(
        (item) =>
          `${item.title} — dipinjam ${formatDateID(item.borrowDate)} (${
            EBOOK_STATUS_LABEL[item.status] ?? item.status.toLowerCase()
          })`
      )
    );
    const more = pool.length > shown.length ? `\n... dan ${pool.length - shown.length} lainnya.` : "";
    const readingNote = /\b(baca|membaca|dibaca)\b/.test(q)
      ? `\n\n${EBOOK_LOAN_VS_READING_NOTE}`
      : "";
    return {
      message: `Riwayat ebook kamu${period.label ? ` (${period.label})` : ""}:\n\n${list}${more}${readingNote}`,
      references: referencesFrom(pool),
    };
  }

  let items = history.filter((item) => inPeriod(item.borrowDate));
  let ebooks = allEbooks.filter((e) => inPeriod(e.borrowDate));

  // Pertanyaan dengan judul spesifik ("Apakah saya pernah meminjam buku
  // Matematika?") dibatasi ke transaksi yang benar-benar memuat judul itu,
  // dan dijawab negatif bila tidak ada — bukan menampilkan seluruh riwayat.
  const terms = titleTerms(q);
  if (terms.length > 0) {
    const matchedPhys = strictMatchByTitle(items, terms);
    const matchedEbook = strictMatchByTitle(ebooks, terms);
    if (matchedPhys.length === 0 && matchedEbook.length === 0) {
      return {
        message: `Tidak, kamu belum pernah meminjam buku ${terms.join(" ")}.`,
        references: [],
      };
    }
    items = matchedPhys;
    ebooks = matchedEbook;
  }

  if (items.length === 0 && ebooks.length === 0) {
    return { message: NO_HISTORY, references: [] };
  }

  const wantsCount = /\b(berapa|jumlah|banyak|total)\b/.test(q);
  const wantsUnique = /\bjudul\b/.test(q);
  const wantsLastReturned =
    /\b(terakhir|baru)\b/.test(q) &&
    /\b(kembalikan|mengembalikan|dikembalikan|kembali|selesai|selesaikan)\b/.test(q) &&
    !wantsCount;
  const wantsLast = /\bterakhir\b/.test(q) && !wantsCount && !wantsLastReturned;
  const wantsReturned =
    /\b(?:sudah|telah)\s+(?:saya\s+|aku\s+)?(?:kembalikan|mengembalikan|selesaikan|menyelesaikan)\b/.test(q) ||
    /\bsudah\s+(?:dikembalikan|selesai)\b/.test(q);

  // Jumlah transaksi dibedakan antara buku fisik dan ebook.
  if (wantsCount && ebooks.length > 0 && items.length > 0) {
    if (wantsUnique) {
      const uniquePhys = new Set(items.map((item) => item.bookId)).size;
      const uniqueEbook = new Set(ebooks.map((item) => item.bookId)).size;
      return {
        message: `Kamu pernah meminjam ${uniquePhys} judul buku fisik dan ${uniqueEbook} judul ebook${
          period.label ? ` (${period.label})` : ""
        }.`,
        references: referencesFrom([...items, ...ebooks]),
      };
    }
    return {
      message: `Kamu pernah meminjam ${items.length} transaksi buku fisik dan ${ebooks.length} transaksi ebook${
        period.label ? ` (${period.label})` : ""
      }.`,
      references: referencesFrom([...items, ...ebooks]),
    };
  }

  // Hanya ebook yang tersedia (mis. permintaan "seluruh riwayat" tetapi siswa
  // belum pernah meminjam buku fisik). Jangan laporkan 0 transaksi.
  if (wantsCount && items.length === 0 && ebooks.length > 0) {
    if (wantsUnique) {
      const uniqueEbook = new Set(ebooks.map((item) => item.bookId)).size;
      return {
        message: `Kamu pernah meminjam ${uniqueEbook} judul ebook${
          period.label ? ` (${period.label})` : ""
        }.`,
        references: referencesFrom(ebooks),
      };
    }
    return {
      message: `Kamu pernah meminjam ${ebooks.length} transaksi ebook${
        period.label ? ` (${period.label})` : ""
      }.`,
      references: referencesFrom(ebooks),
    };
  }

  if (wantsCount) {
    if (wantsUnique) {
      const unique = new Set(items.map((item) => item.bookId)).size;
      return {
        message: `Kamu pernah meminjam ${unique} judul buku${period.label ? ` (${period.label})` : ""}.`,
        references: referencesFrom(items),
      };
    }
    return {
      message: `Kamu pernah meminjam ${items.length} transaksi peminjaman${
        period.label ? ` (${period.label})` : ""
      }.`,
      references: referencesFrom(items),
    };
  }

  if (wantsLastReturned) {
    const returnedPhys = items.filter(
      (item) => item.status === "RETURNED" && item.returnDate
    );
    const returnedEbook = ebooks.filter((item) => item.returnDate);
    const returnedWithDate = [...returnedPhys, ...returnedEbook];
    if (returnedWithDate.length === 0) {
      return { message: "Kamu belum mengembalikan buku apa pun.", references: [] };
    }
    const last = [...returnedWithDate].sort(
      (a, b) => (b.returnDate as Date).getTime() - (a.returnDate as Date).getTime()
    )[0];
    return {
      message: `Buku terakhir yang kamu kembalikan: ${last.title} (dikembalikan ${formatDateID(
        last.returnDate as Date
      )}).`,
      references: [reference(last)],
    };
  }

  if (wantsLast) {
    const all = [...items, ...ebooks];
    const last = [...all].sort((a, b) => b.borrowDate.getTime() - a.borrowDate.getTime())[0];
    return {
      message: `Peminjaman terakhir: ${last.title} pada ${formatDateID(last.borrowDate)}.`,
      references: [reference(last)],
    };
  }

  if (wantsReturned) {
    const returnedPhys = items.filter((item) => item.status === "RETURNED");
    const returnedEbook = ebooks.filter((item) => item.status === "RETURNED");
    if (returnedPhys.length === 0 && returnedEbook.length === 0) {
      return { message: "Kamu belum mengembalikan buku apa pun.", references: [] };
    }
    const formatReturned = (item: { title: string; returnDate: Date | null }) =>
      `${item.title}${item.returnDate ? ` (dikembalikan ${formatDateID(item.returnDate)})` : ""}`;
    if (returnedPhys.length > 0 && returnedEbook.length > 0) {
      const list = bulleted([
        ...returnedPhys.map((item) => formatReturned(item)),
        ...returnedEbook.map((item) => formatReturned(item)),
      ]);
      return {
        message: `Kamu sudah mengembalikan ${returnedPhys.length} buku fisik dan ${returnedEbook.length} ebook:\n\n${list}`,
        references: referencesFrom([...returnedPhys, ...returnedEbook]),
      };
    }
    const returned = returnedPhys.length > 0 ? returnedPhys : returnedEbook;
    const list = bulleted(returned.map((item) => formatReturned(item)));
    return {
      message: `Kamu sudah mengembalikan ${returned.length} buku:\n\n${list}`,
      references: referencesFrom(returned),
    };
  }

  const all = [...items, ...ebooks]
    .sort((a, b) => b.borrowDate.getTime() - a.borrowDate.getTime())
    .slice(0, 20);
  const ebookIds = new Set(ebooks.map((e) => e.id));
  const list = bulleted(
    all.map((item) => {
      const label = STATUS_LABEL[item.status] ?? EBOOK_STATUS_LABEL[item.status] ?? item.status.toLowerCase();
      return `${item.title}${ebookIds.has(item.id) ? " (ebook)" : ""} — dipinjam ${formatDateID(item.borrowDate)} (${label})`;
    })
  );
  const total = items.length + ebooks.length;
  const more = total > all.length ? `\n... dan ${total - all.length} lainnya.` : "";
  const readingNote =
    ebooks.length > 0 && /\b(baca|membaca|dibaca)\b/.test(q)
      ? `\n\n${EBOOK_LOAN_VS_READING_NOTE}`
      : "";
  return {
    message: `Riwayat peminjamanmu${period.label ? ` (${period.label})` : ""}:\n\n${list}${more}${readingNote}`,
    references: referencesFrom([...items, ...ebooks]),
  };
}

export function buildFinesAnswer(
  query: string,
  fines: PersonalFineItem[]
): PersonalAnswer {
  const q = query.toLowerCase();

  if (fines.length === 0) {
    return { message: NO_FINES, references: [] };
  }

  const totalAmount = fines.reduce((sum, fine) => sum + fine.amount, 0);
  const paidAmount = fines.reduce((sum, fine) => sum + fine.paid, 0);
  const outstanding = fines.reduce((sum, fine) => sum + fine.outstanding, 0);

  const wantsCause = /\b(penyebab|menyebabkan|akibat|karena|buku\s+mana|alasan|kenapa|mengapa|sebab)\b/.test(q);

  if (wantsCause) {
    const list = numbered(
      fines.map((fine) => {
        const reasons: string[] = [];
        if (fine.lateAmount > 0) reasons.push(`keterlambatan ${fine.daysLate} hari`);
        if (fine.damageAmount > 0) {
          reasons.push(fine.conditionLabel ? `kerusakan: ${fine.conditionLabel}` : "kerusakan buku");
        }
        return `${fine.title}: ${reasons.length > 0 ? reasons.join(" + ") : "denda tercatat"}`;
      })
    );
    return { message: `Penyebab denda:\n\n${list}`, references: referencesFrom(fines) };
  }

  const wantsUnpaid = /\b(belum\s+dibayar|belum\s+lunas|sisa|tunggakan|outstanding)\b/.test(q);
  const wantsPaid = /\b(sudah\s+dibayar|sudah\s+bayar|terbayar|dibayar)\b/.test(q);
  const wantsStatus =
    /\b(apakah|masih\s+ada|punya\s+denda|ada\s+denda|status|lunas)\b/.test(q) &&
    !/\b(berapa|total|jumlah|banyak)\b/.test(q);
  const wantsListStatus = /\b(lunas|status\s+pembayaran)\b/.test(q) && /\b(status)\b/.test(q);

  if (wantsUnpaid) {
    return {
      message: `Total denda yang belum dibayar adalah ${formatRupiah(outstanding)}.`,
      references: referencesFrom(fines),
    };
  }

  if (wantsPaid && /\b(berapa|total|jumlah|banyak)\b/.test(q)) {
    return {
      message: `Total denda yang sudah dibayar adalah ${formatRupiah(paidAmount)}.`,
      references: referencesFrom(fines),
    };
  }

  // Status pembayaran rinci bila diminta eksplisit.
  if (/\b(status\s+pembayaran|status\s+denda|rincian\s+denda)\b/.test(q)) {
    const list = numbered(
      fines.map((fine) =>
        fine.status === "PAID"
          ? `${fine.title}: lunas`
          : `${fine.title}: ${
              fine.status === "PARTIAL" ? "dibayar sebagian" : "belum dibayar"
            } (sisa ${formatRupiah(fine.outstanding)})`
      )
    );
    return { message: `Status denda kamu:\n\n${list}`, references: referencesFrom(fines) };
  }

  if (wantsStatus || wantsListStatus) {
    if (outstanding <= 0) {
      return { message: "Semua denda kamu sudah lunas.", references: referencesFrom(fines) };
    }
    return {
      message: `Masih ada denda yang belum dibayar sebesar ${formatRupiah(outstanding)}.`,
      references: referencesFrom(fines),
    };
  }

  // Default: total denda yang pernah tercatat (termasuk yang sudah lunas).
  return {
    message: `Total denda yang pernah tercatat adalah ${formatRupiah(totalAmount)}.`,
    references: referencesFrom(fines),
  };
}

/** Satu transaksi milik pengguna sendiri pada satu rentang tanggal. */
export interface DatedOwnBorrowItem {
  bookId: string;
  title: string;
  author: string;
  /** "book" untuk buku fisik, "ebook" untuk EbookLoan. */
  kind: "book" | "ebook";
  /** Waktu mulai (borrowDate / borrowedAt). */
  at: Date;
  status: string;
  returnDate: Date | null;
}

/**
 * Jawaban deterministik untuk pertanyaan transaksi MILIK SENDIRI pada satu
 * rentang tanggal ("saya meminjam apa kemarin"). Semua judul/status/waktu HANYA
 * berasal dari argumen (hasil query yang sudah dibatasi ke `userId`), sehingga
 * model tidak mungkin mengarang transaksi bertanggal untuk pengguna.
 */
export function buildMyBorrowsByDateAnswer(
  label: string,
  items: DatedOwnBorrowItem[],
  countsOnly = false
): PersonalAnswer {
  if (items.length === 0) {
    return {
      message: `Kamu tidak memiliki transaksi peminjaman pada ${label} (waktu Asia/Jakarta).`,
      references: [],
    };
  }

  if (countsOnly) {
    const physical = items.filter((item) => item.kind === "book").length;
    const ebook = items.length - physical;
    return {
      message:
        `Total transaksi peminjamanmu pada ${label}: **${items.length}** transaksi ` +
        `(${physical} buku fisik + ${ebook} ebook).`,
      references: [],
    };
  }

  const sorted = [...items].sort((a, b) => a.at.getTime() - b.at.getTime());
  const list = bulleted(
    sorted.map((item) => {
      const kindLabel = item.kind === "ebook" ? " (ebook)" : "";
      const statusLabel =
        item.kind === "ebook"
          ? EBOOK_STATUS_LABEL[item.status] ?? item.status.toLowerCase()
          : STATUS_LABEL[item.status] ?? item.status.toLowerCase();
      const returned =
        item.status === "RETURNED" && item.returnDate
          ? ` — dikembalikan ${formatWibDateTime(item.returnDate)}`
          : "";
      return `${item.title}${kindLabel} — dipinjam ${formatWibDateTime(item.at)} (${statusLabel})${returned}`;
    })
  );

  const references: PersonalReference[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    if (seen.has(item.bookId)) continue;
    seen.add(item.bookId);
    references.push({ id: item.bookId, title: item.title, author: item.author });
  }

  return {
    message: `Transaksi peminjamanmu pada ${label}:\n\n${list}`,
    references,
  };
}

export function buildPersonalAnswerFromIntent(
  intent: PersonalIntent,
  query: string,
  data: {
    active?: PersonalBorrowItem[];
    activeEbooks?: PersonalEbookLoanItem[];
    pending?: PersonalBorrowItem[];
    history?: PersonalBorrowItem[];
    ebookHistory?: PersonalEbookLoanItem[];
    fines?: PersonalFineItem[];
  },
  now: Date = new Date()
): PersonalAnswer {
  switch (intent) {
    case "MY_LOANS":
      return buildLoansAnswer(
        query,
        data.active ?? [],
        data.pending ?? [],
        now,
        data.activeEbooks ?? []
      );
    case "MY_HISTORY":
      return buildHistoryAnswer(
        query,
        data.history ?? [],
        now,
        data.ebookHistory ?? [],
        data.activeEbooks ?? []
      );
    case "MY_FINES":
      return buildFinesAnswer(query, data.fines ?? []);
  }
}
