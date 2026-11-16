/**
 * Shared helpers for the book catalog API.
 *
 * Two concerns live here so every route treats them the same way:
 *   1. `filePath` is server-only. It must never reach the client; the UI gets a
 *      `hasEbookFile` boolean instead.
 *   2. Book input from the client must be normalized before it is persisted.
 */

export const BOOK_FORMAT = {
  PHYSICAL: "PHYSICAL",
  EBOOK: "EBOOK",
} as const;

export type BookFormat = (typeof BOOK_FORMAT)[keyof typeof BOOK_FORMAT];

export function isValidBookFormat(value: unknown): value is BookFormat {
  return value === BOOK_FORMAT.PHYSICAL || value === BOOK_FORMAT.EBOOK;
}

/**
 * Normalize an uploaded ebook file reference to a safe basename.
 *
 * Only a plain file name is accepted, so a crafted value can never smuggle a
 * path separator or `..` into the database (the read path also hardens this).
 * Returns null for anything that is not a plain, non-empty name.
 */
export function sanitizeEbookFilePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "." || trimmed === "..") return null;
  if (/[\\/]/.test(trimmed) || trimmed.includes("\0")) return null;
  return trimmed;
}

/** Trim a free-text value, collapsing blanks to null. */
export function cleanOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Remove the server-only `filePath` field and expose `hasEbookFile` instead.
 * `activeBorrows`/`_count` and other derived fields pass through untouched.
 */
export function serializeBook<T extends { filePath?: string | null }>(
  book: T
): Omit<T, "filePath"> & { hasEbookFile: boolean } {
  const { filePath, ...rest } = book;
  return { ...rest, hasEbookFile: Boolean(filePath) };
}

/**
 * The ebook can only be borrowed/read once a file is attached. A placeholder
 * catalog entry is an EBOOK with `filePath = null`.
 */
export function isReadableEbook(book: {
  format: string;
  filePath?: string | null;
}): boolean {
  return book.format === BOOK_FORMAT.EBOOK && Boolean(book.filePath);
}