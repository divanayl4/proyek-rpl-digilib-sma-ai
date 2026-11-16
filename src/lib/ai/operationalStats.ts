/**
 * Statistik operasional DigiLib untuk AI Assistant.
 *
 * Sumber data DIPISAH menurut format transaksi:
 * - Buku fisik : `BorrowRecord`.
 * - Ebook      : `EbookLoan`.
 *
 * Definisi angka buku fisik SENGAJA disamakan dengan halaman laporan/dashboard
 * resmi (lihat `src/app/api/admin/reports/route.ts` dan `src/app/admin/page.tsx`):
 * - totalBorrows   : SEMUA record BorrowRecord (semua status). Bila periode
 *                    diberikan, difilter berdasarkan `borrowDate`. Berbeda dari
 *                    `catalog_stats.totalBorrows` yang hanya aktif + selesai;
 *                    jangan menyamakan kedua label.
 * - activeBorrows  : status BORROWED/OVERDUE saat ini (tanpa filter periode,
 *                    sama seperti kartu "Peminjaman Aktif" pada laporan).
 * - pendingRequests: status REQUESTED saat ini (tanpa filter periode).
 * - overdueBorrows : status OVERDUE ATAU BORROWED dengan dueDate < sekarang
 *                    (definisi yang sama dengan laporan).
 * - returns        : status RETURNED; bila periode diberikan difilter dengan
 *                    `returnDate` (tanggal kembali), bukan tanggal pinjam.
 * - fines          : denda dinilai (fineAmount pada record RETURNED) dikurangi
 *                    pembayaran (FinePayment) pada periode yang sama.
 *
 * Definisi angka ebook mengikuti `EbookLoan` aktual:
 * - totalLoans    : SEMUA record EbookLoan (ACTIVE/EXPIRED/RETURNED); bila
 *                   periode diberikan difilter berdasarkan `borrowedAt`.
 * - activeLoans   : `returnedAt = null` DAN `expiresAt > now` (masa akses aktif).
 * - expiredLoans  : `returnedAt = null` DAN `expiresAt <= now` (masa akses habis).
 * - returnedLoans : `returnedAt != null` (sudah dikembalikan).
 * - returns       : pengembalian ebook pada periode, difilter `returnedAt`.
 *
 * Ebook TIDAK memiliki status pengajuan, terlambat, ditolak, atau dibatalkan.
 * `EXPIRED` berarti masa akses habis, bukan keterlambatan pengembalian fisik.
 *
 * Semua query memakai count/aggregate terpisah (tanpa JOIN relasi) supaya satu
 * transaksi tidak pernah terhitung ganda. Batas periode memakai zona
 * Asia/Jakarta dan rentang `[start, end)` dari `datetime.ts`.
 */

import { prisma } from "@/lib/prisma";
import { normalizeQuery } from "./intent";
import {
  hasEbookFormatCue,
  hasPhysicalFormatCue,
  normalizeCatalogFormat,
  type CatalogFormatScope,
} from "./catalogFormat";
import {
  JAKARTA_TIME_ZONE,
  jakartaMonthRange,
  resolveJakartaDateRange,
  resolveJakartaPeriod,
} from "./datetime";

export type OperationalMetric =
  | "BORROWS"
  | "ACTIVE"
  | "OVERDUE"
  | "RETURNS"
  | "PENDING"
  | "FINES"
  | "EBOOKS"
  | "EXPIRED"
  | "REJECTED"
  | "CANCELLED";

/** Cakupan statistik transaksi. Default produk: PHYSICAL (buku fisik). */
export type TransactionFormat = CatalogFormatScope;

export interface StatsPeriod {
  start: Date;
  end: Date;
  key: string;
  label: string;
  granularity: "day" | "month" | "year";
}

/**
 * Rentang periode yang diminta pengguna: satu hari, satu bulan, atau satu
 * tahun. `null` berarti seluruh waktu (tidak ada batas periode).
 *
 * Satu tanggal lengkap diprioritaskan agar "transaksi 18 Oktober 2026" tidak
 * dianggap "bulan Oktober 2026".
 */
export function resolveStatsPeriod(
  query: string,
  now: Date = new Date()
): StatsPeriod | null {
  const day = resolveJakartaDateRange(query, now);
  if (day) {
    return {
      start: day.start,
      end: day.end,
      key: day.key,
      label: day.label,
      granularity: "day",
    };
  }

  const period = resolveJakartaPeriod(query, now);
  if (period) {
    return {
      start: period.start,
      end: period.end,
      key: period.key,
      label: period.label,
      granularity: period.granularity,
    };
  }

  return null;
}

/**
 * Tentukan cakupan format transaksi secara deterministik.
 *
 * Urutan penting:
 * 1. Penanda ebook dan buku fisik sekaligus → ALL.
 * 2. Hanya ebook (termasuk "semua transaksi ebook") → EBOOK.
 * 3. Hanya buku fisik/perpustakaan → PHYSICAL.
 * 4. Tanpa penanda format, "semua/seluruh transaksi|peminjaman" → ALL.
 * 5. Selain itu argumen `explicit` dari tool, lalu default PHYSICAL.
 *
 * Penanda format pada pertanyaan selalu mengalahkan argumen model supaya
 * pertanyaan ebook tidak bisa dibelokkan menjadi gabungan.
 */
export function resolveTransactionFormat(
  query: string,
  explicit?: unknown
): TransactionFormat {
  const q = normalizeQuery(query ?? "");
  const ebook = hasEbookFormatCue(q);
  const physicalCue = hasPhysicalFormatCue(q);
  const explicitFormat = normalizeCatalogFormat(explicit);

  // 1. Penanda ebook dan buku fisik sekaligus → ALL.
  if (ebook && (physicalCue || /\bbuku\b/.test(q))) {
    return "ALL";
  }

  // 2. Hanya ebook (dan bukan gabungan/keseluruhan) → EBOOK.
  if (
    ebook &&
    !/\b(?:fisik\s+dan\s+ebook|ebook\s+dan\s+fisik|keseluruhan|global)\b/.test(q)
  ) {
    return "EBOOK";
  }

  // 3. Jika ada argumen format eksplisit dari tool dan pertanyaan tidak memuat
  // kata kunci cakupan keseluruhan, ikuti format eksplisit tool.
  if (
    explicitFormat &&
    !(hasEbookFormatCue(q) || hasPhysicalFormatCue(q)) &&
    !/\b(?:keseluruhan|global|perpustakaan|fisik\s+dan\s+ebook|ebook\s+dan\s+fisik)\b/.test(q)
  ) {
    return explicitFormat;
  }

  // 4. Penanda eksplisit cakupan keseluruhan / perpustakaan / semua transaksi:
  // - "Berapa total transaksi keseluruhan?"
  // - "Berapa total transaksi perpustakaan?"
  // - "Berapa jumlah semua transaksi?"
  // - "Berapa total transaksi fisik dan ebook?"
  // - "Berapa total transaksi?"
  const isOverallCue =
    /\bkeseluruhan\b/.test(q) ||
    /\bglobal\b/.test(q) ||
    /\b(?:fisik\s+dan\s+ebook|ebook\s+dan\s+fisik)\b/.test(q) ||
    /\b(?:semua|seluruh)\s+(?:transaksi|peminjaman|pinjaman)\b/.test(q) ||
    /\bjumlah\s+semua\s+transaksi\b/.test(q) ||
    /\b(?:total|jumlah)\s+transaksi\s+(?:di\s+)?perpustakaan\b/.test(q) ||
    /\btransaksi\s+(?:di\s+)?perpustakaan\b/.test(q) ||
    (/\b(?:total|jumlah)\s+transaksi\b/.test(q) && !physicalCue);

  if (isOverallCue && !physicalCue) {
    return "ALL";
  }
  if (isOverallCue && /\bkeseluruhan\b/.test(q)) {
    return "ALL";
  }

  // 5. Penanda eksplisit buku fisik/cetak ("buku fisik", "buku cetak", dsb.)
  if (physicalCue) {
    return "PHYSICAL";
  }

  // 6. Jika menyebut "buku" tanpa penanda keseluruhan, default ke PHYSICAL
  if (/\bbuku\b/.test(q)) {
    return "PHYSICAL";
  }

  // 7. Jika menanyakan transaksi secara umum tanpa format spesifik ("berapa total transaksi"), default ke ALL
  if (/\btransaksi\b/.test(q)) {
    return "ALL";
  }

  return explicitFormat ?? "PHYSICAL";
}

/** Apakah pertanyaan menyebut metrik tertentu (bukan sekadar katalog). */
export function detectRequestedMetrics(query: string): OperationalMetric[] {
  const q = ` ${normalizeQuery(query)} `;
  const metrics = new Set<OperationalMetric>();

  if (/\bebook\b/.test(q)) metrics.add("EBOOKS");
  if (/\b(denda\w*|tagihan\w*|fine\w*)\b/.test(q)) metrics.add("FINES");
  if (/\b(pengembalian|dikembalikan|mengembalikan|kembali|balikin)\b/.test(q)) {
    metrics.add("RETURNS");
  }
  if (/\b(pengajuan|permintaan|menunggu|pending|requested)\b/.test(q)) {
    metrics.add("PENDING");
  }
  if (/\b(terlambat|terlambatnya|keterlambatan|overdue|melewati\s+batas)\b/.test(q)) {
    metrics.add("OVERDUE");
  }
  if (/\b(kedaluwarsa|kadaluarsa|expired|masa\s+akses\s+habis)\b/.test(q)) {
    metrics.add("EXPIRED");
  }
  if (/\b(ditolak|reject\w*)\b/.test(q)) {
    metrics.add("REJECTED");
  }
  if (/\b(dibatalkan|dibatal|cancel\w*)\b/.test(q)) {
    metrics.add("CANCELLED");
  }
  if (
    /\b(aktif|sedang\s+dipinjam|masih\s+dipinjam|berjalan|berlangsung|belum\s+dikembalikan)\b/.test(q) &&
    /\b(transaksi|peminjaman|pinjaman|pinjam|dipinjam|buku|ebook)\b/.test(q)
  ) {
    metrics.add("ACTIVE");
  }
  if (/\b(transaksi|peminjaman|pinjaman|peminjam|dipinjam|meminjam)\b/.test(q)) {
    metrics.add("BORROWS");
  }

  // "statistik/rekap/ringkasan" tanpa metrik spesifik → ringkasan operasional.
  if (
    metrics.size === 0 &&
    /\b(statistik|rekap|ringkasan|angka|summary)\b/.test(q) &&
    !/\b(buku|katalog|koleksi|judul|eksemplar)\b/.test(q)
  ) {
    return ["BORROWS", "ACTIVE", "PENDING", "OVERDUE", "RETURNS", "FINES"];
  }

  return Array.from(metrics);
}

export interface OperationalFineStats {
  /** Jumlah record denda (fineAmount > 0) pada periode. */
  records: number;
  /** Total denda yang dinilai (snapshot saat pengembalian). */
  assessed: number;
  /** Total pembayaran denda yang tercatat pada periode. */
  collected: number;
  /** Sisa denda (assessed − collected), tidak pernah negatif. */
  outstanding: number;
}

export interface OperationalPhysicalStats {
  totalBorrows: number;
  statusCounts: Record<string, number>;
  activeBorrows: number;
  pendingRequests: number;
  overdueBorrows: number;
  returns: number;
  rejectedBorrows: number;
  cancelledBorrows: number;
  fines: OperationalFineStats;
}

export interface OperationalEbookStatusCounts {
  ACTIVE: number;
  EXPIRED: number;
  RETURNED: number;
}

export interface OperationalEbookStats {
  /** Semua record EbookLoan pada periode tanggal pinjam. */
  totalLoans: number;
  /** Rincian status untuk loan yang tanggal pinjamnya masuk periode. */
  statusCounts: OperationalEbookStatusCounts;
  /** Peminjaman dengan masa akses aktif saat ini (tanpa filter periode). */
  activeLoans: number;
  /** Peminjaman yang masa aksesnya sudah habis saat ini. */
  expiredLoans: number;
  /** Pengembalian ebook pada periode (berdasarkan `returnedAt`). */
  returns: number;
}

export interface OperationalStats {
  period: StatsPeriod | null;
  format: TransactionFormat;
  /** Null bila cakupan EBOOK (buku fisik tidak boleh dihitung). */
  physical: OperationalPhysicalStats | null;
  /** Null bila cakupan PHYSICAL (ebook tidak boleh dihitung). */
  ebook: OperationalEbookStats | null;

  // Field lama dipertahankan untuk kompatibilitas konsumen. Nilainya adalah
  // angka buku fisik (atau 0 bila format EBOOK); JANGAN dipakai sebagai total
  // gabungan. `ebookLoans` hanya angka ebook.
  totalBorrows: number;
  statusCounts: Record<string, number>;
  activeBorrows: number;
  pendingRequests: number;
  overdueBorrows: number;
  returns: number;
  ebookLoans: number;
  fines: OperationalFineStats;
}

const ACTIVE_STATUSES = ["BORROWED", "OVERDUE"] as const;
const BORROW_STATUSES = [
  "REQUESTED",
  "BORROWED",
  "OVERDUE",
  "RETURNED",
  "CANCELLED",
  "REJECTED",
] as const;

function borrowDateFilter(period: StatsPeriod | null) {
  return period ? { borrowDate: { gte: period.start, lt: period.end } } : {};
}

function returnDateFilter(period: StatsPeriod | null) {
  return period ? { returnDate: { gte: period.start, lt: period.end } } : {};
}

function paymentDateFilter(period: StatsPeriod | null) {
  return period ? { createdAt: { gte: period.start, lt: period.end } } : {};
}

function emptyFines(): OperationalFineStats {
  return { records: 0, assessed: 0, collected: 0, outstanding: 0 };
}

function emptyPhysicalStats(): OperationalPhysicalStats {
  return {
    totalBorrows: 0,
    statusCounts: {},
    activeBorrows: 0,
    pendingRequests: 0,
    overdueBorrows: 0,
    returns: 0,
    rejectedBorrows: 0,
    cancelledBorrows: 0,
    fines: emptyFines(),
  };
}

function emptyEbookStats(): OperationalEbookStats {
  return {
    totalLoans: 0,
    statusCounts: { ACTIVE: 0, EXPIRED: 0, RETURNED: 0 },
    activeLoans: 0,
    expiredLoans: 0,
    returns: 0,
  };
}

async function getPhysicalStats(
  period: StatsPeriod | null,
  now: Date
): Promise<OperationalPhysicalStats> {
  const borrowWhere = borrowDateFilter(period);
  const returnedWhere = { status: "RETURNED", ...returnDateFilter(period) };

  const [
    totalBorrows,
    statusGroups,
    activeBorrows,
    pendingRequests,
    overdueBorrows,
    returns,
    fineAssessedAgg,
    fineCollectedAgg,
    fineRecords,
  ] = await Promise.all([
    prisma.borrowRecord.count({ where: borrowWhere }),
    // groupBy hanya untuk rincian status; kegagalan di sini tidak boleh
    // menggagalkan angka utama.
    (async () => {
      try {
        const groups = await prisma.borrowRecord.groupBy({
          by: ["status"],
          where: borrowWhere,
          _count: { _all: true },
        });
        const counts: Record<string, number> = {};
        for (const group of groups as Array<{
          status: string;
          _count?: { _all?: number };
        }>) {
          const value = group._count?._all;
          if (typeof value === "number" && value >= 0) {
            counts[group.status] = value;
          }
        }
        return counts;
      } catch {
        return {} as Record<string, number>;
      }
    })(),
    prisma.borrowRecord.count({ where: { status: { in: [...ACTIVE_STATUSES] } } }),
    prisma.borrowRecord.count({ where: { status: "REQUESTED" } }),
    prisma.borrowRecord.count({
      where: {
        OR: [
          { status: "OVERDUE" },
          { status: "BORROWED", dueDate: { lt: now } },
        ],
      },
    }),
    prisma.borrowRecord.count({ where: returnedWhere }),
    prisma.borrowRecord.aggregate({
      where: returnedWhere,
      _sum: { fineAmount: true },
    }),
    prisma.finePayment.aggregate({
      where: paymentDateFilter(period),
      _sum: { amount: true },
    }),
    prisma.borrowRecord.count({
      where: { status: "RETURNED", fineAmount: { gt: 0 }, ...returnDateFilter(period) },
    }),
  ]);

  const statusCounts: Record<string, number> = { ...statusGroups };
  for (const status of BORROW_STATUSES) {
    if (typeof statusCounts[status] !== "number") {
      // Jangan mengarang angka: status yang tidak muncul berarti 0 pada
      // groupBy, tetapi hanya bila groupBy berhasil (setidaknya ada satu grup).
      statusCounts[status] = statusCounts[status] ?? 0;
    }
  }

  const assessed = fineAssessedAgg?._sum?.fineAmount ?? 0;
  const collected = fineCollectedAgg?._sum?.amount ?? 0;

  return {
    totalBorrows,
    statusCounts,
    activeBorrows,
    pendingRequests,
    overdueBorrows,
    returns,
    rejectedBorrows: statusCounts.REJECTED ?? 0,
    cancelledBorrows: statusCounts.CANCELLED ?? 0,
    fines: {
      records: fineRecords,
      assessed,
      collected,
      outstanding: Math.max(0, assessed - collected),
    },
  };
}

/**
 * `prisma.ebookLoan.count` tidak selalu tersedia pada mock lama. Bila tidak
 * ada, kembalikan 0 — bukan menyalin angka buku fisik.
 */
async function countEbookRows(where: Record<string, unknown>): Promise<number> {
  const client = prisma.ebookLoan as unknown as {
    count?: (args: { where: Record<string, unknown> }) => Promise<number>;
  };
  if (typeof client.count !== "function") return 0;
  return client.count({ where });
}

async function getEbookStats(
  period: StatsPeriod | null,
  now: Date
): Promise<OperationalEbookStats> {
  // EbookLoan memakai `borrowedAt`/`returnedAt`, BUKAN `borrowDate`/
  // `returnDate` milik BorrowRecord.
  const borrowedWhere = period
    ? { borrowedAt: { gte: period.start, lt: period.end } }
    : {};
  const returnedWhere = period
    ? { returnedAt: { gte: period.start, lt: period.end } }
    : { returnedAt: { not: null } };

  const [
    totalLoans,
    returns,
    activeLoans,
    expiredLoans,
    periodActive,
    periodExpired,
    periodReturned,
  ] = await Promise.all([
    countEbookRows(borrowedWhere),
    countEbookRows(returnedWhere),
    countEbookRows({ returnedAt: null, expiresAt: { gt: now } }),
    countEbookRows({ returnedAt: null, expiresAt: { lte: now } }),
    countEbookRows({ ...borrowedWhere, returnedAt: null, expiresAt: { gt: now } }),
    countEbookRows({ ...borrowedWhere, returnedAt: null, expiresAt: { lte: now } }),
    countEbookRows({ ...borrowedWhere, returnedAt: { not: null } }),
  ]);

  return {
    totalLoans,
    statusCounts: {
      ACTIVE: periodActive,
      EXPIRED: periodExpired,
      RETURNED: periodReturned,
    },
    activeLoans,
    expiredLoans,
    returns,
  };
}

/**
 * Ambil statistik operasional dari database aktual sesuai cakupan format.
 * Nilai yang gagal dihitung tetap dilempar ke pemanggil agar pesan "data belum
 * dapat diakses" dipakai — bukan diam-diam menjadi 0.
 *
 * `format` default ALL hanya untuk kompatibilitas fungsi internal. Pipeline dan
 * tool selalu mengirim cakupan eksplisit (default produk: PHYSICAL).
 */
export async function getOperationalStats(
  period: StatsPeriod | null,
  now: Date = new Date(),
  format: TransactionFormat = "ALL"
): Promise<OperationalStats> {
  const [physical, ebook] = await Promise.all([
    format === "EBOOK" ? Promise.resolve(null) : getPhysicalStats(period, now),
    format === "PHYSICAL" ? Promise.resolve(null) : getEbookStats(period, now),
  ]);

  const physicalAlias = physical ?? emptyPhysicalStats();
  const ebookAlias = ebook ?? emptyEbookStats();

  return {
    period,
    format,
    physical,
    ebook,
    totalBorrows: physicalAlias.totalBorrows,
    statusCounts: physicalAlias.statusCounts,
    activeBorrows: physicalAlias.activeBorrows,
    pendingRequests: physicalAlias.pendingRequests,
    overdueBorrows: physicalAlias.overdueBorrows,
    returns: physicalAlias.returns,
    ebookLoans: ebookAlias.totalLoans,
    fines: physicalAlias.fines,
  };
}

/** Ubah input tool (`month`, `YYYY-MM`, `today`, dst.) menjadi periode stats. */
export function resolveStatsPeriodInput(
  input: string,
  now: Date = new Date()
): StatsPeriod | null {
  const value = input.trim();
  if (!value) return null;

  const lower = value.toLowerCase();
  if (lower === "this_month" || lower === "bulan_ini") {
    return resolveStatsPeriod("bulan ini", now);
  }
  if (lower === "last_month" || lower === "bulan_lalu") {
    return resolveStatsPeriod("bulan lalu", now);
  }
  if (lower === "this_year" || lower === "tahun_ini") {
    return resolveStatsPeriod("tahun ini", now);
  }
  if (lower === "last_year" || lower === "tahun_lalu") {
    return resolveStatsPeriod("tahun lalu", now);
  }
  if (lower === "today" || lower === "hari ini") {
    return resolveStatsPeriod("hari ini", now);
  }
  if (lower === "yesterday" || lower === "kemarin") {
    return resolveStatsPeriod("kemarin", now);
  }

  // "2026" (tahun eksplisit).
  if (/^\d{4}$/.test(value)) {
    return resolveStatsPeriod(`tahun ${value}`, now);
  }

  // "2026-10" (bulan eksplisit) — bukan tanggal ISO.
  const monthKey = /^(\d{4})-(\d{2})$/.exec(value);
  if (monthKey) {
    const year = Number(monthKey[1]);
    const month = Number(monthKey[2]);
    if (month >= 1 && month <= 12) {
      const { start, end } = jakartaMonthRange(year, month);
      const label = new Intl.DateTimeFormat("id-ID", {
        month: "long",
        year: "numeric",
        timeZone: JAKARTA_TIME_ZONE,
      }).format(start);
      return {
        start,
        end,
        key: `${year}-${String(month).padStart(2, "0")}`,
        label,
        granularity: "month",
      };
    }
  }

  return resolveStatsPeriod(value, now);
}
