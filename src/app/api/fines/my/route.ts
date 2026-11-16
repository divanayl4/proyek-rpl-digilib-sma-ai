import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BORROW_STATUS, calculateLateDays } from "@/lib/config/library";
import { getFinePerDayIDR } from "@/lib/config/settings";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/fines/my — denda MILIK PENGGUNA YANG SEDANG LOGIN.
 *
 * Berbeda dari `/api/fines` (khusus Pustakawan/Admin, seluruh pengguna), route
 * ini TIDAK menerima `userId` dari query/body. Cakupan selalu
 * `session.user.id`, sehingga Siswa/Guru tidak mungkin melihat denda pengguna
 * lain meskipun mencoba menambahkan parameter.
 *
 * Aturan data sama dengan `/api/fines`: hanya transaksi RETURNED dengan
 * fineAmount > 0. Denda berjalan pada transaksi yang belum dikembalikan baru
 * "dibekukan" saat pengembalian, jadi belum muncul sebagai tagihan di sini.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );
  const status = searchParams.get("status") || "";
  const year = searchParams.get("year") || "";

  const where: Record<string, unknown> = {
    userId: session.user.id,
    status: BORROW_STATUS.RETURNED,
    fineAmount: { gt: 0 },
  };

  if (status === "UNPAID") {
    where.finePaid = false;
    where.finePayments = { none: {} };
  } else if (status === "PARTIAL") {
    where.finePaid = false;
    where.finePayments = { some: {} };
  } else if (status === "PAID") {
    where.finePaid = true;
  }

  if (/^\d{4}$/.test(year)) {
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`);
    where.returnDate = { gte: start, lt: end };
  }

  const [records, total, fineAgg, paidAgg, unpaidCount, partialCount] = await Promise.all([
    prisma.borrowRecord.findMany({
      where,
      include: {
        book: {
          select: { id: true, title: true, author: true, isbn: true, coverUrl: true },
        },
        finePayments: { select: { amount: true, createdAt: true } },
      },
      orderBy: { returnDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.borrowRecord.count({ where }),
    prisma.borrowRecord.aggregate({ where, _sum: { fineAmount: true } }),
    prisma.finePayment.aggregate({
      where: { borrow: where },
      _sum: { amount: true },
    }),
    prisma.borrowRecord.count({ where: { ...where, finePaid: false } }),
    prisma.borrowRecord.count({
      where: { ...where, finePaid: false, finePayments: { some: {} } },
    }),
  ]);

  const ratePerDay = await getFinePerDayIDR();

  const fines = records.map((r) => {
    const totalPaid = r.finePayments.reduce((sum, p) => sum + p.amount, 0);
    const outstanding = Math.max(0, r.fineAmount - totalPaid);
    const daysLate = r.returnDate ? calculateLateDays(r.dueDate, r.returnDate) : 0;
    const paymentStatus = totalPaid <= 0 ? "UNPAID" : outstanding <= 0 ? "PAID" : "PARTIAL";
    const lastPaymentAt = r.finePayments.reduce<Date | null>((latest, p) => {
      if (!latest || p.createdAt.getTime() > latest.getTime()) return p.createdAt;
      return latest;
    }, null);

    return {
      id: r.id,
      dueDate: r.dueDate,
      borrowDate: r.borrowDate,
      returnDate: r.returnDate,
      fineAmount: r.fineAmount,
      lateFineAmount: r.lateFineAmount,
      damageFineAmount: r.damageFineAmount,
      returnCondition: r.returnCondition,
      fineRate: r.fineRate,
      finePaid: r.finePaid,
      finePaidAt: r.finePaidAt,
      daysLate,
      ratePerDay: r.fineRate ?? ratePerDay,
      totalPaid,
      outstanding,
      payments: r.finePayments.length,
      lastPaymentAt,
      paymentStatus,
      book: r.book,
    };
  });

  const totalFine = fineAgg._sum.fineAmount ?? 0;
  const totalPaid = paidAgg._sum.amount ?? 0;

  return NextResponse.json({
    fines,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    summary: {
      totalFine,
      totalPaid,
      totalOutstanding: Math.max(0, totalFine - totalPaid),
      unpaidCount,
      partialCount,
      paidCount: total - unpaidCount,
    },
    ratePerDay,
  });
}
