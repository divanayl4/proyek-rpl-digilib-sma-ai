import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEbookAccessState } from "@/lib/config/ebook";
import {
  isReadingPeriodKey,
  resolveReadingPeriod,
} from "@/lib/ebook-reading";

export const dynamic = "force-dynamic";

const SOURCE = "EbookLoan";
const NOTICE =
  "Data ini berasal dari riwayat peminjaman ebook. Data membuktikan peminjaman atau masa akses, bukan bukti bahwa ebook benar-benar dibuka atau dibaca.";

type HistoryStatus = "ACTIVE" | "RETURNED" | "EXPIRED";

const HISTORY_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "RETURNED",
  "EXPIRED",
]);

function parseStatus(raw: string): HistoryStatus | null | "INVALID" {
  if (!raw || raw === "ALL") return null;
  if (!HISTORY_STATUSES.has(raw)) return "INVALID";
  return raw as HistoryStatus;
}

function historyStatusWhere(
  status: HistoryStatus,
  now: Date
): Prisma.EbookLoanWhereInput {
  switch (status) {
    case "ACTIVE":
      return { returnedAt: null, expiresAt: { gt: now } };
    case "RETURNED":
      return { returnedAt: { not: null } };
    case "EXPIRED":
      return { returnedAt: null, expiresAt: { lte: now } };
  }
}

function andWhere(
  base: Prisma.EbookLoanWhereInput,
  extra: Prisma.EbookLoanWhereInput
): Prisma.EbookLoanWhereInput {
  return { AND: [base, extra] };
}

function buildHistoryWhere(options: {
  search?: string;
  status: HistoryStatus | null;
  start?: Date;
  end?: Date;
  now: Date;
}): Prisma.EbookLoanWhereInput {
  const parts: Prisma.EbookLoanWhereInput[] = [];

  if (options.search) {
    parts.push({
      OR: [
        { user: { name: { contains: options.search } } },
        { user: { class: { contains: options.search } } },
        { user: { identityNumber: { contains: options.search } } },
        { book: { title: { contains: options.search } } },
        { book: { author: { contains: options.search } } },
      ],
    });
  }

  if (options.status) {
    parts.push(historyStatusWhere(options.status, options.now));
  }

  if (options.start || options.end) {
    const borrowedAt: Prisma.DateTimeFilter = {};
    if (options.start) borrowedAt.gte = options.start;
    if (options.end) borrowedAt.lt = options.end;
    parts.push({ borrowedAt });
  }

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}

const loanSelect = {
  id: true,
  borrowedAt: true,
  expiresAt: true,
  returnedAt: true,
  status: true,
  user: {
    select: {
      id: true,
      name: true,
      role: true,
      class: true,
      identityNumber: true,
    },
  },
  book: {
    select: {
      id: true,
      title: true,
      author: true,
      format: true,
      archivedAt: true,
    },
  },
} as const;

/**
 * GET /api/admin/ebook-access-history
 *
 * Riwayat peminjaman/akses ebook GLOBAL untuk ADMIN. Sumbernya hanya
 * `EbookLoan`; data ini BUKAN aktivitas membaca dan tidak boleh dicampur
 * dengan `EbookReadingSession`.
 *
 * Filter periode memakai `borrowedAt`. Status diturunkan dari timestamp
 * (returnedAt/expiresAt), bukan hanya kolom status yang bisa tertinggal.
 * Ebook yang sudah diarsipkan tetap ditampilkan agar riwayat tidak hilang.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const rawPageSize = parseInt(searchParams.get("pageSize") || "20", 10) || 20;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));
  const search = (searchParams.get("search") || "").trim().slice(0, 100);
  const rawStatus = (searchParams.get("status") || "").toUpperCase();
  const rawPeriod = searchParams.get("period") || "30d";

  const status = parseStatus(rawStatus);
  if (status === "INVALID") {
    return NextResponse.json(
      { error: "Status peminjaman tidak valid" },
      { status: 400 }
    );
  }

  if (!isReadingPeriodKey(rawPeriod)) {
    return NextResponse.json(
      { error: "Periode tidak valid" },
      { status: 400 }
    );
  }

  const now = new Date();
  const period = resolveReadingPeriod(rawPeriod, now);
  const where = buildHistoryWhere({
    search: search || undefined,
    status,
    start: period.start,
    end: period.end,
    now,
  });

  const [
    loans,
    total,
    activeLoans,
    returnedLoans,
    expiredLoans,
    userGroups,
    bookGroups,
  ] = await Promise.all([
    prisma.ebookLoan.findMany({
      where,
      select: loanSelect,
      orderBy: { borrowedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ebookLoan.count({ where }),
    prisma.ebookLoan.count({
      where: andWhere(where, historyStatusWhere("ACTIVE", now)),
    }),
    prisma.ebookLoan.count({
      where: andWhere(where, historyStatusWhere("RETURNED", now)),
    }),
    prisma.ebookLoan.count({
      where: andWhere(where, historyStatusWhere("EXPIRED", now)),
    }),
    prisma.ebookLoan.groupBy({ by: ["userId"], where }),
    prisma.ebookLoan.groupBy({ by: ["bookId"], where }),
  ]);

  return NextResponse.json({
    source: SOURCE,
    readingEvidence: false,
    notice: NOTICE,
    rows: loans.map((loan) => ({
      id: loan.id,
      user: loan.user,
      book: {
        id: loan.book.id,
        title: loan.book.title,
        author: loan.book.author,
        format: loan.book.format,
        archivedAt: loan.book.archivedAt,
        isArchived: loan.book.archivedAt !== null,
      },
      borrowedAt: loan.borrowedAt,
      expiresAt: loan.expiresAt,
      returnedAt: loan.returnedAt,
      status: getEbookAccessState(loan, now),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      totalLoans: total,
      uniqueUsers: userGroups.length,
      uniqueBooks: bookGroups.length,
      activeLoans,
      returnedLoans,
      expiredLoans,
    },
    period: {
      key: period.key,
      label: period.label,
      start: period.start?.toISOString() ?? null,
      end: period.end?.toISOString() ?? null,
    },
    filters: {
      search,
      status: status ?? "ALL",
      period: period.key,
    },
  });
}
