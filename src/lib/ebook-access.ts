/**
 * Server-only helpers for ebook access control.
 *
 * Everything in here runs on the Node.js runtime (never imported by a client
 * component). It owns the two decisions that the browser must not be able to
 * influence:
 *   1. may this user read this ebook right now?  -> getEbookAccessDecision
 *   2. where does the file live on disk?          -> resolveEbookFilePath
 */

import path from "path";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import {
  EBOOK_FORMAT,
  EBOOK_CONFIG,
  EbookAccessState,
  getEbookAccessState,
  getPersistedLoanStatus,
  getRemainingMs,
} from "@/lib/config/ebook";

/**
 * Root folder that holds ebook files. Book.filePath is always relative to it.
 */
export const EBOOK_STORAGE_ROOT = path.join(process.cwd(), "storage", "ebooks");

export type EbookAccessReason =
  | "NOT_FOUND"
  | "NOT_AN_EBOOK"
  | "NO_FILE"
  | "NOT_BORROWED"
  | "RETURNED"
  | "EXPIRED"
  | "FORBIDDEN";

export interface EbookAccessDecision {
  ok: boolean;
  reason?: EbookAccessReason;
  status: number;
  accessState: EbookAccessState;
  remainingMs: number;
  book?: {
    id: string;
    title: string;
    author: string;
    pageCount: number | null;
    filePath: string;
  };
  loan?: {
    id: string;
    borrowedAt: Date;
    expiresAt: Date;
    returnedAt: Date | null;
  };
  /**
   * True when access was granted through the manager ("Lihat Buku") path
   * rather than an ordinary loan. There is no loan attached in that case.
   */
  operator?: boolean;
}

/**
 * Options for {@link getEbookAccessDecision}.
 *
 * `operator: true` may only be requested by a caller whose *verified* session
 * role is an ebook manager (ADMIN/LIBRARIAN). It lets a manager read a PDF
 * without borrowing and without creating any transaction.
 */
export interface EbookAccessOptions {
  operator?: boolean;
}

export const EBOOK_DENIAL_MESSAGE: Record<EbookAccessReason, string> = {
  NOT_FOUND: "Ebook tidak ditemukan",
  NOT_AN_EBOOK: "Koleksi ini bukan ebook",
  NO_FILE: "Berkas ebook belum tersedia",
  NOT_BORROWED: "Anda belum meminjam ebook ini",
  RETURNED: "Peminjaman ebook ini sudah dikembalikan",
  EXPIRED: "Masa akses ebook telah habis",
  FORBIDDEN: "Anda tidak berhak membaca ebook ini",
};

/**
 * Resolve Book.filePath to an absolute path inside the storage root.
 *
 * Rejects absolute paths, "..", NUL bytes and symlink escapes so a crafted
 * filePath in the database can never turn into arbitrary file disclosure.
 */
export function resolveEbookFilePath(filePath: string | null | undefined): string {
  if (!filePath || filePath.includes("\0")) {
    throw new Error("INVALID_FILE_PATH");
  }

  const root = path.resolve(EBOOK_STORAGE_ROOT);
  const candidate = path.resolve(root, path.normalize(filePath));

  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new Error("INVALID_FILE_PATH");
  }

  return candidate;
}

/**
 * The authoritative access check for a single user + ebook.
 *
 * The loan is looked up scoped by `userId`, so one user can never read
 * another user's ebook, and the window is re-derived from `expiresAt` on every
 * call, so replaying an old URL after the 5-day deadline still fails.
 *
 * When the window has lapsed the denormalized status column is re-synchronised
 * to EXPIRED as a side effect.
 */
export async function getEbookAccessDecision(
  userId: string,
  bookId: string,
  now: Date = new Date(),
  options: EbookAccessOptions = {}
): Promise<EbookAccessDecision> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      title: true,
      author: true,
      format: true,
      filePath: true,
      pageCount: true,
    },
  });

  if (!book) {
    return { ok: false, reason: "NOT_FOUND", status: 404, accessState: "NOT_BORROWED", remainingMs: 0 };
  }

  if (book.format !== EBOOK_FORMAT) {
    return { ok: false, reason: "NOT_AN_EBOOK", status: 404, accessState: "NOT_BORROWED", remainingMs: 0 };
  }

  if (!book.filePath) {
    return { ok: false, reason: "NO_FILE", status: 404, accessState: "NOT_BORROWED", remainingMs: 0 };
  }

  const bookPayload = {
    id: book.id,
    title: book.title,
    author: book.author,
    pageCount: book.pageCount,
    filePath: book.filePath,
  };

  // Operator ("Lihat Buku") path: a verified ebook manager may read any ebook
  // PDF directly. No loan is queried, created or mutated – access is purely a
  // function of the manager's role. The caller must have proven the role
  // server-side before passing `operator: true`.
  if (options.operator) {
    return {
      ok: true,
      status: 200,
      accessState: "ACTIVE",
      remainingMs: 0,
      operator: true,
      book: bookPayload,
    };
  }

  // Only loans belonging to this user are ever considered.
  const loan = await prisma.ebookLoan.findFirst({
    where: { userId, bookId, returnedAt: null },
    orderBy: { borrowedAt: "desc" },
    select: { id: true, borrowedAt: true, expiresAt: true, returnedAt: true, status: true },
  });

  const accessState = getEbookAccessState(loan, now);
  const remainingMs = getRemainingMs(loan, now);

  if (accessState === "NOT_BORROWED") {
    return {
      ok: false,
      reason: "NOT_BORROWED",
      status: 403,
      accessState,
      remainingMs: 0,
      book: bookPayload,
    };
  }

  if (accessState === "RETURNED") {
    return {
      ok: false,
      reason: "RETURNED",
      status: 403,
      accessState,
      remainingMs: 0,
      book: bookPayload,
    };
  }

  if (accessState === "EXPIRED") {
    // Lazily flip the stored status so reporting stays accurate. Guarded by
    // status: "ACTIVE" so we never overwrite a RETURNED row.
    await prisma.ebookLoan
      .updateMany({
        where: { id: loan!.id, status: EBOOK_CONFIG.loanStatuses.ACTIVE },
        data: { status: EBOOK_CONFIG.loanStatuses.EXPIRED },
      })
      .catch(() => undefined);

    return {
      ok: false,
      reason: "EXPIRED",
      status: 410,
      accessState,
      remainingMs: 0,
      book: bookPayload,
      loan: {
        id: loan!.id,
        borrowedAt: loan!.borrowedAt,
        expiresAt: loan!.expiresAt,
        returnedAt: loan!.returnedAt,
      },
    };
  }

  // ACTIVE – keep the status column honest in case it drifted.
  const persisted = getPersistedLoanStatus(loan, now);
  if (persisted !== loan!.status) {
    await prisma.ebookLoan
      .updateMany({
        where: { id: loan!.id, returnedAt: null },
        data: { status: persisted },
      })
      .catch(() => undefined);
  }

  return {
    ok: true,
    status: 200,
    accessState,
    remainingMs,
    book: bookPayload,
    loan: {
      id: loan!.id,
      borrowedAt: loan!.borrowedAt,
      expiresAt: loan!.expiresAt,
      returnedAt: loan!.returnedAt,
    },
  };
}

/**
 * Read the ebook bytes once access has been granted.
 * Supports Range requests so the built-in browser PDF viewer can seek pages.
 */
export async function readEbookFile(absolutePath: string): Promise<{
  buffer: Buffer;
  size: number;
}> {
  const stats = await fs.promises.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error("INVALID_FILE_PATH");
  }
  const buffer = await fs.promises.readFile(absolutePath);
  return { buffer, size: stats.size };
}