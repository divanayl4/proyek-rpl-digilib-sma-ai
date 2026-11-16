/**
 * Pemeriksaan jawaban AI terhadap data katalog dan kebocoran konten terlarang.
 *
 * Model sesekali menyebut judul buku atau ISBN yang tidak ada di DigiLib, dan
 * sesekali menampilkan source code padahal dilarang. Jawaban tidak langsung
 * dibatalkan bila masih mengandung penjelasan yang berguna; kode dibuang dari
 * jawaban, dan jawaban yang seluruhnya berisi kode diganti dengan penolakan
 * standar.
 */

import { CATALOG_CONTEXT_MARKER } from "./types";

export interface VerificationResult {
  verified: boolean;
  /** Potongan jawaban yang tidak ditemukan di katalog. */
  unverified: string[];
}

/** Ekstrak potongan yang terlihat seperti judul buku dari markdown AI. */
function extractCandidateMentions(answer: string): string[] {
  const candidates: string[] = [];
  const patterns = [
    /\*\*([^*\n]{4,90})\*\*/g, // **tebal**
    /(?<!\*)\*([^*\n]{4,90})\*(?!\*)/g, // *miring*
    /["“”']([^"'“”\n]{4,90})["“”']/g, // "kutipan" dan ‘kutipan’
  ];

  for (const re of patterns) {
    let match = re.exec(answer);
    while (match !== null) {
      candidates.push(match[1]);
      match = re.exec(answer);
    }
  }

  return candidates;
}

/**
 * Pola karakter untuk memecah kata. Target TypeScript project ini belum
 * mendukung Unicode property escape, jadi huruf beraksen ditulis eksplisit.
 */
const NON_WORD = /[^0-9a-z\u00c0-\u024f]+/gi;
const NON_WORD_UPPER = /[^0-9A-Za-z\u00c0-\u024f]+/g;
const UPPERCASE_LETTER = /^[A-Z\u00c0-\u00DE]/;

function normalize(value: string): string {
  return value.toLowerCase().replace(NON_WORD, " ").replace(/\s+/g, " ").trim();
}

/** Buang penomoran/penanda daftar di awal sebutan, mis. "2. Judul". */
function stripListMarker(mention: string): string {
  return mention.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

/** Pola ISBN: digit panjang, opsional dipisah tanda hubung. */
const ISBN_PATTERN = /^(?:\d[\d\- ]{8,}\d)$/;

function looksLikeIsbn(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "");
  return /^\d{9}[\dX]{3,}$/.test(compact) && ISBN_PATTERN.test(value.trim());
}

/**
 * Kata umum yang sering muncul di jawaban AI tetapi bukan bagian judul buku.
 * Dipakai agar frasa seperti "2 judul buku" atau "Tahun Terbit" tidak dianggap
 * sebagai judul buku.
 */
const NON_TITLE_WORDS = new Set([
  "judul", "buku", "katalog", "digilib", "total", "jumlah", "eksemplar",
  "copy", "tersedia", "sekarang", "diterbitkan", "terbit", "penulis",
  "penerbit", "deskripsi", "singkat", "kategori", "rekomendasi", "berikut",
  "adalah", "dapat", "tidak", "tahu", "hanya", "dari", "yang", "untuk",
  "dengan", "pada", "dalam", "sudah", "juga", "saya", "kamu", "Anda",
  "bisa", "boleh", "harus", "stok", "tahun", "sinopsis", "ringkasan",
  "informasi", "tersimpan", "sistem", "halaman", "tombol", "tekan", "buka",
  "cari", "mencari", "membuka", "membaca", "detail", "klik", "lihat",
  "dipinjam", "memilih", "pilihan", "contoh", "soal", "latihan", "pembahasan",
  "identitas", "pengarang", "terbit", "sekarang", "data", "nomor",
  "catatan", "penting", "silakan", "berikutnya", "layak", "penuh",
]);

/**
 * Label formulir ("Judul:", "Catatan penting:") hampir selalu diakhiri tanda
 * baca, bukan sebuah judul. Baris seperti ini diabaikan.
 */
const LABEL_SUFFIX = /[:;,.]\s*$/;

/**
 * Sebuah potongan dianggap mencurigakan bila punya minimal dua kata dan
 * mengandung setidaknya satu kata berawalan huruf besar yang bukan kata umum
 * — ciri nama diri, misalnya "Bumi Manusia". Judul buku sungguhan hampir
 * selalu punya ciri itu, sedangkan label formulir tidak.
 */
function looksLikeTitle(mention: string): boolean {
  if (LABEL_SUFFIX.test(mention)) return false;

  const normalized = normalize(mention);
  if (normalized.length < 8) return false;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 2) return false;

  const originalWords = mention.split(NON_WORD_UPPER).filter(Boolean);
  const hasProperNoun = originalWords.some(
    (w) => w.length >= 4 && UPPERCASE_LETTER.test(w) && !NON_TITLE_WORDS.has(w.toLowerCase())
  );

  return hasProperNoun;
}

/**
 * Bandingkan jawaban AI dengan judul yang benar-benar ada di katalog.
 */
export function verifyCatalogAnswer(
  answer: string,
  catalogTitles: string[],
  catalogIsbns: string[] = []
): VerificationResult {
  const known = catalogTitles.map(normalize).filter(Boolean);
  const knownIsbns = new Set(
    catalogIsbns.map((i) => i.replace(/[\s-]/g, "").toUpperCase()).filter(Boolean)
  );
  const unverified: string[] = [];

  for (const raw of extractCandidateMentions(answer)) {
    const mention = stripListMarker(raw);
    if (!mention) continue;

    const normalized = normalize(mention);
    const compactIsbn = mention.replace(/[\s-]/g, "").toUpperCase();

    if (looksLikeIsbn(mention) && !knownIsbns.has(compactIsbn)) {
      if (!unverified.includes(mention)) unverified.push(mention);
      continue;
    }

    if (!looksLikeTitle(mention)) continue;

    const isKnown = known.some(
      (title) => title === normalized || title.includes(normalized) || normalized.includes(title)
    );
    if (isKnown) continue;

    if (!unverified.includes(mention)) {
      unverified.push(mention);
    }
  }

  return { verified: unverified.length === 0, unverified };
}

/**
 * Status eksekusi satu tool pada satu giliran. Membedakan "tidak dipanggil",
 * "berhasil dengan data", "berhasil tetapi kosong", dan "gagal" agar jawaban
 * faktual tidak pernah disusun dari status yang tidak jelas.
 */
export type ToolStatus =
  | "NOT_CALLED"
  | "SUCCESS_WITH_DATA"
  | "SUCCESS_EMPTY"
  | "ERROR"
  | "INVALID_RESULT";

/**
 * Bukti eksekusi tool pada satu giliran percakapan. `content` adalah payload
 * JSON yang dikembalikan `executeTool` (bukan teks yang ditulis model).
 */
export interface ToolEvidence {
  name: string;
  content: string;
  status?: ToolStatus;
}

/** Field yang berisi keterangan, bukan data faktual. */
const NON_DATA_FIELDS = new Set(["note", "message", "status", "hint", "error"]);

/**
 * Apakah sebuah nilai JSON mengandung data nyata (bukan hanya kerangka kosong).
 * Angka 0, array kosong, dan objek tanpa nilai bermakna dianggap kosong.
 */
function valueHasData(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => valueHasData(item));
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "boolean") return false;
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
      if (NON_DATA_FIELDS.has(key.toLowerCase())) return false;
      return valueHasData(item);
    });
  }
  return false;
}

/** Klasifikasikan payload tool menjadi status yang eksplisit. */
export function classifyToolResult(content: string): ToolStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return "INVALID_RESULT";
  }

  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "error" in parsed &&
    Boolean((parsed as { error?: unknown }).error)
  ) {
    return "ERROR";
  }

  return valueHasData(parsed) ? "SUCCESS_WITH_DATA" : "SUCCESS_EMPTY";
}

/**
 * Kumpulkan judul/ISBN katalog yang BENAR-BENAR muncul pada payload tool.
 * Dipakai untuk memverifikasi sebutan judul pada jawaban model tanpa menebak
 * dari pengetahuan umum.
 */
export function collectCatalogEvidence(contents: string[]): {
  titles: string[];
  isbns: string[];
} {
  const titles = new Set<string>();
  const isbns = new Set<string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string") {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey === "title" || normalizedKey === "judul") {
          if (item.trim()) titles.add(item);
        } else if (normalizedKey === "isbn") {
          if (item.trim()) isbns.add(item);
        }
      } else {
        visit(item);
      }
    }
  };

  for (const content of contents) {
    try {
      visit(JSON.parse(content) as unknown);
    } catch {
      // Abaikan payload non-JSON.
    }
  }

  return { titles: Array.from(titles), isbns: Array.from(isbns) };
}

/**
 * Normalisasi satu token angka gaya Indonesia.
 * - "10.000" → 10000 (pemisah ribuan)
 * - "10.000,50" → 10000.5
 * - "3,5" → 3.5
 */
function parseNumericToken(raw: string): number | null {
  const cleaned = raw
    .replace(/^rp\.?\s*/i, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return null;

  if (cleaned.includes(",")) {
    const value = Number(cleaned.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    const value = Number(cleaned.replace(/\./g, ""));
    return Number.isFinite(value) ? value : null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Iterasi token angka tanpa bergantung pada target ES (matchAll). */
function forEachNumericToken(
  text: string,
  pattern: RegExp,
  visit: (token: string) => void
): void {
  const re = new RegExp(pattern.source, pattern.flags);
  let match = re.exec(text);
  while (match !== null) {
    visit(match[0]);
    match = re.exec(text);
  }
}

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;

/** Kumpulkan SEMUA angka yang benar-benar muncul pada payload/teks sumber. */
function collectNumbersFromValue(value: unknown, into: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(value);
    return;
  }
  if (typeof value === "string") {
    forEachNumericToken(value, NUMBER_TOKEN, (token) => {
      const parsed = parseNumericToken(token);
      if (parsed !== null) into.add(parsed);
      const integerPart = Number.parseInt(token, 10);
      if (Number.isFinite(integerPart)) into.add(integerPart);
    });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbersFromValue(item, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectNumbersFromValue(item, into);
    }
  }
}

/** Angka yang tersedia sebagai bukti: payload tool + teks pertanyaan pengguna. */
export function collectEvidenceNumbers(
  evidence: ToolEvidence[],
  allowedText: string[] = []
): Set<number> {
  const numbers = new Set<number>();
  for (const item of evidence) {
    try {
      collectNumbersFromValue(JSON.parse(item.content) as unknown, numbers);
    } catch {
      collectNumbersFromValue(item.content, numbers);
    }
  }
  for (const text of allowedText) {
    collectNumbersFromValue(text, numbers);
  }
  return numbers;
}

export interface NumericClaimCheck {
  supported: boolean;
  /** Token angka pada jawaban yang tidak ditemukan pada bukti. */
  unsupported: string[];
}

/**
 * Pastikan setiap angka pada jawaban dapat ditelusuri ke payload tool atau ke
 * pertanyaan pengguna sendiri (mis. tanggal yang ditanyakan). Model TIDAK boleh
 * menghitung ulang total/nominal; angka turunan harus sudah tersedia dari query.
 */
export function verifyNumericClaims(
  answer: string,
  evidence: ToolEvidence[],
  allowedText: string[] = []
): NumericClaimCheck {
  const allowed = collectEvidenceNumbers(evidence, allowedText);
  // Penanda daftar ("1. ", "2) ") bukan klaim angka.
  const cleaned = answer.replace(/^\s*\d+[.)]\s+/gm, "");
  const unsupported: string[] = [];

  forEachNumericToken(cleaned, /(?:rp\.?\s*)?\d+(?:[.,]\d+)*/gi, (token) => {
    const value = parseNumericToken(token);
    if (value === null) return;
    if (allowed.has(value)) return;
    if (!unsupported.includes(token)) unsupported.push(token);
  });

  return { supported: unsupported.length === 0, unsupported };
}

/**
 * Apakah jawaban jalur model layak ditandai `verified`.
 *
 * Aturan:
 * - Tidak ada tool yang dieksekusi pada giliran ini → TIDAK terverifikasi.
 *   Model yang berhasil menulis teks bukan bukti data DigiLib benar.
 * - Ada tool yang gagal/akses ditolak → TIDAK terverifikasi.
 * - Untuk jawaban katalog/ringkasan/statistik, sebutan judul/ISBN harus cocok
 *   dengan judul/ISBN yang muncul pada hasil tool.
 * - Setiap angka pada jawaban harus dapat ditelusuri ke payload tool atau ke
 *   pertanyaan pengguna. Angka turunan/hasil hitung ulang model dianggap tidak
 *   terverifikasi.
 *
 * Deterministik (bukan model) tidak memakai fungsi ini; jalur tersebut sudah
 * mengambil data langsung dari database.
 */
export function verifyModelAnswer(
  answer: string,
  evidence: ToolEvidence[],
  intent: string,
  allowedText: string[] = []
): boolean {
  if (evidence.length === 0) return false;

  const statuses = evidence.map((item) => item.status ?? classifyToolResult(item.content));
  if (
    statuses.some(
      (status) => status === "ERROR" || status === "INVALID_RESULT" || status === "NOT_CALLED"
    )
  ) {
    return false;
  }

  if (intent === "CATALOG" || intent === "BOOK_SUMMARY" || intent === "STATS") {
    const { titles, isbns } = collectCatalogEvidence(
      evidence.map((item) => item.content)
    );
    if ((titles.length > 0 || isbns.length > 0) && !verifyCatalogAnswer(answer, titles, isbns).verified) {
      return false;
    }
  }

  return verifyNumericClaims(answer, evidence, allowedText).supported;
}

/**
 * True bila minimal satu tool benar-benar berhasil (dengan data atau kosong).
 * Dipakai factual guard: tool yang gagal/tidak dipanggil TIDAK dianggap bukti.
 */
export function hasUsableToolEvidence(evidence: ToolEvidence[]): boolean {
  return evidence.some((item) => {
    const status = item.status ?? classifyToolResult(item.content);
    return status === "SUCCESS_WITH_DATA" || status === "SUCCESS_EMPTY";
  });
}

export const VERIFICATION_NOTE =
  "\n\n---\n\n> **Catatan verifikasi:** jawaban di atas menyebut judul atau data yang " +
  "tidak ditemukan dalam katalog DigiLib. Data yang akurat tercantum pada kartu buku " +
  "di bawah — mohon gunakan kartu tersebut sebagai rujukan.";

/**
 * Buang penanda internal yang hanya berguna untuk mesin. Model kadang
 * menyalinnya apa adanya ke dalam jawaban meski sudah diminta tidak.
 */
export function stripInternalMarkers(answer: string): string {
  return answer
    .replace(/\[\s*BOOK_ID\s*:[^\]]*\]/gi, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Penolakan standar untuk permintaan di luar lingkup DigiLib. */
export const OUT_OF_SCOPE_REFUSAL =
  "Maaf, saya hanya dapat membantu seputar perpustakaan DigiLib, rekomendasi buku, " +
  "ebook, dan pertanyaan ringan mengenai mata pelajaran SMK.";

/** Penolakan standar bila jawaban memuat isi instruksi sistem. */
export const INTERNAL_PROMPT_REFUSAL =
  "Maaf, saya tidak dapat menampilkan instruksi sistem, konfigurasi, " +
  "atau data internal aplikasi.";

/**
 * Penanda bagian system prompt. Bila salah satunya muncul di jawaban, model
 * kemungkinan sedang menyalin prompt-nya sendiri ke layar pengguna.
 */
const INTERNAL_PROMPT_MARKERS = [
  "ATURAN MUTLAK",
  "PETUNJUK UNTUK PESAN INI",
  "=== IDENTITAS PENGGUNA",
  `=== ${CATALOG_CONTEXT_MARKER} ===`,
  "=== RINGKASAN BUKU ===",
  "=== STATISTIK KATALOG",
  'Anda adalah "DigiLib Assistant"',
  "Sapaan yang benar untuk pengguna ini",
];

export function containsInternalPromptLeak(answer: string): boolean {
  return INTERNAL_PROMPT_MARKERS.some((marker) => answer.includes(marker));
}

/**
 * Blok kode berpagar (``` atau ~~~) selalu dibuang dari jawaban.
 */
const FENCED_CODE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;

/**
 * Baris yang tampak jelas seperti baris program. Dipakai untuk membuang kode
 * yang ditulis model tanpa pagaran. Sengaja tidak menandai formula matematika
 * seperti "F = m × a" atau kalimat prosa yang diakhiri titik koma tunggal
 * tanpa tanda kurung.
 */
const CODE_LINE_PATTERNS: RegExp[] = [
  /[{}]\s*$/, // baris kurung kurawal/kotak
  /\)\s*[;{]\s*$/, // ); atau ){
  /^\s*(?:def|class|import|from|elif|except|lambda|async|await)\s+\w/, // Python
  /^\s*(?:if|else|for|while|return|switch|case|function|const|let|var|export|require)\s*[({"']/,
  /^\s*console\.\w+\s*\(/, // JavaScript
  /^\s*(?:public|private|protected|static|void|package)\s+\w/, // Java / C#
  /^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b.*\b(?:FROM|INTO|VALUES|SET|TABLE|WHERE)\b/i, // SQL
  /=>/, // arrow function
  /^\s*<\?php/i,
  /^\s*<!doctype/i,
  /^\s*<\/?[a-zA-Z][\w-]*(?:[\s/>])/, // tag HTML
  // Panggilan/deklarasi fungsi tanpa spasi sebelum kurung, gaya penulisan kode.
  /^\s*[\w.]+\([^()]{0,80}\)\s*[;{]?[\s;,]*$/,
  // Penugasan yang memanggil fungsi dengan string di dalamnya: x = input("...")
  /^\s*\w+\s*=\s*[\w.]+\([^()]*["'][^()]*\)\s*[;{]?[\s;,]*$/,
  /\bconsole\.log\s*\(|\bSystem\.out\.print|\bfmt\.Println\s*\(/,
  /^\s*(?:else|try|except|finally|default)\s*:\s*$/,
  // Titik koma yang menandai sintaks: baris berisi =, kurung, atau tanda kutip.
  /^(?=.*[=("'`]).{0,160};\s*$/,
];

function isCodeLine(line: string): boolean {
  return CODE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

/** Panjang isi bermakna tanpa spasi; dipakai untuk menilai sisa jawaban. */
function proseLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/**
 * Jaga agar source code tidak pernah sampai ke pengguna lewat API.
 *
 * - Blok kode berpagar selalu dibuang.
 * - Baris yang tampak seperti kode dibuang dari jawaban.
 * - Bila sisa jawaban terlalu pendek (jawaban pada dasarnya adalah kode),
 *   seluruh jawaban diganti dengan penolakan standar.
 *
 * Penjelasan konsep, rumus matematika, dan data katalog tidak terpengaruh.
 */
export function enforceNoSourceCode(answer: string): {
  answer: string;
  blocked: boolean;
} {
  const hadFence = answer.includes("```") || answer.includes("~~~");
  const lines = answer.replace(FENCED_CODE, "\n").split("\n");
  const keptLines = lines.filter((line) => !isCodeLine(line));
  const hadCodeLine = keptLines.length < lines.length;

  if (!hadFence && !hadCodeLine) {
    return { answer, blocked: false };
  }

  const remaining = keptLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (proseLength(remaining) < 60) {
    return { answer: OUT_OF_SCOPE_REFUSAL, blocked: true };
  }

  return { answer: remaining, blocked: true };
}