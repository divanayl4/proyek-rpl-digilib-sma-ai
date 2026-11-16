import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  EBOOK_CONFIG,
  getEbookAccessState,
  getRemainingMs,
} from "@/lib/config/ebook";

export const dynamic = "force-dynamic";

/**
 * GET /api/ebooks/loans
 * The signed-in user's own ebook loans only – never anybody else's.
 * Includes already-returned history so the page can show "Riwayat".
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") || "current"; // current | history | all
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, parseInt(searchParams.get("pageSize") || "20", 10));

  const now = new Date();

  const where: Record<string, unknown> = {
    // Ownership filter is not negotiable.
    userId: session.user.id,
  };

  if (scope === "current") {
    where.returnedAt = null;
  } else if (scope === "history") {
    where.returnedAt = { not: null };
  }

  const [loans, total] = await Promise.all([
    prisma.ebookLoan.findMany({
      where,
      include: {
        book: {
          select: {
            id: true,
            title: true,
            author: true,
            coverUrl: true,
            pageCount: true,
            format: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { borrowedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ebookLoan.count({ where }),
  ]);

  const items = loans.map((loan) => ({
    id: loan.id,
    borrowedAt: loan.borrowedAt,
    expiresAt: loan.expiresAt,
    returnedAt: loan.returnedAt,
    accessState: getEbookAccessState(loan, now),
    remainingMs: getRemainingMs(loan, now),
    book: loan.book,
  }));

  const currentScopeWhere = { userId: session.user.id, returnedAt: null };
  const currentLoans = await prisma.ebookLoan.findMany({
    where: currentScopeWhere,
    select: { id: true, borrowedAt: true, expiresAt: true, returnedAt: true },
  });

  const summary = {
    active: currentLoans.filter((l) => getEbookAccessState(l, now) === "ACTIVE").length,
    expired: currentLoans.filter((l) => getEbookAccessState(l, now) === "EXPIRED").length,
    total,
    accessDurationDays: EBOOK_CONFIG.accessDurationDays,
  };

  return NextResponse.json({
    loans: items,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    summary,
  });
}