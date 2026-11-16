/**
 * Satu sumber kebenaran untuk format katalog: BUKU = buku fisik, EBOOK = ebook.
 *
 * Aturan produk:
 * - Kata "buku" tanpa penanda digital berarti PHYSICAL.
 * - "ebook", "e-book", "buku digital", "versi digital" berarti EBOOK.
 * - "buku fisik", "buku cetak", "buku di perpustakaan" berarti PHYSICAL.
 * - ALL hanya dipakai bila pengguna SECARA EKSPLISIT meminta kedua format.
 *
 * Resolver ini dipakai oleh deteksi intent, query database katalog, jawaban
 * deterministik, dan handler tool — supaya tidak ada resolver kedua yang bisa
 * saling bertentangan.
 */

import { EBOOK_FORMAT, PHYSICAL_FORMAT } from "@/lib/config/ebook";

export type CatalogFormat = typeof PHYSICAL_FORMAT | typeof EBOOK_FORMAT;
export type CatalogFormatScope = CatalogFormat | "ALL";

export const PHYSICAL = PHYSICAL_FORMAT as CatalogFormat;
export const EBOOK = EBOOK_FORMAT as CatalogFormat;

/**
 * Penanda eksplisit format digital. Ditulis agar cocok dengan teks asli
 * (sebelum normalisasi) maupun teks yang sudah dinormalisasi menjadi "ebook".
 */
export const EBOOK_FORMAT_QUERY =
  /\b(e\s*-?\s*books?|ebooks?|buku\s+digital(?:nya)?|buku\s+elektronik(?:nya)?|bacaan\s+digital|versi\s+digital)\b/i;

/**
 * Penanda eksplisit buku fisik/cetak.
 */
export const PHYSICAL_FORMAT_QUERY =
  /\b(buku\s+fisik(?:nya)?|buku\s+cetak(?:an)?|versi\s+fisik|versi\s+cetak|hardcopy|softcopy|buku\s+(?:yang\s+)?(?:ada\s+)?di\s+perpustakaan)\b/i;

export function hasEbookFormatCue(query: string): boolean {
  return EBOOK_FORMAT_QUERY.test(query);
}

export function hasPhysicalFormatCue(query: string): boolean {
  return PHYSICAL_FORMAT_QUERY.test(query);
}

/** True bila pengguna menyebut salah satu format secara eksplisit. */
export function hasFormatCue(query: string): boolean {
  return hasEbookFormatCue(query) || hasPhysicalFormatCue(query);
}

/** Normalisasi nilai `format` dari argumen tool. Null bila tidak dikenal. */
export function normalizeCatalogFormat(value: unknown): CatalogFormatScope | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === PHYSICAL || raw === EBOOK || raw === "ALL") return raw;
  return null;
}

/**
 * Tentukan format katalog secara deterministik.
 *
 * Isi pertanyaan selalu menjadi acuan utama. Argumen `explicit` (dari model /
 * tool) hanya dipakai bila pertanyaan tidak memuat penanda format sama sekali,
 * sehingga model tidak bisa "membelokkan" permintaan buku fisik menjadi ebook
 * atau sebaliknya. Tanpa penanda apa pun, default-nya PHYSICAL.
 */
export function resolveCatalogFormat(
  query: string,
  explicit?: unknown
): CatalogFormatScope {
  const q = (query ?? "").toLowerCase();
  const ebook = hasEbookFormatCue(q);
  const physical = hasPhysicalFormatCue(q);

  // Permintaan kedua format harus eksplisit.
  if (ebook && physical) return "ALL";
  if (ebook) return EBOOK;
  if (physical) return PHYSICAL;

  return normalizeCatalogFormat(explicit) ?? PHYSICAL;
}
