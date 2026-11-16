import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ACTIVE_BORROW_STATUSES,
  BORROW_STATUS,
} from "@/lib/config/library";

/**
 * Definisi tunggal metrik transaksi untuk Dasbor Administrator dan halaman
 * Transaksi.
 *
 * Aturan sumber data:
 * - Buku fisik: hanya BorrowRecord.
 * - Ebook: hanya EbookLoan.
 * - total = physicalTotal + ebookTotal. Kedua tabel terpisah, sehingga tidak
 *   ada transaksi yang dihitung dua kali.
 * - Judul buku (Book) tidak pernah dipakai sebagai jumlah transaksi.
 *
 * Status buku fisik tetap memakai status kanonik proyek. Ebook tidak memakai
 * status keterlambatan buku fisik; statusnya diturunkan dari returnedAt dan
 * expiresAt, sama seperti getEbookAccessState.
 */
export interface TransactionStats {
  total: number;
  physicalTotal: number;
  physicalRequested: number;
  /** Peminjaman fisik aktif yang belum terlambat. */
  physicalBorrowedOnTime: number;
  /** Seluruh peminjaman fisik aktif, termasuk yang sudah terlambat. */
  physicalActive: number;
  physicalOverdue: number;
  physicalReturned: number;
  physicalCancelled: number;
  physicalRejected: number;
  ebookTotal: number;
  ebookActive: number;
  ebookReturned: number;
  ebookExpired: number;
}

export interface TransactionStatsOptions {
  physicalWhere?: Prisma.BorrowRecordWhereInput;
  ebookWhere?: Prisma.EbookLoanWhereInput;
  includePhysical?: boolean;
  includeEbook?: boolean;
  now?: Date;
}

type PhysicalStats = Pick<
  TransactionStats,
  | "physicalTotal"
  | "physicalRequested"
  | "physicalBorrowedOnTime"
  | "physicalActive"
  | "physicalOverdue"
  | "physicalReturned"
  | "physicalCancelled"
  | "physicalRejected"
>;

type EbookStats = Pick<
  TransactionStats,
  "ebookTotal" | "ebookActive" | "ebookReturned" | "ebookExpired"
>;

const EMPTY_PHYSICAL: PhysicalStats = {
  physicalTotal: 0,
  physicalRequested: 0,
  physicalBorrowedOnTime: 0,
  physicalActive: 0,
  physicalOverdue: 0,
  physicalReturned: 0,
  physicalCancelled: 0,
  physicalRejected: 0,
};

const EMPTY_EBOOK: EbookStats = {
  ebookTotal: 0,
  ebookActive: 0,
  ebookReturned: 0,
  ebookExpired: 0,
};

async function getPhysicalStats(
  where: Prisma.BorrowRecordWhereInput,
  now: Date
): Promise<PhysicalStats> {
  const [total, statusGroups, overdue] = await Promise.all([
    prisma.borrowRecord.count({ where }),
    prisma.borrowRecord.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.borrowRecord.count({
      // AND mencegah filter status pemanggil tertimpa oleh filter overdue.
      where: {
        AND: [
          where,
          {
            status: { in: ACTIVE_BORROW_STATUSES },
            dueDate: { lt: now },
          },
        ],
      },
    }),
  ]);

  const countByStatus = (status: string) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;

  const active =
    countByStatus(BORROW_STATUS.BORROWED) +
    countByStatus(BORROW_STATUS.OVERDUE);

  return {
    physicalTotal: total,
    physicalRequested: countByStatus(BORROW_STATUS.REQUESTED),
    physicalBorrowedOnTime: Math.max(0, active - overdue),
    physicalActive: active,
    physicalOverdue: overdue,
    physicalReturned: countByStatus(BORROW_STATUS.RETURNED),
    physicalCancelled: countByStatus(BORROW_STATUS.CANCELLED),
    physicalRejected: countByStatus(BORROW_STATUS.REJECTED),
  };
}

async function getEbookStats(
  where: Prisma.EbookLoanWhereInput,
  now: Date
): Promise<EbookStats> {
  const [total, active, expired, returned] = await Promise.all([
    prisma.ebookLoan.count({ where }),
    prisma.ebookLoan.count({
      // AND menjaga filter status/tanggal dari pemanggil tetap berlaku.
      where: {
        AND: [where, { returnedAt: null, expiresAt: { gt: now } }],
      },
    }),
    prisma.ebookLoan.count({
      where: {
        AND: [where, { returnedAt: null, expiresAt: { lte: now } }],
      },
    }),
    prisma.ebookLoan.count({
      where: {
        AND: [where, { returnedAt: { not: null } }],
      },
    }),
  ]);

  return {
    ebookTotal: total,
    ebookActive: active,
    ebookExpired: expired,
    ebookReturned: returned,
  };
}

export async function getTransactionStats(
  options: TransactionStatsOptions = {}
): Promise<TransactionStats> {
  const now = options.now ?? new Date();
  const includePhysical = options.includePhysical !== false;
  const includeEbook = options.includeEbook !== false;

  const [physical, ebook] = await Promise.all([
    includePhysical
      ? getPhysicalStats(options.physicalWhere ?? {}, now)
      : Promise.resolve(EMPTY_PHYSICAL),
    includeEbook
      ? getEbookStats(options.ebookWhere ?? {}, now)
      : Promise.resolve(EMPTY_EBOOK),
  ]);

  return {
    ...physical,
    ...ebook,
    total: physical.physicalTotal + ebook.ebookTotal,
  };
}

export interface UserActiveLoanStats {
  physicalActive: number;
  ebookActive: number;
}

export interface UserHistoryTotals {
  /** Seluruh baris BorrowRecord milik pengguna (semua status). */
  physicalTotal: number;
  /** Seluruh baris EbookLoan milik pengguna (aktif, selesai, kedaluwarsa). */
  ebookTotal: number;
  /** physicalTotal + ebookTotal. Dua tabel terpisah, tidak ada hitung ganda. */
  total: number;
}

/**
 * Total riwayat transaksi milik satu pengguna.
 *
 * Mengikuti definisi yang sama dengan `getTransactionStats`: buku fisik hanya
 * dari BorrowRecord, ebook hanya dari EbookLoan, dan total adalah penjumlahan
 * keduanya. Kedua tabel terpisah sehingga satu transaksi tidak pernah dihitung
 * dua kali. Tidak ada parameter pengguna lain; pemanggil wajib mengirim id dari
 * sesi yang sudah divalidasi.
 */
export async function getUserHistoryTotals(userId: string): Promise<UserHistoryTotals> {
  if (!userId) {
    return { physicalTotal: 0, ebookTotal: 0, total: 0 };
  }

  const [physicalTotal, ebookTotal] = await Promise.all([
    prisma.borrowRecord.count({ where: { userId } }),
    prisma.ebookLoan.count({ where: { userId } }),
  ]);

  return {
    physicalTotal,
    ebookTotal,
    total: physicalTotal + ebookTotal,
  };
}

/**
 * Menghitung peminjaman aktif khusus milik pengguna tertentu (Siswa, Guru, Pustakawan).
 * - Buku fisik: BorrowRecord dengan status BORROWED atau OVERDUE (ACTIVE_BORROW_STATUSES).
 * - Ebook: EbookLoan dengan returnedAt = null dan expiresAt > now (masa akses aktif).
 */
export async function getUserActiveLoans(
  userId: string,
  now: Date = new Date()
): Promise<UserActiveLoanStats> {
  if (!userId) {
    return { physicalActive: 0, ebookActive: 0 };
  }

  const [physicalActive, ebookActive] = await Promise.all([
    prisma.borrowRecord.count({
      where: {
        userId,
        status: { in: ACTIVE_BORROW_STATUSES },
      },
    }),
    prisma.ebookLoan.count({
      where: {
        userId,
        returnedAt: null,
        expiresAt: { gt: now },
      },
    }),
  ]);

  return { physicalActive, ebookActive };
}
