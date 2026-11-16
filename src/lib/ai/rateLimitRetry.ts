/**
 * Kebijakan retry otomatis untuk HTTP 429 (rate limit).
 *
 * Tujuan: pengguna tidak melihat error merah hanya karena batas TPM/RPM
 * sesaat. Retry dilakukan pada level SATU permintaan HTTP (bukan mengulang
 * seluruh rangkaian tool-calling), sehingga tool/query yang sudah dieksekusi
 * tidak pernah dijalankan ulang akibat retry.
 *
 * Batas:
 * - Maksimal 2 retry (total 3 percobaan) untuk permintaan yang sama.
 * - Menghormati header Retry-After/reset dari provider.
 * - Jeda dibatasi 25 detik agar tidak menggantung terlalu lama.
 * - Kuota/kredit habis (QUOTA) TIDAK di-retry karena tidak akan pulih.
 */

import { AIProviderError } from "./types";

/** Jumlah retry maksimum untuk satu permintaan HTTP yang sama. */
export const MAX_RATE_LIMIT_RETRIES = 2;

/** Jeda maksimum satu retry (Retry-After bisa lebih besar dari ini). */
export const MAX_RATE_LIMIT_WAIT_MS = 25_000;

/** Jeda dasar bila provider tidak mengirim informasi reset (backoff eksponensial). */
export const BASE_RATE_LIMIT_WAIT_MS = 1_000;

/**
 * Baca nilai `retry-after` dari header respons provider.
 * Mendukung nilai numerik (detik), durasi gaya Groq (`24.6s`, `1m2.5s`,
 * `500ms`), dan format RFC 7231 (HTTP-date).
 * Mengembalikan undefined bila header tidak ada atau tidak valid.
 */
export function parseRetryAfterSeconds(
  headers?: Headers | null
): number | undefined {
  if (!headers || typeof headers.get !== "function") return undefined;
  const raw =
    headers.get("retry-after") ??
    headers.get("x-ratelimit-reset-tokens") ??
    headers.get("x-ratelimit-reset-requests");
  if (!raw) return undefined;
  const text = raw.trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric);
  }
  const duration = parseDurationSeconds(text);
  if (duration !== undefined) return duration;
  // Format HTTP-date: "Sat, 08 Nov 2026 04:10:00 GMT"
  const dateMs = Date.parse(text);
  if (Number.isFinite(dateMs) && dateMs > Date.now()) {
    return Math.ceil((dateMs - Date.now()) / 1000);
  }
  return undefined;
}

/**
 * Parse durasi seperti `7.66s`, `1m2.5s`, `500ms`, atau `2h`.
 * Hanya menerima string yang seluruhnya berisi token durasi.
 */
function parseDurationSeconds(raw: string): number | undefined {
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;
  const token = /(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g;
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text)) !== null) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return undefined;
    const unit = match[2];
    total +=
      unit === "h"
        ? value * 3600
        : unit === "m"
          ? value * 60
          : unit === "ms"
            ? value / 1000
            : value;
  }
  // Pastikan tidak ada sisa teks selain token durasi (mis. "24s left" ditolak).
  const remainder = text.replace(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g, "").trim();
  if (total === 0 || remainder !== "") return undefined;
  return Math.ceil(total);
}

/**
 * True bila error layak dicoba ulang otomatis.
 * Hanya 429 sementara (TPM/RPM/GENERAL) yang di-retry. QUOTA tidak, karena
 * saldo/kredit habis tidak akan pulih dalam hitungan detik.
 */
export function isRetryableRateLimit(error: unknown): error is AIProviderError {
  if (!(error instanceof AIProviderError)) return false;
  const upstream = error.upstreamStatus ?? error.status;
  if (upstream !== 429) return false;
  return error.rateLimitKind !== "QUOTA";
}

/**
 * Hitung jeda sebelum retry ke-`retryIndex` (0-based).
 * Prioritas: saran Retry-After provider, lalu backoff eksponensial.
 */
export function rateLimitRetryWaitMs(
  error: AIProviderError,
  retryIndex: number
): number {
  const suggested = error.retryAfter;
  if (
    typeof suggested === "number" &&
    Number.isFinite(suggested) &&
    suggested >= 0
  ) {
    return Math.min(Math.ceil(suggested * 1000), MAX_RATE_LIMIT_WAIT_MS);
  }
  const backoff = BASE_RATE_LIMIT_WAIT_MS * 2 ** retryIndex;
  return Math.min(backoff, MAX_RATE_LIMIT_WAIT_MS);
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log diagnostik retry. Tidak memuat prompt, API key, atau isi respons.
 */
export function logRateLimitRetry(
  providerLabel: string,
  requestId: string,
  model: string,
  retryNumber: number,
  waitMs: number,
  error: AIProviderError
): void {
  console.warn(
    [
      "[AI] Rate limit 429 — retry otomatis:",
      `provider=${providerLabel}`,
      `requestId=${requestId}`,
      `model=${model}`,
      `retry=${retryNumber}/${MAX_RATE_LIMIT_RETRIES}`,
      `kind=${error.rateLimitKind ?? "GENERAL"}`,
      `waitMs=${waitMs}`,
    ].join(" ")
  );
}
