/**
 * Ebook Configuration – Centralized Business Rules for "Pinjam & Baca Ebook"
 *
 * This module is isomorphic on purpose: the same rules are used by the API
 * routes (authoritative) and by the UI (cosmetic countdown / button labels).
 * The UI copy is never the security boundary – every read goes through the
 * server-side checks in src/lib/ebook-access.ts.
 *
 * Never hardcode the access window in components or route handlers.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const EBOOK_FORMAT = "EBOOK";
export const PHYSICAL_FORMAT = "PHYSICAL";

/**
 * Access states surfaced to the user as "Aktif" / "Kedaluwarsa".
 */
export const EBOOK_ACCESS_STATE = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  RETURNED: "RETURNED",
  NOT_BORROWED: "NOT_BORROWED",
} as const;

export type EbookAccessState =
  (typeof EBOOK_ACCESS_STATE)[keyof typeof EBOOK_ACCESS_STATE];

/**
 * Zona waktu standar Indonesia (WIB, UTC+7). Indonesia tidak menggunakan DST.
 */
export const JAKARTA_TIME_ZONE = "Asia/Jakarta";
export const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

export const EBOOK_CONFIG = {
  /**
   * Default access window in days, counted from borrowedAt.
   */
  accessDurationDays: 5,

  /**
   * How many ebooks a single user may hold at the same time (unfinished,
   * unexpired windows).
   */
  maxActiveLoansPerUser: 3,

  /**
   * Batas pinjam ebook dalam satu minggu kalender (Senin 00:00 WIB – Senin berikutnya 00:00 WIB).
   * Berlaku untuk SEMUA loan yang dibuat dalam minggu kalender yang sama — termasuk yang
   * sudah dikembalikan — agar peminjaman tidak bisa ditumpuk tanpa henti.
   */
  maxLoansPerCalendarWeek: 3,

  /**
   * Lifetime of the signed read token handed to the embedded PDF viewer.
   * Short on purpose: the reader refreshes it while the loan is still active,
   * so a leaked URL dies quickly on its own.
   */
  readTokenTtlSeconds: 60,

  /**
   * Roles allowed to borrow and read ebooks as ordinary users.
   *
   * Only Siswa (STUDENT) and Guru (TEACHER). Admin dan Pustakawan mengelola
   * koleksi, bukan meminjam sebagai pengguna biasa, sehingga tidak termasuk.
   */
  borrowerRoles: ["STUDENT", "TEACHER"] as string[],

  /**
   * Roles allowed to manage the ebook collection.
   */
  librarianRoles: ["ADMIN", "LIBRARIAN"] as string[],

  /**
   * Values persisted in EbookLoan.status.
   */
  loanStatuses: {
    ACTIVE: "ACTIVE",
    EXPIRED: "EXPIRED",
    RETURNED: "RETURNED",
  } as const,
} as const;

/**
 * Whether a role may borrow/read ebooks as an ordinary user.
 *
 * Single source of truth shared by the API (authoritative) and the UI
 * (cosmetic). Admin dan Pustakawan tidak diizinkan.
 */
export function canBorrowEbook(role: string | null | undefined): boolean {
  return typeof role === "string" && EBOOK_CONFIG.borrowerRoles.includes(role);
}

/**
 * Whether a role may manage the ebook collection and therefore read any ebook
 * PDF through the operator "Lihat Buku" path (without borrowing).
 *
 * Admin dan Pustakawan. Reads through this path never create an EbookLoan.
 */
export function canManageEbooks(role: string | null | undefined): boolean {
  return typeof role === "string" && EBOOK_CONFIG.librarianRoles.includes(role);
}

/**
 * Hitung awal minggu (Senin 00:00:00.000 WIB) dari sebuah instant UTC.
 * Minggu dimulai Senin 00:00:00.000 WIB (UTC+7).
 */
export function getCalendarWeekStart(date: Date): Date {
  // Konversi ke bagian waktu WIB
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const hour = read("hour");
  const minute = read("minute");
  const second = read("second");
  
  // Buat Date di tengah malam WIB hari ini
  const todayMidnightWIB = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 7 * 60 * 60 * 1000);
  
  // Hitung hari dalam seminggu (0 = Minggu, 1 = Senin, ..., 6 = Sabtu)
  // getUTCDay() pada tanggal WIB midnight akan memberikan hari di UTC, bukan WIB
  // Kita perlu menghitung hari dari bagian WIB
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  
  // Offset untuk kembali ke Senin (1 = Senin, 0 = Minggu -> -6 hari)
  // Senin = 1, offset = 0; Selasa = 2, offset = -1; ... Minggu = 0, offset = -6
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  
  const weekStart = new Date(todayMidnightWIB.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  return weekStart;
}

/**
 * Kembalikan rentang waktu minggu kalender [start, end) dalam UTC.
 * start = Senin 00:00:00.000 WIB (inklusif)
 * end = Senin berikutnya 00:00:00.000 WIB (eksklusif)
 */
export function getCalendarWeekRange(date: Date = new Date()): { start: Date; end: Date } {
  const start = getCalendarWeekStart(date);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Kembalikan rentang waktu minggu kalender dari sebuah tanggal eksplisit.
 * Digunakan untuk query database dengan filter borrowedAt.
 */
export function getCalendarWeekRangeFromDate(year: number, month: number, day: number): { start: Date; end: Date } {
  // month adalah 1-12
  const date = new Date(Date.UTC(year, month - 1, day));
  return getCalendarWeekRange(date);
}

/**
 * Sentinel "loan expiry" bound into operator read tokens.
 *
 * Operator reads have no EbookLoan, so instead of a real `expiresAt` the token
 * is bound to this fixed value. The file route only accepts this sentinel when
 * the *verified session role* is an ebook manager, so a student/teacher can
 * never satisfy the operator branch.
 */
export const EBOOK_OPERATOR_TOKEN_EXPIRES_AT = new Date(0);

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Name of the HttpOnly cookie that carries the read token to the embedded
 * viewer.
 *
 * The token is delivered as a cookie rather than only as a query parameter so
 * the iframe can point at a *stable* URL. A new token every
 * readTokenTtlSeconds would otherwise change the iframe src and reload the
 * document (losing the reader's page) every minute. The cookie is refreshed in
 * the background instead, while the URL stays the same.
 */
export const EBOOK_READ_COOKIE = "ebook_read";

/**
 * Cookie attributes for the read token. Path-scoped to the single ebook's file
 * route so it is never attached to any other request (and can never be read by
 * client-side JavaScript).
 */
export function getEbookReadCookieOptions(bookId: string, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    path: `/api/ebooks/${encodeURIComponent(bookId)}/file`,
    maxAge: EBOOK_CONFIG.readTokenTtlSeconds,
  };
}

/**
 * The minimum shape this module needs from an EbookLoan row.
 * Keeping it structural lets tests pass plain objects.
 */
export interface EbookLoanLike {
  borrowedAt: Date | string;
  expiresAt: Date | string;
  returnedAt?: Date | string | null;
  status?: string | null;
}

/**
 * expiresAt = borrowedAt + accessDurationDays (5 days by default).
 */
export function calculateEbookExpiry(
  borrowedAt: Date = new Date(),
  durationDays: number = EBOOK_CONFIG.accessDurationDays
): Date {
  return new Date(borrowedAt.getTime() + durationDays * MS_PER_DAY);
}

/**
 * Derive the access state from the stored timestamps.
 *
 * This is the authoritative rule: the decision is made from `expiresAt` and
 * `returnedAt` compared against the current time, never from the denormalized
 * `status` column. A stale "ACTIVE" row whose window has passed therefore
 * resolves to EXPIRED even if nothing has updated the row yet.
 */
export function getEbookAccessState(
  loan: EbookLoanLike | null | undefined,
  now: Date = new Date()
): EbookAccessState {
  if (!loan) return EBOOK_ACCESS_STATE.NOT_BORROWED;

  if (loan.returnedAt) return EBOOK_ACCESS_STATE.RETURNED;

  const expiresAt = new Date(loan.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return EBOOK_ACCESS_STATE.EXPIRED;

  return expiresAt <= now.getTime()
    ? EBOOK_ACCESS_STATE.EXPIRED
    : EBOOK_ACCESS_STATE.ACTIVE;
}

/**
 * True only while the user is allowed to read the file.
 */
export function isEbookAccessGranted(state: EbookAccessState): boolean {
  return state === EBOOK_ACCESS_STATE.ACTIVE;
}

/**
 * The value that should be persisted in EbookLoan.status for a given row.
 * Callers use this to lazily re-synchronize the denormalized column.
 */
export function getPersistedLoanStatus(
  loan: EbookLoanLike | null | undefined,
  now: Date = new Date()
): string {
  const state = getEbookAccessState(loan, now);
  if (state === EBOOK_ACCESS_STATE.NOT_BORROWED) {
    return EBOOK_CONFIG.loanStatuses.ACTIVE;
  }
  return state;
}

/**
 * Milliseconds left before the lock kicks in. Clamped at 0 so a countdown
 * can never render negative values.
 */
export function getRemainingMs(
  loan: EbookLoanLike | null | undefined,
  now: Date = new Date()
): number {
  if (!loan) return 0;
  const expiresAt = new Date(loan.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - now.getTime());
}

/**
 * Split remaining time into calendar-ish units for display.
 * Days are reported alongside the clock so the 5-day window stays visible.
 */
export function getRemainingParts(
  remainingMs: number
): { days: number; hours: number; minutes: number; seconds: number } {
  const safe = Math.max(0, remainingMs);
  return {
    days: Math.floor(safe / MS_PER_DAY),
    hours: Math.floor((safe % MS_PER_DAY) / (1000 * 60 * 60)),
    minutes: Math.floor((safe % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((safe % (1000 * 60)) / 1000),
  };
}

/**
 * Human readable countdown, e.g. "4 Hari 23:59:59" or "00:04:11".
 */
export function formatRemaining(remainingMs: number): string {
  const { days, hours, minutes, seconds } = getRemainingParts(remainingMs);
  const clock = [hours, minutes, seconds]
    .map((unit) => String(unit).padStart(2, "0"))
    .join(":");

  return days > 0 ? `${days} Hari ${clock}` : clock;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Mint a short-lived read token bound to one user + one ebook.
 *
 * The token only authorises the *embed*; the file route still re-checks the
 * database on every request, so a forged or replayed token cannot extend the
 * loan past expiresAt.
 */
export function signEbookReadToken(
  userId: string,
  bookId: string,
  expiresAt: Date | string,
  secret: string,
  now: Date = new Date()
): string {
  const ttlMs = EBOOK_CONFIG.readTokenTtlSeconds * 1000;
  const tokenExpiry = new Date(now.getTime() + ttlMs).getTime();
  const payload = `${userId}:${bookId}:${new Date(expiresAt).getTime()}:${tokenExpiry}`;
  return `${tokenExpiry}.${sign(payload, secret)}`;
}

/**
 * Validate a read token for the given user/book pair.
 * Uses a constant-time comparison on the signature.
 */
export function verifyEbookReadToken(
  token: string | null | undefined,
  userId: string,
  bookId: string,
  expiresAt: Date | string,
  secret: string,
  now: Date = new Date()
): boolean {
  if (!token || !secret) return false;

  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const tokenExpiryRaw = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  const tokenExpiry = Number(tokenExpiryRaw);

  if (!Number.isFinite(tokenExpiry) || tokenExpiry <= now.getTime()) {
    return false;
  }

  const payload = `${userId}:${bookId}:${new Date(expiresAt).getTime()}:${tokenExpiry}`;
  const expected = Buffer.from(sign(payload, secret), "utf8");
  const provided = Buffer.from(providedSignature, "utf8");

  if (expected.length !== provided.length) return false;

  return timingSafeEqual(expected, provided);
}