import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BORROW_STATUS, LIBRARY_CONFIG, calculateLateDays } from "@/lib/config/library";
import { getFinePerDayIDR } from "@/lib/config/settings";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/fines — daftar transaksi yang memiliki denda (buku sudah dikembalikan
 * dengan keterlambatan). Khusus Admin dan Pustakawan.
 *
 * Hanya baris RETURNED dengan fineAmount > 0 yang muncul: denda baru "dibekukan"
 * saat buku dikembalikan, jadi transaksi yang masih berjalan (OVERDUE) tidak
 * dapat dibayar di sini.
 *
 * Query: page, pageSize, search, status (UNPAID | PAID | ""), year
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!LIBRARY_CONFIG.librarianRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const year = searchParams.get("year") || "";

  const where: Record<string, unknown> = {
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

  if (search) {
    where.OR = [
      { user: { name: { contains: search } } },
      { user: { email: { contains: search } } },
      { book: { title: { contains: search } } },
      { book: { isbn: { contains: search } } },
    ];
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
        user: {
          select: { id: true, name: true, email: true, role: true, class: true, identityNumber: true },
        },
        book: {
          select: { id: true, title: true, author: true, isbn: true, coverUrl: true },
        },
        finePayments: { select: { amount: true } },
        finePaidBy: { select: { id: true, name: true } },
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
    const { finePayments, finePaidBy, ...rest } = r;
    return {
      ...rest,
      payments: finePayments.length,
      finePaidBy,
      totalPaid,
      outstanding,
      daysLate,
      paymentStatus,
      ratePerDay: r.fineRate ?? ratePerDay,
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
