/**
 * Penyimpanan & query aktivitas membaca ebook.
 *
 * Model: satu baris `EbookReadingSession` = satu sesi, bukan satu transaksi.
 * Heartbeat hanya memperbarui baris sesi yang sama. Sesi lama tetap tersimpan
 * setelah masa pinjam berakhir agar riwayat aktivitas tidak hilang.
 *
 * Semua fungsi di sini server-only. Identitas pengguna harus berasal dari sesi
 * autentikasi di route, bukan dari body/query browser.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getEbookAccessState,
  type EbookAccessState,
} from "@/lib/config/ebook";
import {
  READING_ACTIVITY_CONFIG,
  READING_ACTIVITY_STATUS,
  getReadingActivityStatus,
  getReadingIdleCutoff,
  type ReadingActivityStatus,
} from "@/lib/config/reading";
import {
  jakartaMonthRange,
  jakartaParts,
  jakartaTodayRange,
  jakartaYearRange,
} from "@/lib/ai/datetime";

export type ReadingActivityEvent = "open" | "heartbeat" | "close";

export type ReadingPeriodKey =
  | "today"
  | "7d"
  | "30d"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all";

export interface ReadingPeriod {
  key: ReadingPeriodKey;
  start?: Date;
  end?: Date;
  label: string;
}

const PERIOD_KEYS: ReadonlySet<string> = new Set([
  "today",
  "7d",
  "30d",
  "this_month",
  "last_month",
  "this_year",
  "all",
]);

export function isReadingPeriodKey(
  value: string | null | undefined
): value is ReadingPeriodKey {
  return typeof value === "string" && PERIOD_KEYS.has(value);
}

/** Rentang periode berbasis zona Asia/Jakarta. */
export function resolveReadingPeriod(
  period: string | null | undefined,
  now: Date = new Date()
): ReadingPeriod {
  const key: ReadingPeriodKey = isReadingPeriodKey(period) ? period : "30d";
  const parts = jakartaParts(now);

  switch (key) {
    case "today": {
      const range = jakartaTodayRange(now);
      return { key, start: range.start, end: range.end, label: "hari ini" };
    }
    case "7d":
      return {
        key,
        start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        end: now,
        label: "7 hari terakhir",
      };
    case "30d":
      return {
        key,
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        end: now,
        label: "30 hari terakhir",
      };
    case "this_month": {
      const range = jakartaMonthRange(parts.year, parts.month);
      return { key, ...range, label: "bulan ini" };
    }
    case "last_month": {
      const index = parts.year * 12 + (parts.month - 1) - 1;
      const year = Math.floor(index / 12);
      const month = index - year * 12 + 1;
      const range = jakartaMonthRange(year, month);
      return { key, ...range, label: "bulan lalu" };
    }
    case "this_year": {
      const range = jakartaYearRange(parts.year);
      return { key, ...range, label: "tahun ini" };
    }
    default:
      return { key: "all", label: "seluruh periode" };
  }
}

export interface ReadingActivityFilters {
  search?: string;
  status?: ReadingActivityStatus | null;
  start?: Date;
  end?: Date;
  periodLabel?: string;
}

function searchWhere(search: string): Prisma.EbookReadingSessionWhereInput {
  return {
    OR: [
      { user: { name: { contains: search } } },
      { user: { class: { contains: search } } },
      { user: { identityNumber: { contains: search } } },
      { book: { title: { contains: search } } },
      { book: { author: { contains: search } } },
    ],
  };
}

/** Predikat status yang dapat diterjemahkan langsung ke SQL. */
export function readingStatusWhere(
  status: ReadingActivityStatus,
  now: Date = new Date()
): Prisma.EbookReadingSessionWhereInput {
  const cutoff = getReadingIdleCutoff(now);
  switch (status) {
    case READING_ACTIVITY_STATUS.ACTIVE:
      return {
        endedAt: null,
        lastActivityAt: { gt: cutoff },
        activityCount: { gt: 1 },
      };
    case READING_ACTIVITY_STATUS.OPENED:
      return {
        endedAt: null,
        lastActivityAt: { gt: cutoff },
        activityCount: { lte: 1 },
      };
    case READING_ACTIVITY_STATUS.INACTIVE:
      return {
        OR: [{ endedAt: { not: null } }, { lastActivityAt: { lte: cutoff } }],
      };
    default:
      // Tidak ada baris aktivitas yang berstatus UNKNOWN.
      return { id: "__no_reading_session__" };
  }
}

function andWhere(
  base: Prisma.EbookReadingSessionWhereInput,
  extra: Prisma.EbookReadingSessionWhereInput
): Prisma.EbookReadingSessionWhereInput {
  return { AND: [base, extra] };
}

export function buildReadingWhere(
  filters: ReadingActivityFilters,
  now: Date = new Date()
): Prisma.EbookReadingSessionWhereInput {
  const parts: Prisma.EbookReadingSessionWhereInput[] = [];

  const search = filters.search?.trim();
  if (search) parts.push(searchWhere(search));

  if (filters.status) {
    parts.push(readingStatusWhere(filters.status, now));
  }

  if (filters.start || filters.end) {
    const lastActivityAt: Prisma.DateTimeFilter = {};
    if (filters.start) lastActivityAt.gte = filters.start;
    if (filters.end) lastActivityAt.lt = filters.end;
    parts.push({ lastActivityAt });
  }

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}

const sessionInclude = {
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
    select: { id: true, title: true, author: true, pageCount: true },
  },
  loan: {
    select: {
      id: true,
      borrowedAt: true,
      expiresAt: true,
      returnedAt: true,
    },
  },
} as const;

type SessionWithRelations = Prisma.EbookReadingSessionGetPayload<{
  include: typeof sessionInclude;
}>;

export interface ReadingActivityRow {
  id: string;
  user: {
    id: string;
    name: string;
    role: string;
    class: string | null;
    identityNumber: string | null;
  };
  book: {
    id: string;
    title: string;
    author: string;
    pageCount: number | null;
  };
  loan: {
    id: string;
    borrowedAt: Date;
    expiresAt: Date;
    returnedAt: Date | null;
    accessState: EbookAccessState;
  } | null;
  firstOpenedAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
  status: ReadingActivityStatus;
  activityCount: number;
  lastPage: number | null;
  progressPercent: number | null;
  progressAvailable: boolean;
}

function toRow(row: SessionWithRelations, now: Date): ReadingActivityRow {
  return {
    id: row.id,
    user: row.user,
    book: row.book,
    loan: row.loan
      ? {
          id: row.loan.id,
          borrowedAt: row.loan.borrowedAt,
          expiresAt: row.loan.expiresAt,
          returnedAt: row.loan.returnedAt,
          accessState: getEbookAccessState(row.loan, now),
        }
      : null,
    firstOpenedAt: row.firstOpenedAt,
    lastActivityAt: row.lastActivityAt,
    endedAt: row.endedAt,
    status: getReadingActivityStatus(row, now),
    activityCount: row.activityCount,
    lastPage: row.lastPage,
    progressPercent: row.progressPercent,
    progressAvailable:
      row.lastPage !== null && row.progressPercent !== null,
  };
}

export interface ReadingActivitySummary {
  totalSessions: number;
  uniqueUsers: number;
  uniqueBooks: number;
  activeSessions: number;
  openedSessions: number;
  inactiveSessions: number;
}

export interface ReadingActivityList {
  rows: ReadingActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: ReadingActivitySummary;
  periodLabel: string;
  pageTrackingSupported: boolean;
}

export async function listReadingActivity(options: {
  filters?: ReadingActivityFilters;
  page?: number;
  pageSize?: number;
  sort?: "lastActivityAt_desc" | "lastActivityAt_asc";
  now?: Date;
}): Promise<ReadingActivityList> {
  const now = options.now ?? new Date();
  const filters = options.filters ?? {};
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)));
  const where = buildReadingWhere(filters, now);

  const [rows, total, activeSessions, openedSessions, inactiveSessions, userGroups, bookGroups] =
    await Promise.all([
      prisma.ebookReadingSession.findMany({
        where,
        include: sessionInclude,
        orderBy: {
          lastActivityAt:
            options.sort === "lastActivityAt_asc" ? "asc" : "desc",
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.ebookReadingSession.count({ where }),
      prisma.ebookReadingSession.count({
        where: andWhere(where, readingStatusWhere(READING_ACTIVITY_STATUS.ACTIVE, now)),
      }),
      prisma.ebookReadingSession.count({
        where: andWhere(where, readingStatusWhere(READING_ACTIVITY_STATUS.OPENED, now)),
      }),
      prisma.ebookReadingSession.count({
        where: andWhere(where, readingStatusWhere(READING_ACTIVITY_STATUS.INACTIVE, now)),
      }),
      prisma.ebookReadingSession.groupBy({ by: ["userId"], where }),
      prisma.ebookReadingSession.groupBy({ by: ["bookId"], where }),
    ]);

  return {
    rows: rows.map((row) => toRow(row, now)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      totalSessions: total,
      uniqueUsers: userGroups.length,
      uniqueBooks: bookGroups.length,
      activeSessions,
      openedSessions,
      inactiveSessions,
    },
    periodLabel: filters.periodLabel ?? "seluruh periode",
    pageTrackingSupported: READING_ACTIVITY_CONFIG.pageTrackingSupported,
  };
}

export async function getMyReadingActivity(options: {
  userId: string;
  search?: string;
  start?: Date;
  end?: Date;
  limit?: number;
  now?: Date;
}): Promise<ReadingActivityRow[]> {
  const now = options.now ?? new Date();
  const where = buildReadingWhere({
    search: options.search,
    start: options.start,
    end: options.end,
  });
  const scoped = andWhere(where, { userId: options.userId });
  const rows = await prisma.ebookReadingSession.findMany({
    where: scoped,
    include: sessionInclude,
    orderBy: { lastActivityAt: "desc" },
    take: Math.min(50, Math.max(1, options.limit ?? 10)),
  });
  return rows.map((row) => toRow(row, now));
}

export async function getMyReadingActivitySummary(options: {
  userId: string;
  start?: Date;
  end?: Date;
  now?: Date;
}): Promise<ReadingActivitySummary> {
  const now = options.now ?? new Date();
  const where = buildReadingWhere(
    { start: options.start, end: options.end },
    now
  );
  const scoped = andWhere(where, { userId: options.userId });
  const [totalSessions, activeSessions, openedSessions, inactiveSessions, bookGroups] =
    await Promise.all([
      prisma.ebookReadingSession.count({ where: scoped }),
      prisma.ebookReadingSession.count({
        where: andWhere(scoped, readingStatusWhere(READING_ACTIVITY_STATUS.ACTIVE, now)),
      }),
      prisma.ebookReadingSession.count({
        where: andWhere(scoped, readingStatusWhere(READING_ACTIVITY_STATUS.OPENED, now)),
      }),
      prisma.ebookReadingSession.count({
        where: andWhere(scoped, readingStatusWhere(READING_ACTIVITY_STATUS.INACTIVE, now)),
      }),
      prisma.ebookReadingSession.groupBy({ by: ["bookId"], where: scoped }),
    ]);
  return {
    totalSessions,
    uniqueUsers: totalSessions > 0 ? 1 : 0,
    uniqueBooks: bookGroups.length,
    activeSessions,
    openedSessions,
    inactiveSessions,
  };
}

export interface RecordReadingResult {
  sessionId: string;
  status: ReadingActivityStatus;
  created: boolean;
  closed: boolean;
}

function openKeyFor(userId: string, bookId: string): string {
  return `${userId}:${bookId}`;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Catat open/heartbeat/close.
 *
 * `loanId` WAJIB berasal dari keputusan akses server, bukan input browser.
 * Untuk event close, akses yang sudah kedaluwarsa tetap boleh menutup sesi
 * miliknya sendiri (tidak ada data baru yang ditambahkan).
 */
export async function recordEbookReadingActivity(options: {
  userId: string;
  bookId: string;
  event: ReadingActivityEvent;
  loanId?: string | null;
  page?: number | null;
  progressPercent?: number | null;
  now?: Date;
}): Promise<RecordReadingResult> {
  const now = options.now ?? new Date();
  const openKey = openKeyFor(options.userId, options.bookId);
  const existing = await prisma.ebookReadingSession.findUnique({
    where: { openKey },
  });

  // Progres membaca tidak boleh mundur: halaman yang lebih rendah (mis. saat
  // PDF.js baru dirender ulang dari awal setelah refresh) tidak boleh menimpa
  // halaman terjauh yang sudah tercatat.
  const pageData: { lastPage?: number; progressPercent?: number | null } = {};
  if (options.page !== undefined && options.page !== null) {
    const existingLastPage = existing?.lastPage ?? null;
    const shouldUpdateProgress =
      existingLastPage === null || options.page >= existingLastPage;
    if (shouldUpdateProgress) {
      pageData.lastPage = options.page;
      pageData.progressPercent = options.progressPercent ?? null;
    }
  }

  /**
   * Refresh halaman mengirim `pagehide` → `close` lalu memuat ulang dan
   * mengirim `open`. Karena `close` mengosongkan `openKey`, pencarian di atas
   * tidak menemukan sesi tersebut. Tanpa langkah berikut, setiap refresh akan
   * membuat sesi baru. Jadi untuk `open`, cari sesi yang baru saja ditutup
   * (dalam jendela toleransi, loan yang sama) dan lanjutkan baris yang sama.
   *
   * `heartbeat` juga boleh melanjutkan sesi yang baru ditutup: saat dua tab
   * membuka ebook yang sama, menutup salah satu tab mengirim `close`, tetapi
   * tab lain masih mengirim heartbeat. Tanpa aturan ini heartbeat tersebut
   * membuat sesi baru dan memecah satu sesi baca menjadi dua.
   */
  if (
    (options.event === "open" || options.event === "heartbeat") &&
    !existing
  ) {
    const resumeCutoff = new Date(
      now.getTime() - READING_ACTIVITY_CONFIG.closeResumeGraceSeconds * 1000
    );
    const recentlyClosed = await prisma.ebookReadingSession.findFirst({
      where: {
        userId: options.userId,
        bookId: options.bookId,
        openKey: null,
        endedAt: { gte: resumeCutoff },
        loanId: options.loanId ?? null,
      },
      orderBy: { endedAt: "desc" },
    });

    if (recentlyClosed) {
      // Jangan menimpa progres yang lebih jauh pada sesi yang dilanjutkan.
      const resumePageData = { ...pageData };
      if (
        recentlyClosed.lastPage !== null &&
        options.page !== undefined &&
        options.page !== null &&
        options.page < recentlyClosed.lastPage
      ) {
        delete resumePageData.lastPage;
        delete resumePageData.progressPercent;
      }
      try {
        const resumed = await prisma.ebookReadingSession.update({
          where: { id: recentlyClosed.id },
          data: {
            endedAt: null,
            openKey,
            lastActivityAt: now,
            activityCount: { increment: 1 },
            ...resumePageData,
          },
        });
        return {
          sessionId: resumed.id,
          status: getReadingActivityStatus(resumed, now),
          created: false,
          closed: false,
        };
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        // Tab lain sudah lebih dulu melanjutkan sesi ini. Pakai baris yang
        // sedang terbuka; jangan gagal dengan 500 atau membuat duplikat.
        const raced = await prisma.ebookReadingSession.findUnique({
          where: { openKey },
        });
        if (!raced) throw error;
        const fallbackPageData = { ...pageData };
        if (
          raced.lastPage !== null &&
          options.page !== undefined &&
          options.page !== null &&
          options.page < raced.lastPage
        ) {
          delete fallbackPageData.lastPage;
          delete fallbackPageData.progressPercent;
        }
        const updated = await prisma.ebookReadingSession.update({
          where: { id: raced.id },
          data: {
            lastActivityAt: now,
            activityCount: { increment: 1 },
            ...fallbackPageData,
          },
        });
        return {
          sessionId: updated.id,
          status: getReadingActivityStatus(updated, now),
          created: false,
          closed: false,
        };
      }
    }
  }

  if (options.event === "close") {
    if (!existing || existing.endedAt) {
      return {
        sessionId: existing?.id ?? "",
        status: getReadingActivityStatus(existing, now),
        created: false,
        closed: false,
      };
    }
    const updated = await prisma.ebookReadingSession.update({
      where: { id: existing.id },
      data: { endedAt: now, openKey: null },
    });
    return {
      sessionId: updated.id,
      status: getReadingActivityStatus(updated, now),
      created: false,
      closed: true,
    };
  }

  const idleCutoff = getReadingIdleCutoff(now);
  const sameLoan = (existing?.loanId ?? null) === (options.loanId ?? null);
  const reusable =
    !!existing &&
    !existing.endedAt &&
    sameLoan &&
    existing.lastActivityAt.getTime() > idleCutoff.getTime();

  if (reusable) {
    const updated = await prisma.ebookReadingSession.update({
      where: { id: existing.id },
      data: {
        lastActivityAt: now,
        activityCount: { increment: 1 },
        ...pageData,
      },
    });
    return {
      sessionId: updated.id,
      status: getReadingActivityStatus(updated, now),
      created: false,
      closed: false,
    };
  }

  // Sesi lama yang idle atau terikat loan berbeda ditutup pada waktu aktivitas
  // terakhirnya (bukan `now`) agar tidak mengarang durasi membaca.
  if (existing && !existing.endedAt) {
    await prisma.ebookReadingSession.update({
      where: { id: existing.id },
      data: { endedAt: existing.lastActivityAt, openKey: null },
    });
  }

  try {
    const created = await prisma.ebookReadingSession.create({
      data: {
        userId: options.userId,
        bookId: options.bookId,
        loanId: options.loanId ?? null,
        openKey,
        firstOpenedAt: now,
        lastActivityAt: now,
        activityCount: 1,
        ...pageData,
      },
    });
    return {
      sessionId: created.id,
      status: getReadingActivityStatus(created, now),
      created: true,
      closed: false,
    };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    // Request bersamaan sudah membuat sesi dengan key yang sama. Perbarui baris
    // itu, jangan membuat duplikat.
    const raced = await prisma.ebookReadingSession.findUnique({
      where: { openKey },
    });
    if (!raced) throw error;
    const updated = await prisma.ebookReadingSession.update({
      where: { id: raced.id },
      data: {
        lastActivityAt: now,
        activityCount: { increment: 1 },
        ...pageData,
      },
    });
    return {
      sessionId: updated.id,
      status: getReadingActivityStatus(updated, now),
      created: false,
      closed: false,
    };
  }
}

/**
 * Throttle in-memory sederhana (cukup untuk satu instance Next.js). Tidak
 * mengubah data apa pun; hanya menolak request berlebihan.
 */
const throttleBuckets = new Map<string, number[]>();

export function allowReadingActivityRequest(
  userId: string,
  bookId: string,
  now: Date = new Date()
): boolean {
  const key = openKeyFor(userId, bookId);
  const windowStart =
    now.getTime() - READING_ACTIVITY_CONFIG.requestWindowSeconds * 1000;
  const recent = (throttleBuckets.get(key) ?? []).filter(
    (timestamp) => timestamp > windowStart
  );
  if (recent.length >= READING_ACTIVITY_CONFIG.maxRequestsPerWindow) {
    throttleBuckets.set(key, recent);
    return false;
  }
  recent.push(now.getTime());
  throttleBuckets.set(key, recent);
  return true;
}

/** Hanya untuk test agar state throttle tidak bocor antar kasus. */
export function resetReadingActivityThrottle(): void {
  throttleBuckets.clear();
}
