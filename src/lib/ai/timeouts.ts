/**
 * Batas waktu provider AI.
 *
 * Model reasoning pihak ketiga (mis. NVIDIA NIM Nemotron) dapat memerlukan
 * puluhan detik bahkan untuk prompt "ping". Batas lama 25 detik membuat uji
 * koneksi SELALU timeout pada provider lambat, sehingga aktivasi tidak pernah
 * bisa dilakukan meskipun API key valid. Nilai dapat diubah lewat environment
 * tanpa mengubah kode; hasilnya di-clamp agar tidak tak terbatas.
 */

function readMs(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Batas satu percobaan request untuk percakapan/tool-calling. */
export const AI_REQUEST_TIMEOUT_MS = readMs(
  "AI_REQUEST_TIMEOUT_MS",
  75_000,
  10_000,
  180_000
);

/** Batas total seluruh rangkaian (model utama + fallback). */
export const AI_TOTAL_BUDGET_MS = Math.max(
  readMs("AI_TOTAL_BUDGET_MS", 120_000, 15_000, 300_000),
  AI_REQUEST_TIMEOUT_MS + 15_000
);

/**
 * Batas satu request uji koneksi. Harus lebih longgar dari request biasa agar
 * uji tidak memotong model yang lambat sebelum provider menjawab.
 */
export const AI_CONNECTION_TEST_TIMEOUT_MS = readMs(
  "AI_CONNECTION_TEST_TIMEOUT_MS",
  90_000,
  10_000,
  180_000
);
