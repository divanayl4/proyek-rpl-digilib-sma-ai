/**
 * Aturan aktivitas membaca ebook.
 *
 * Modul ini murni (tanpa akses database) agar aturan status dan validasi
 * progres dapat diuji secara deterministik dan dipakai bersama oleh API,
 * dashboard, serta chatbot.
 *
 * PENTING: "ACTIVE" berarti ADA SINYAL AKTIVITAS TERBARU yang tercatat dari
 * reader. Status ini BUKAN bukti bahwa pengguna membaca terus-menerus. Native
 * browser PDF viewer tidak mengekspos halaman aktif, sehingga progres halaman
 * hanya boleh diisi bila klien benar-benar mengirim sinyal yang valid.
 */

export const READING_ACTIVITY_STATUS = {
  ACTIVE: "ACTIVE",
  OPENED: "OPENED",
  INACTIVE: "INACTIVE",
  UNKNOWN: "UNKNOWN",
} as const;

export type ReadingActivityStatus =
  (typeof READING_ACTIVITY_STATUS)[keyof typeof READING_ACTIVITY_STATUS];

export const READING_ACTIVITY_CONFIG = {
  /**
   * Sesi dianggap tidak aktif setelah 30 menit tanpa sinyal aktivitas.
   * Nilai ini dipakai untuk status, filter dashboard, dan pembuatan sesi baru.
   */
  idleTimeoutMinutes: 30,

  /**
   * Interval heartbeat dari reader saat tab terlihat. Satu request per menit
   * hanya memperbarui baris sesi yang sama (bukan membuat transaksi/baris baru).
   */
  heartbeatSeconds: 60,

  /**
   * Throttle sederhana per pengguna+buku untuk mencegah banjir request.
   * Heartbeat normal berada jauh di bawah batas ini.
   */
  maxRequestsPerWindow: 30,
  requestWindowSeconds: 60,

  /**
   * Jendela toleransi untuk melanjutkan sesi yang baru saja ditutup oleh
   * event `pagehide` (mis. saat halaman di-refresh). Refresh mengirim `close`
   * lalu `open` lagi dalam hitungan detik; tanpa toleransi ini setiap refresh
   * akan mengakhiri sesi lama dan membuat sesi baru. Nilai dijaga pendek agar
   * "Selesaikan Membaca" yang disengaja tetap benar-benar mengakhiri sesi.
   */
  closeResumeGraceSeconds: 120,

  /**
   * PDF.js viewer (PdfJsViewer.tsx) merender halaman ke canvas dan mendeteksi
   * halaman aktif melalui IntersectionObserver, sehingga tracking halaman
   * kini didukung. Nilai ini diekspos ke UI/API.
   */
  pageTrackingSupported: true,
} as const;

export interface ReadingSessionStatusInput {
  endedAt?: Date | string | null;
  lastActivityAt: Date | string;
  activityCount?: number | null;
}

export function getReadingIdleCutoff(
  now: Date = new Date(),
  idleMinutes: number = READING_ACTIVITY_CONFIG.idleTimeoutMinutes
): Date {
  return new Date(now.getTime() - idleMinutes * 60 * 1000);
}

/**
 * Status diturunkan dari waktu server dan data sesi nyata:
 * - INACTIVE: sesi sudah ditutup atau melewati batas idle.
 * - OPENED:   masih dalam jendela idle, tetapi baru ada sinyal pembukaan.
 * - ACTIVE:   masih dalam jendela idle dan ada aktivitas lanjutan.
 *
 * COMPLETED sengaja tidak ada karena tidak ada sinyal penyelesaian yang valid
 * dari native PDF viewer. Progres 100% saja tidak dianggap bukti selesai.
 */
export function getReadingActivityStatus(
  session: ReadingSessionStatusInput | null | undefined,
  now: Date = new Date()
): ReadingActivityStatus {
  if (!session) return READING_ACTIVITY_STATUS.UNKNOWN;

  if (session.endedAt) return READING_ACTIVITY_STATUS.INACTIVE;

  const lastActivity = new Date(session.lastActivityAt).getTime();
  if (!Number.isFinite(lastActivity)) return READING_ACTIVITY_STATUS.INACTIVE;

  if (lastActivity <= getReadingIdleCutoff(now).getTime()) {
    return READING_ACTIVITY_STATUS.INACTIVE;
  }

  return (session.activityCount ?? 1) > 1
    ? READING_ACTIVITY_STATUS.ACTIVE
    : READING_ACTIVITY_STATUS.OPENED;
}

export function isReadingActivityStatus(
  value: string | null | undefined
): value is ReadingActivityStatus {
  return Object.values(READING_ACTIVITY_STATUS).includes(
    value as ReadingActivityStatus
  );
}

export function readingActivityStatusLabel(
  status: ReadingActivityStatus
): string {
  switch (status) {
    case READING_ACTIVITY_STATUS.ACTIVE:
      return "Aktivitas terbaru";
    case READING_ACTIVITY_STATUS.OPENED:
      return "Baru dibuka";
    case READING_ACTIVITY_STATUS.INACTIVE:
      return "Tidak aktif";
    default:
      return "Belum ada data";
  }
}

export type ReadingPageValidation =
  | {
      ok: true;
      lastPage: number | null;
      progressPercent: number | null;
    }
  | { ok: false; error: string };

/**
 * Validasi halaman/progres yang datang dari klien.
 *
 * - Halaman harus bilangan bulat positif.
 * - Bila pageCount tersedia, halaman tidak boleh melebihi jumlah halaman.
 * - Progres dihitung dari halaman dan pageCount; nilainya selalu 0-100.
 * - Bila pageCount tidak tersedia, halaman tetap boleh disimpan tetapi progres
 *   TIDAK dikarang (null).
 */
export function validateReadingPage(
  page: unknown,
  pageCount: number | null | undefined
): ReadingPageValidation {
  if (page === undefined || page === null || page === "") {
    return { ok: true, lastPage: null, progressPercent: null };
  }

  const parsed =
    typeof page === "string" && page.trim() !== "" ? Number(page) : page;
  if (
    typeof parsed !== "number" ||
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return { ok: false, error: "Nomor halaman tidak valid" };
  }

  const total =
    typeof pageCount === "number" &&
    Number.isFinite(pageCount) &&
    Number.isInteger(pageCount) &&
    pageCount > 0
      ? pageCount
      : null;

  if (total !== null && parsed > total) {
    return {
      ok: false,
      error: `Nomor halaman melebihi jumlah halaman ebook (${total})`,
    };
  }

  const progressPercent =
    total === null
      ? null
      : Math.min(100, Math.max(0, Math.round((parsed / total) * 1000) / 10));

  return { ok: true, lastPage: parsed, progressPercent };
}
