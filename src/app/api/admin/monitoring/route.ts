import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEbookAccessState } from "@/lib/config/ebook";
import { getTransactionStats } from "@/lib/transactionStats";

export const dynamic = "force-dynamic";

const MONITORED_ROLES = ["STUDENT", "TEACHER"] as const;
const ACTIVE_BORROW_STATUSES = ["BORROWED", "OVERDUE"] as const;
const ROW_LIMIT = 60;

/**
 * Monitoring aktivitas perpustakaan Siswa & Guru (khusus ADMIN).
 *
 * - Otorisasi diperiksa dari sesi server; Pustakawan/role lain ditolak 403.
 * - Hanya mengembalikan identitas yang diperlukan (nama, peran, kelas, NIS/NIP),
 *   tanpa email, password, token, atau hash.
 * - Status keterlambatan diturunkan dari tanggal (bukan hanya kolom status).
 * - Ebook dengan masa akses aktif diturunkan dari timestamp akses
 *   (getEbookAccessState). Status ini BUKAN bukti aktivitas membaca.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const userSelect = {
    select: {
      name: true,
      role: true,
      class: true,
      identityNumber: true,
    },
  } as const;

  const [
    studentActive,
    teacherActive,
    studentTotal,
    teacherTotal,
    activeEbooks,
    borrows,
    ebookLoans,
    transactionStats,
  ] = await Promise.all([
    prisma.borrowRecord.count({
      where: {
        user: { role: "STUDENT" },
        status: { in: [...ACTIVE_BORROW_STATUSES] },
      },
    }),
    prisma.borrowRecord.count({
      where: {
        user: { role: "TEACHER" },
        status: { in: [...ACTIVE_BORROW_STATUSES] },
      },
    }),
    prisma.borrowRecord.count({ where: { user: { role: "STUDENT" } } }),
    prisma.borrowRecord.count({ where: { user: { role: "TEACHER" } } }),
    prisma.ebookLoan.count({
      where: {
        user: { role: { in: [...MONITORED_ROLES] } },
        returnedAt: null,
        expiresAt: { gt: now },
      },
    }),
    prisma.borrowRecord.findMany({
      where: { user: { role: { in: [...MONITORED_ROLES] } } },
      select: {
        id: true,
        borrowDate: true,
        dueDate: true,
        returnDate: true,
        status: true,
        user: userSelect,
        book: { select: { title: true, author: true } },
      },
      orderBy: { borrowDate: "desc" },
      take: ROW_LIMIT,
    }),
    prisma.ebookLoan.findMany({
      where: {
        user: { role: { in: [...MONITORED_ROLES] } },
        returnedAt: null,
      },
      select: {
        id: true,
        borrowedAt: true,
        expiresAt: true,
        returnedAt: true,
        status: true,
        user: userSelect,
        book: { select: { title: true, author: true } },
      },
      orderBy: { borrowedAt: "desc" },
      take: ROW_LIMIT,
    }),
    getTransactionStats({ now }),
  ]);

  return NextResponse.json({
    summary: {
      studentActiveBorrows: studentActive,
      teacherActiveBorrows: teacherActive,
      studentTotalBorrows: studentTotal,
      teacherTotalBorrows: teacherTotal,
      activeEbookLoans: activeEbooks,
      totalTransactions: transactionStats.total,
      totalPhysicalBorrows: transactionStats.physicalTotal,
      totalEbookLoans: transactionStats.ebookTotal,
    },
    borrows: borrows.map((borrow) => {
      const returned = Boolean(borrow.returnDate) || borrow.status === "RETURNED";
      const overdue =
        !returned &&
        (borrow.status === "OVERDUE" || borrow.dueDate.getTime() < now.getTime());
      const effectiveStatus = returned
        ? "RETURNED"
        : overdue
          ? "OVERDUE"
          : borrow.status;
      return {
        id: borrow.id,
        user: borrow.user,
        book: borrow.book,
        borrowDate: borrow.borrowDate,
        dueDate: borrow.dueDate,
        returnDate: borrow.returnDate,
        status: borrow.status,
        effectiveStatus,
      };
    }),
    ebookLoans: ebookLoans.map((loan) => ({
      id: loan.id,
      user: loan.user,
      book: loan.book,
      borrowedAt: loan.borrowedAt,
      expiresAt: loan.expiresAt,
      returnedAt: loan.returnedAt,
      status: getEbookAccessState(loan, now),
    })),
  });
}
