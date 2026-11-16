/**
 * Utilitas tanggal & waktu untuk AI Assistant DigiLib.
 *
 * Timestamp di database disimpan Prisma sebagai UTC. Setiap pertanyaan faktual
 * ("hari ini", "18 Oktober") HARUS dibandingkan dan ditampilkan memakai zona
 * waktu Asia/Jakarta (WIB, UTC+7) agar transaksi tidak terlewat atau jatuh ke
 * hari yang salah. Modul ini adalah satu-satunya tempat konversi tersebut
 * dilakukan untuk lapisan AI.
 */

/** Zona waktu acuan aplikasi. */
export const JAKARTA_TIME_ZONE = "Asia/Jakarta";

/** Asia/Jakarta tidak menerapkan DST: selalu UTC+7. */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface JakartaParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Pecah sebuah instant menjadi komponen waktu lokal Jakarta. */
export function jakartaParts(date: Date): JakartaParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: JAKARTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/** "2026-10-18" (tanggal lokal Jakarta). */
export function formatWibDate(date: Date): string {
  const p = jakartaParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "10:55" (jam:menit lokal Jakarta). */
export function formatWibTime(date: Date): string {
  const p = jakartaParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "2026-10-18 10:55 WIB" (tanggal & jam lokal Jakarta). */
export function formatWibDateTime(date: Date): string {
  const p = jakartaParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} WIB`;
}

/** "18 Oktober 2026" (tanggal lokal Jakarta, Bahasa Indonesia). */
export function formatWibDateLong(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: JAKARTA_TIME_ZONE,
  }).format(date);
}

/**
 * Rentang satu hari lokal Jakarta sebagai instant UTC `[start, end)`.
 * `start` = tengah malam lokal, `end` = tengah malam berikutnya.
 */
export function jakartaDayRange(
  year: number,
  month: number,
  day: number
): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, day) - JAKARTA_OFFSET_MS);
  return { start, end: new Date(start.getTime() + MS_PER_DAY) };
}

export interface ResolvedJakartaDate {
  /** Instant UTC inklusif (tengah malam lokal Jakarta). */
  start: Date;
  /** Instant UTC eksklusif (tengah malam lokal berikutnya). */
  end: Date;
  /** "2026-10-18" */
  key: string;
  /** "18 Oktober 2026" */
  label: string;
}

function rangeFromParts(
  year: number,
  month: number,
  day: number
): ResolvedJakartaDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const { start, end } = jakartaDayRange(year, month, day);
  // Tolak tanggal tidak nyata (mis. 31 Februari): hasil konversi balik harus sama.
  const p = jakartaParts(start);
  if (p.year !== year || p.month !== month || p.day !== day) return null;
  return {
    start,
    end,
    key: `${year}-${pad(month)}-${pad(day)}`,
    label: formatWibDateLong(start),
  };
}

/** Rentang hari ini menurut zona Asia/Jakarta. */
export function jakartaTodayRange(now: Date = new Date()): ResolvedJakartaDate {
  const p = jakartaParts(now);
  return rangeFromParts(p.year, p.month, p.day) as ResolvedJakartaDate;
}

/** Rentang hari relatif (mis. -1 = kemarin) menurut zona Asia/Jakarta. */
export function jakartaRelativeRange(
  offsetDays: number,
  now: Date = new Date()
): ResolvedJakartaDate {
  const shifted = new Date(now.getTime() + offsetDays * MS_PER_DAY);
  const p = jakartaParts(shifted);
  return rangeFromParts(p.year, p.month, p.day) as ResolvedJakartaDate;
}

const MONTHS: Record<string, number> = {
  januari: 1, jan: 1,
  februari: 2, feb: 2, pebruari: 2,
  maret: 3, mar: 3, mrt: 3,
  april: 4, apr: 4,
  mei: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, agu: 8, agt: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10,
  november: 11, nov: 11,
  desember: 12, des: 12, dec: 12,
};

// Nama bulan terpanjang lebih dulu agar "maret" tidak terpotong menjadi "mar".
const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

const DAY_MONTH = new RegExp(
  `\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\b(?:\\s+(\\d{2,4}))?`,
  "i"
);
const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const NUMERIC_DATE = /\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/;
const TODAY_PHRASE = /\b(hari\s+ini|today|hr\s+ini)\b/;
const YESTERDAY_PHRASE = /\b(kemarin|yesterday)\b/;
const THIS_MONTH_PHRASE = /\b(bulan\s+ini|bulan\s+sekarang|this\s+month)\b/;
const LAST_MONTH_PHRASE = /\b(bulan\s+lalu|bulan\s+kemarin|last\s+month)\b/;
const THIS_YEAR_PHRASE = /\b(tahun\s+ini|tahun\s+sekarang|this\s+year)\b/;
const LAST_YEAR_PHRASE = /\b(tahun\s+lalu|tahun\s+kemarin|last\s+year)\b/;

/** Awal bulan lokal Jakarta sebagai instant UTC. */
export function jakartaMonthStart(year: number, month: number): Date {
  return jakartaDayRange(year, month, 1).start;
}

/** Label "Oktober 2026" untuk sebuah bulan. */
function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: JAKARTA_TIME_ZONE,
  }).format(jakartaMonthStart(year, month));
}

/** Rentang satu bulan penuh `[awal bulan, awal bulan berikutnya)`. */
export function jakartaMonthRange(
  year: number,
  month: number
): { start: Date; end: Date } {
  const start = jakartaMonthStart(year, month);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start, end: jakartaMonthStart(nextYear, nextMonth) };
}

/** Rentang satu tahun penuh `[1 Januari, 1 Januari tahun berikutnya)`. */
export function jakartaYearRange(year: number): { start: Date; end: Date } {
  return {
    start: jakartaDayRange(year, 1, 1).start,
    end: jakartaDayRange(year + 1, 1, 1).start,
  };
}

export interface ResolvedJakartaPeriod {
  /** Instant UTC inklusif (tengah malam lokal Jakarta). */
  start: Date;
  /** Instant UTC eksklusif (tengah malam lokal berikutnya). */
  end: Date;
  /** "2026-10" untuk bulan, "2026" untuk tahun. */
  key: string;
  /** "Oktober 2026" / "tahun 2026" / "bulan ini". */
  label: string;
  granularity: "month" | "year";
}

/**
 * Ubah pertanyaan menjadi rentang PERIODE (bulan/tahun) menurut zona
 * Asia/Jakarta. Mendukung:
 * - "bulan ini", "bulan lalu", "tahun ini", "tahun lalu"
 * - "Oktober 2026", "bulan Oktober", "Oktober"
 * - "tahun 2026"
 *
 * Tanggal lengkap ("18 Oktober 2026") BUKAN periode dan ditangani
 * `resolveJakartaDateRange`; fungsi ini mengembalikan null agar pemanggil tidak
 * salah mengartikannya sebagai satu bulan penuh.
 */
export function resolveJakartaPeriod(
  query: string,
  now: Date = new Date()
): ResolvedJakartaPeriod | null {
  const text = ` ${query
    .toLowerCase()
    .replace(/[^a-z0-9\s./:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const current = jakartaParts(now);

  if (THIS_MONTH_PHRASE.test(text)) {
    const { start, end } = jakartaMonthRange(current.year, current.month);
    return {
      start,
      end,
      key: `${current.year}-${pad(current.month)}`,
      label: "bulan ini",
      granularity: "month",
    };
  }

  if (LAST_MONTH_PHRASE.test(text)) {
    const index = current.year * 12 + (current.month - 1) - 1;
    const year = Math.floor(index / 12);
    const month = index - year * 12 + 1;
    const { start, end } = jakartaMonthRange(year, month);
    return {
      start,
      end,
      key: `${year}-${pad(month)}`,
      label: "bulan lalu",
      granularity: "month",
    };
  }

  if (THIS_YEAR_PHRASE.test(text)) {
    const { start, end } = jakartaYearRange(current.year);
    return {
      start,
      end,
      key: String(current.year),
      label: "tahun ini",
      granularity: "year",
    };
  }

  if (LAST_YEAR_PHRASE.test(text)) {
    const { start, end } = jakartaYearRange(current.year - 1);
    return {
      start,
      end,
      key: String(current.year - 1),
      label: "tahun lalu",
      granularity: "year",
    };
  }

  // "tahun 2026" (bukan "tahun ini/lalu").
  const explicitYear = /\btahun\s+(\d{4})\b/.exec(text) ?? /\b(\d{4})\s+saja\b/.exec(text);
  if (explicitYear) {
    const year = Number(explicitYear[1]);
    const { start, end } = jakartaYearRange(year);
    return {
      start,
      end,
      key: String(year),
      label: `tahun ${year}`,
      granularity: "year",
    };
  }

  // "Oktober 2026", "bulan Oktober", "Oktober". Tanggal lengkap seperti
  // "18 Oktober 2026" tidak boleh dianggap periode bulan penuh: tolak bila token
  // bulan didahului angka hari.
  const tokens = text.trim().split(/\s+/);
  const monthIndex = tokens.findIndex((token) => MONTHS[token] !== undefined);
  if (monthIndex >= 0) {
    const previous = monthIndex > 0 ? tokens[monthIndex - 1] : "";
    if (!/^\d{1,2}$/.test(previous)) {
      const month = MONTHS[tokens[monthIndex]];
      let year = current.year;
      const yearToken = tokens[monthIndex + 1];
      if (yearToken && /^\d{4}$/.test(yearToken)) year = Number(yearToken);
      else if (yearToken && /^\d{2}$/.test(yearToken)) year = normalizeYear(Number(yearToken));
      const { start, end } = jakartaMonthRange(year, month);
      return {
        start,
        end,
        key: `${year}-${pad(month)}`,
        label: monthLabel(year, month),
        granularity: "month",
      };
    }
  }

  return null;
}

function normalizeYear(value: number): number {
  if (value >= 100) return value;
  return 2000 + value;
}

/**
 * Ubah teks pertanyaan menjadi rentang satu hari Jakarta. Mendukung:
 * - "hari ini", "today", "kemarin", "yesterday"
 * - "18 Oktober", "18 Oktober 2026", "18 okt"
 * - "2026-10-18"
 * - "18/10/2026", "18-10-2026", "18.10.2026"
 *
 * Mengembalikan `null` bila tidak ada tanggal yang dapat dipahami — pemanggil
 * harus memperlakukan ini sebagai ambigu dan meminta klarifikasi, bukan menebak.
 */
export function resolveJakartaDateRange(
  query: string,
  now: Date = new Date()
): ResolvedJakartaDate | null {
  const text = ` ${query.toLowerCase().replace(/[^a-z0-9\s./:-]/g, " ").replace(/\s+/g, " ").trim()} `;

  const iso = ISO_DATE.exec(text);
  if (iso) {
    const resolved = rangeFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (resolved) return resolved;
  }

  const dayMonth = DAY_MONTH.exec(text);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS[dayMonth[2].toLowerCase()];
    const year = dayMonth[3]
      ? normalizeYear(Number(dayMonth[3]))
      : jakartaParts(now).year;
    const resolved = rangeFromParts(year, month, day);
    if (resolved) return resolved;
  }

  const numeric = NUMERIC_DATE.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3] ? normalizeYear(Number(numeric[3])) : jakartaParts(now).year;
    const resolved = rangeFromParts(year, month, day);
    if (resolved) return resolved;
  }

  if (TODAY_PHRASE.test(text)) return jakartaTodayRange(now);
  if (YESTERDAY_PHRASE.test(text)) return jakartaRelativeRange(-1, now);

  return null;
}

/** Hari parsial seperti "tanggal 18" (tanpa bulan/tahun) — ambigu. */
export function extractPartialDay(query: string): number | null {
  const normalized = query.toLowerCase().replace(/\s+/g, " ");
  const match = /\b(?:tanggal|tgl)\s+(\d{1,2})\b/.exec(normalized);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}
