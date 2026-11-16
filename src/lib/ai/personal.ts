/**
 * Akses data pribadi untuk AI Chat Assistant.
 *
 * Semua query di file ini WAJIB memakai `userId` dari `session.user.id` (diisi
 * route) sehingga Siswa/Guru hanya pernah melihat transaksi dan denda miliknya
 * sendiri. Tidak ada parameter userId dari payload pengguna, tidak ada SQL bebas,
 * dan setiap query dibatasi jumlah barisnya.
 */

import { prisma } from "@/lib/prisma";
import {
  ACTIVE_BORROW_STATUSES,
  BORROW_STATUS,
  calculateLateDays,
  getDamageCondition,
} from "@/lib/config/library";
import {
  DatedOwnBorrowItem,
  PersonalAnswer,
  PersonalBorrowItem,
  PersonalEbookLoanItem,
  PersonalFineItem,
  PersonalIntent,
  buildPersonalAnswerFromIntent,
  resolvePersonalLoanScope,
} from "./personalAnswer";

/** Batas baris agar jawaban dan query tetap ringan. */
const HISTORY_LIMIT = 100;

const borrowSelect = {
  id: true,
  bookId: true,
  status: true,
  borrowDate: true,
  dueDate: true,
  returnDate: true,
  book: { select: { title: true, author: true } },
} as const;

type BorrowRow = {
  id: string;
  bookId: string;
  status: string;
  borrowDate: Date;
  dueDate: Date;
  returnDate: Date | null;
  book: { title: string; author: string };
};

function toBorrowItem(row: BorrowRow, now: Date): PersonalBorrowItem {
  const referenceDate = row.returnDate ?? now;
  const overdue =
    row.status === BORROW_STATUS.OVERDUE ||
    (!row.returnDate && row.dueDate.getTime() < now.getTime());
  return {
    id: row.id,
    bookId: row.bookId,
    title: row.book.title,
    author: row.book.author,
    status: row.status,
    borrowDate: row.borrowDate,
    dueDate: row.dueDate,
    returnDate: row.returnDate,
    daysLate: calculateLateDays(row.dueDate, referenceDate),
    overdue,
  };
}

/** Buku yang benar-benar sudah diserahkan dan belum dikembalikan. */
export async function getActiveLoans(userId: string): Promise<PersonalBorrowItem[]> {
  const rows = await prisma.borrowRecord.findMany({
    where: { userId, status: { in: ACTIVE_BORROW_STATUSES } },
    select: borrowSelect,
    orderBy: { dueDate: "asc" },
  });
  const now = new Date();
  return rows.map((row) => toBorrowItem(row, now));
}

/** Pengajuan online yang belum disetujui — bukan peminjaman aktif. */
export async function getPendingRequests(userId: string): Promise<PersonalBorrowItem[]> {
  const rows = await prisma.borrowRecord.findMany({
    where: { userId, status: "REQUESTED" },
    select: borrowSelect,
    orderBy: { requestedAt: "asc" },
  });
  const now = new Date();
  return rows.map((row) => toBorrowItem(row, now));
}

/**
 * Riwayat peminjaman: transaksi yang benar-benar terjadi (aktif maupun sudah
 * dikembalikan). Pengajuan yang dibatalkan/ditolak dan yang masih menunggu
 * tidak dihitung sebagai peminjaman.
 */
export async function getBorrowHistory(userId: string): Promise<PersonalBorrowItem[]> {
  const rows = await prisma.borrowRecord.findMany({
    where: {
      userId,
      status: { in: ["BORROWED", "OVERDUE", "RETURNED"] },
    },
    select: borrowSelect,
    orderBy: { borrowDate: "desc" },
    take: 100,
  });
  const now = new Date();
  return rows.map((row) => toBorrowItem(row, now));
}

/** Status transaksi yang dihitung sebagai peminjaman nyata (bukan pengajuan). */
const REAL_BORROW_STATUSES = ["BORROWED", "OVERDUE", "RETURNED"] as const;

/**
 * Transaksi (buku fisik + ebook) MILIK PENGGUNA SENDIRI pada rentang satu hari
 * `[start, end)` menurut zona Asia/Jakarta.
 *
 * Dipakai pipeline untuk menjawab pertanyaan bertanggal tentang peminjaman
 * sendiri secara deterministik dari database — sehingga model tidak pernah
 * mengarang transaksi bertanggal untuk pengguna (mis. mengaitkan transaksi 18
 * Oktober ke "kemarin" 17 Oktober). Query WAJIB memakai `userId` dari sesi dan
 * TIDAK menerima parameter userId dari payload.
 */
export async function getMyBorrowsByDate(
  userId: string,
  start: Date,
  end: Date
): Promise<DatedOwnBorrowItem[]> {
  const now = new Date();
  const [borrows, ebookLoans] = await Promise.all([
    prisma.borrowRecord.findMany({
      where: {
        userId,
        status: { in: [...REAL_BORROW_STATUSES] },
        borrowDate: { gte: start, lt: end },
      },
      select: borrowSelect,
      orderBy: { borrowDate: "asc" },
      take: HISTORY_LIMIT,
    }),
    prisma.ebookLoan.findMany({
      where: { userId, borrowedAt: { gte: start, lt: end } },
      select: ebookLoanSelect,
      orderBy: { borrowedAt: "asc" },
      take: HISTORY_LIMIT,
    }),
  ]);

  const items: DatedOwnBorrowItem[] = [];
  for (const row of borrows) {
    items.push({
      bookId: row.bookId,
      title: row.book.title,
      author: row.book.author,
      kind: "book",
      at: row.borrowDate,
      status: row.status,
      returnDate: row.returnDate,
    });
  }
  for (const row of ebookLoans) {
    // Status ebook diturunkan dari timestamp (sumber kebenaran yang sama dengan
    // getEbookAccessState), bukan dari kolom status yang di-update lazy.
    const returned = row.returnedAt !== null;
    const active = !returned && row.expiresAt.getTime() > now.getTime();
    items.push({
      bookId: row.bookId,
      title: row.book.title,
      author: row.book.author,
      kind: "ebook",
      at: row.borrowedAt,
      status: active ? "ACTIVE" : returned ? "RETURNED" : "EXPIRED",
      returnDate: row.returnedAt,
    });
  }
  return items;
}

type FineRow = {
  id: string;
  bookId: string;
  fineAmount: number;
  lateFineAmount: number;
  damageFineAmount: number;
  returnCondition: string | null;
  dueDate: Date;
  returnDate: Date | null;
  book: { title: string; author: string };
  finePayments: { amount: number }[];
};

function toFineItem(row: FineRow): PersonalFineItem {
  const paid = row.finePayments.reduce((sum, payment) => sum + payment.amount, 0);
  const outstanding = Math.max(0, row.fineAmount - paid);
  const status: PersonalFineItem["status"] =
    paid <= 0 ? "UNPAID" : outstanding <= 0 ? "PAID" : "PARTIAL";
  const condition = getDamageCondition(row.returnCondition);

  return {
    id: row.id,
    bookId: row.bookId,
    title: row.book.title,
    author: row.book.author,
    amount: row.fineAmount,
    lateAmount: row.lateFineAmount,
    damageAmount: row.damageFineAmount,
    conditionLabel: condition ? condition.label : null,
    daysLate: row.returnDate ? calculateLateDays(row.dueDate, row.returnDate) : 0,
    paid,
    outstanding,
    status,
  };
}

const ebookLoanSelect = {
  id: true,
  bookId: true,
  status: true,
  borrowedAt: true,
  expiresAt: true,
  returnedAt: true,
  book: { select: { title: true, author: true } },
} as const;

type EbookLoanRow = {
  id: string;
  bookId: string;
  status: string;
  borrowedAt: Date;
  expiresAt: Date;
  returnedAt: Date | null;
  book: { title: string; author: string };
};

const EBOOK_MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Status ebook diturunkan dari timestamp (sumber kebenaran yang sama dengan
 * getEbookAccessState di halaman baca), BUKAN dari kolom `status` yang baru
 * diperbarui secara lazy saat halaman dibuka. Loan yang kolomnya masih ACTIVE
 * tapi expiresAt sudah lewat dianggap EXPIRED, bukan aktif.
 */
function toEbookLoanItem(row: EbookLoanRow, now: Date): PersonalEbookLoanItem {
  const returned = row.returnedAt !== null;
  const active = !returned && row.expiresAt.getTime() > now.getTime();
  const daysRemaining = active
    ? Math.max(0, Math.ceil((row.expiresAt.getTime() - now.getTime()) / EBOOK_MS_PER_DAY))
    : 0;
  return {
    id: row.id,
    bookId: row.bookId,
    title: row.book.title,
    author: row.book.author,
    status: active ? "ACTIVE" : returned ? "RETURNED" : "EXPIRED",
    borrowDate: row.borrowedAt,
    dueDate: row.expiresAt,
    returnDate: row.returnedAt,
    daysRemaining,
    overdue: !active && !returned,
  };
}

/**
 * Ebook dengan MASA AKSES AKTIF milik pengguna sendiri: belum dikembalikan dan
 * `expiresAt` belum lewat. Status ini bukan bukti aktivitas membaca; aktivitas
 * membaca dicatat terpisah pada EbookReadingSession. Kolom status tidak
 * dipercaya mentah-mentah karena lazy update hanya terjadi saat halaman dibaca.
 */
export async function getActiveEbookLoans(userId: string): Promise<PersonalEbookLoanItem[]> {
  const now = new Date();
  const rows = await prisma.ebookLoan.findMany({
    where: {
      userId,
      returnedAt: null,
      // Status dikeluarkan dari filter: aturannya murni timestamp (sama dengan
      // getEbookAccessState), sehingga kolom status yang belum tersinkron
      // tidak bisa membuat loan aktif terlewat dari jawaban.
      expiresAt: { gt: now },
    },
    select: ebookLoanSelect,
    orderBy: { borrowedAt: "desc" },
  });
  return rows.map((row) => toEbookLoanItem(row, now));
}

/**
 * Riwayat ebook: sudah dikembalikan lebih awal ATAU masa aksesnya sudah
 * berakhir. Ebook yang masih aktif tidak termasuk.
 */
export async function getEbookHistory(userId: string): Promise<PersonalEbookLoanItem[]> {
  const now = new Date();
  const rows = await prisma.ebookLoan.findMany({
    where: {
      userId,
      OR: [{ returnedAt: { not: null } }, { expiresAt: { lte: now } }],
    },
    select: ebookLoanSelect,
    orderBy: { borrowedAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return rows.map((row) => toEbookLoanItem(row, now));
}

/** Denda yang sah hanya milik pengguna sendiri, diambil dari transaksi. */
export async function getPersonalFines(userId: string): Promise<PersonalFineItem[]> {
  const rows = await prisma.borrowRecord.findMany({
    where: { userId, fineAmount: { gt: 0 } },
    select: {
      id: true,
      bookId: true,
      fineAmount: true,
      lateFineAmount: true,
      damageFineAmount: true,
      returnCondition: true,
      dueDate: true,
      returnDate: true,
      book: { select: { title: true, author: true } },
      finePayments: { select: { amount: true } },
    },
    orderBy: { returnDate: "desc" },
  });
  return rows.map((row) => toFineItem(row as FineRow));
}

/**
 * Cakupan format untuk pertanyaan peminjaman pribadi.
 *
 * Resolusi format memakai SATU fungsi yang sama dengan lapisan jawaban
 * (`resolvePersonalLoanScope` di personalAnswer.ts) sehingga data yang
 * diambil dari database SELALU sesuai dengan format yang diminta pengguna.
 *
 * - "EBOOK"    : pengguna secara eksplisit menyebut ebook/buku digital.
 * - "PHYSICAL" : pengguna menyebut buku fisik/cetak, ATAU menyebut "buku"
 *                tanpa penanda digital (default produk: buku fisik).
 * - "ALL"      : pengguna meminta semua peminjaman ("semua", "apa saja") atau
 *                memakai kalimat umum tanpa menyebut format sama sekali.
 */
export type { PersonalLoanScope } from "./personalAnswer";
export { resolvePersonalLoanScope } from "./personalAnswer";

/** Ambil data sesuai intent lalu susun jawaban ringkas (tanpa memanggil model). */
export async function buildPersonalAnswer(
  intent: PersonalIntent,
  query: string,
  userId: string
): Promise<PersonalAnswer> {
  if (intent === "MY_LOANS") {
    const scope = resolvePersonalLoanScope(query);
    // Query HANYA menyentuh sumber data yang diminta format-nya: buku fisik
    // dari BorrowRecord, ebook dari EbookLoan. Data format lain TIDAK diambil.
    const [active, pending, activeEbooks] = await Promise.all([
      scope === "EBOOK" ? Promise.resolve([]) : getActiveLoans(userId),
      scope === "EBOOK" ? Promise.resolve([]) : getPendingRequests(userId),
      scope === "PHYSICAL" ? Promise.resolve([]) : getActiveEbookLoans(userId),
    ]);
    return buildPersonalAnswerFromIntent(intent, query, { active, pending, activeEbooks });
  }

  if (intent === "MY_HISTORY") {
    const scope = resolvePersonalLoanScope(query);
    const [history, ebookHistory, activeEbooks] = await Promise.all([
      scope === "EBOOK" ? Promise.resolve([]) : getBorrowHistory(userId),
      scope === "PHYSICAL" ? Promise.resolve([]) : getEbookHistory(userId),
      scope === "PHYSICAL" ? Promise.resolve([]) : getActiveEbookLoans(userId),
    ]);
    return buildPersonalAnswerFromIntent(intent, query, {
      history,
      ebookHistory,
      activeEbooks,
    });
  }

  const fines = await getPersonalFines(userId);
  return buildPersonalAnswerFromIntent(intent, query, { fines });
}
