/**
 * Library Configuration – Centralized Business Rules
 *
 * All borrowing rules should be defined here.
 * Never hardcode these values in API routes or UI components.
 */

/**
 * Canonical borrow status values.
 * REQUESTED  – pengajuan online dari siswa/guru, belum diserahkan (tidak menahan stok).
 * BORROWED   – buku sudah diserahkan ke peminjam (menahan stok).
 * OVERDUE    – melewati jatuh tempo (tidak dianggap sudah dikembalikan).
 * RETURNED   – pengembalian dikonfirmasi pustakawan (stok kembali).
 * CANCELLED  – transaksi dibatalkan sebelum diserahkan.
 * REJECTED   – pengajuan ditolak pustakawan.
 */
export const BORROW_STATUS = {
  REQUESTED: "REQUESTED",
  BORROWED: "BORROWED",
  RETURNED: "RETURNED",
  OVERDUE: "OVERDUE",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
} as const;

export type BorrowStatus = (typeof BORROW_STATUS)[keyof typeof BORROW_STATUS];

/** Status buku yang benar-benar menahan satu eksemplar fisik. */
export const ACTIVE_BORROW_STATUSES: string[] = [
  BORROW_STATUS.BORROWED,
  BORROW_STATUS.OVERDUE,
];

/** Status yang mengikat peminjam (menahan kuota pinjam) termasuk pengajuan. */
export const OPEN_BORROW_STATUSES: string[] = [
  BORROW_STATUS.REQUESTED,
  BORROW_STATUS.BORROWED,
  BORROW_STATUS.OVERDUE,
];

export const LIBRARY_CONFIG = {
  /**
   * Maximum number of books a user can borrow simultaneously per role.
   */
  maxBorrowsPerRole: {
    STUDENT: 3,
    TEACHER: 5,
    STAFF: 5,
    LIBRARIAN: 5,
    ADMIN: 5,
  } as Record<string, number>,

  /**
   * Default borrow duration in days per role.
   */
  borrowDurationDays: {
    STUDENT: 7,
    TEACHER: 14,
    STAFF: 14,
    LIBRARIAN: 14,
    ADMIN: 14,
  } as Record<string, number>,

  /**
   * DEFAULT fine per day in IDR for overdue books.
   *
   * This is only the fallback used when the Admin has not yet stored a tariff
   * in the database (Setting "finePerDayIDR"). The effective tariff is read at
   * runtime via src/lib/config/settings.ts so Admin can change it without a
   * redeploy. Set to 0 to disable fines entirely.
   */
  finePerDayIDR: 1000,

  /**
   * Kategori kondisi buku saat dikembalikan. `key` disimpan pada
   * BorrowRecord.returnCondition; `defaultFineIDR` hanya nilai bawaan dan dapat
   * ditimpa Admin per kategori melalui tabel Setting (lihat settings.ts).
   * Denda kerusakan SELALU diambil dari tarif kategori ini — bukan teks bebas.
   */
  damageConditions: [
    { key: "GOOD", label: "Baik (tidak ada kerusakan)", defaultFineIDR: 0 },
    { key: "DIRTY", label: "Kotor / perlu dibersihkan", defaultFineIDR: 0 },
    { key: "LIGHT", label: "Kerusakan ringan", defaultFineIDR: 5000 },
    { key: "TORN_PAGE", label: "Halaman sobek", defaultFineIDR: 10000 },
    { key: "MISSING_PAGE", label: "Halaman hilang", defaultFineIDR: 20000 },
    { key: "COVER_DAMAGE", label: "Sampul rusak", defaultFineIDR: 15000 },
    { key: "SEVERE", label: "Kerusakan berat", defaultFineIDR: 50000 },
  ] as ReadonlyArray<{ key: string; label: string; defaultFineIDR: number }>,

  /**
   * Batas panjang alasan peminjaman yang ditulis peminjam (Siswa/Guru).
   * Dipakai bersama oleh validasi frontend dan backend.
   */
  borrowReasonMaxLength: 500,

  /**
   * Roles allowed to borrow books.
   */
  borrowerRoles: ["STUDENT", "TEACHER", "STAFF"] as string[],

  /**
   * Roles allowed to manage (create/process) borrow transactions.
   */
  librarianRoles: ["ADMIN", "LIBRARIAN"] as string[],
} as const;

/**
 * Calculate due date from borrow date based on user role.
 */
export function calculateDueDate(role: string, borrowDate: Date = new Date()): Date {
  const days = LIBRARY_CONFIG.borrowDurationDays[role] ?? 7;
  const due = new Date(borrowDate);
  due.setDate(due.getDate() + days);
  return due;
}

/**
 * Jumlah hari keterlambatan (dibulatkan ke atas per hari kalender).
 * Mengembalikan 0 bila belum melewati jatuh tempo.
 */
export function calculateLateDays(dueDate: Date, returnDate: Date = new Date()): number {
  if (returnDate <= dueDate) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((returnDate.getTime() - dueDate.getTime()) / msPerDay);
}

/**
 * Klasifikasi ketepatan waktu pengembalian berdasarkan TANGGAL, terpisah dari
 * status transaksi (RETURNED hanya berarti "sudah dikembalikan", bukan "tepat
 * waktu").
 */
export type ReturnTimeliness = "ONTIME" | "LATE" | "UNKNOWN";

/**
 * Tentukan tepat waktu / terlambat dari tanggal tenggat dan tanggal pengembalian
 * aktual (bukan status transaksi, bukan waktu notifikasi dikirim):
 *  - returnDate <= dueDate → "ONTIME" (termasuk tepat pada tanggal/tenggat);
 *  - returnDate >  dueDate → "LATE";
 *  - tanggal tidak tersedia / tidak valid → "UNKNOWN" (JANGAN menebak status).
 */
export function getReturnTimeliness(
  dueDate: Date | null | undefined,
  returnDate: Date | null | undefined
): ReturnTimeliness {
  if (!(dueDate instanceof Date) || !(returnDate instanceof Date)) return "UNKNOWN";
  const due = dueDate.getTime();
  const ret = returnDate.getTime();
  if (Number.isNaN(due) || Number.isNaN(ret)) return "UNKNOWN";
  return ret <= due ? "ONTIME" : "LATE";
}

/**
 * Rincian perhitungan denda: hari terlambat, tarif harian, dan total.
 * Dipakai agar UI/laporan dapat menampilkan rincian yang transparan.
 */
export function calculateFineBreakdown(
  dueDate: Date,
  returnDate: Date = new Date(),
  ratePerDay: number = LIBRARY_CONFIG.finePerDayIDR
): { daysLate: number; ratePerDay: number; amount: number } {
  const daysLate = calculateLateDays(dueDate, returnDate);
  return { daysLate, ratePerDay, amount: daysLate * ratePerDay };
}

/**
 * Calculate overdue fine for a borrow record.
 * `ratePerDay` harus diisi dengan tarif yang berlaku (lihat settings.ts) ketika
 * denda akan di-*snapshot*; nilai default hanya untuk fallback.
 */
export function calculateFine(
  dueDate: Date,
  returnDate: Date = new Date(),
  ratePerDay: number = LIBRARY_CONFIG.finePerDayIDR
): number {
  return calculateFineBreakdown(dueDate, returnDate, ratePerDay).amount;
}

/**
 * Determine the effective borrow status given the current date.
 */
export function getEffectiveStatus(status: string, dueDate: Date): string {
  if (status === "BORROWED" && new Date() > dueDate) {
    return "OVERDUE";
  }
  return status;
}

/** Kategori kondisi buku saat dikembalikan (lihat LIBRARY_CONFIG.damageConditions). */
export interface DamageCondition {
  key: string;
  label: string;
  defaultFineIDR: number;
}

/** Cari kategori kondisi berdasarkan kode. Null bila tidak dikenal. */
export function getDamageCondition(key: string | null | undefined): DamageCondition | null {
  if (!key) return null;
  return LIBRARY_CONFIG.damageConditions.find((c) => c.key === key) ?? null;
}

/** Apakah kode kondisi valid (terdaftar sebagai kategori resmi). */
export function isValidDamageCondition(key: unknown): key is string {
  return (
    typeof key === "string" &&
    LIBRARY_CONFIG.damageConditions.some((c) => c.key === key)
  );
}

/** Konsekuensi kondisi: item tidak utuh (kecuali GOOD) dan perlu tarif kerusakan. */
export function isDamageCondition(key: string | null | undefined): boolean {
  return Boolean(key) && key !== "GOOD";
}
