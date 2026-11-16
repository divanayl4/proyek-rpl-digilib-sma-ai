/**
 * Hybrid NLU — klasifikasi maksud pertanyaan dengan LLM.
 *
 * Aturan deterministik (`detectIntent`) tetap menjadi jalur pertama. Classifier
 * hanya dipanggil bila aturan deterministik tidak yakin (intent `CHITCHAT`).
 * LLM HANYA menentukan maksud/parameter; seluruh query database, validasi, dan
 * otorisasi tetap di backend (`pipeline.ts` + `tools.ts`).
 *
 * Output divalidasi ketat: JSON dengan `intent`, `confidence`, `parameters`,
 * dan `needsClarification`. Bila gagal/tidak valid/confidence rendah, pemanggil
 * memakai intent deterministik semula (fail-safe), bukan menebak.
 */

import { getAIProvider } from "./index";
import type { Intent } from "./intent";
import type { AIChatMessage } from "./types";

export interface IntentClassification {
  intent: Intent;
  confidence: number;
  parameters: Record<string, string | number | boolean | null>;
  needsClarification: boolean;
}

export const CLASSIFIER_CLARIFICATION =
  "Mohon perjelas maksud pertanyaan Anda agar saya dapat mengambil data yang tepat.";

/**
 * Label classifier → intent internal yang sudah ada. Sengaja TIDAK membuat
 * intent duplikat; beberapa label dipetakan ke handler yang sama.
 */
const INTENT_BY_LABEL: Record<string, Intent> = {
  BOOK_CATALOG: "CATALOG",
  BOOK_DETAIL: "CATALOG",
  BOOK_AVAILABILITY: "STATS",
  EBOOK_CATALOG: "EBOOK_CATALOG",
  USER_DIRECTORY: "USER_DIRECTORY",
  USER_COUNT: "USER_COUNT",
  USER_DETAIL: "USER_DIRECTORY",
  USER_ROLE: "USER_DIRECTORY",
  USER_AUDIT: "USER_AUDIT",
  ACCOUNT_CREATION_DATE: "USER_DIRECTORY",
  MY_PROFILE: "MY_PROFILE",
  MY_LOANS: "MY_LOANS",
  MY_HISTORY: "MY_HISTORY",
  OPERATIONAL_LOANS: "OPERATIONAL",
  RETURNS: "OPERATIONAL",
  MY_FINES: "MY_FINES",
  OPERATIONAL_FINES: "OPERATIONAL",
  PAYMENTS: "OPERATIONAL",
  STATS: "STATS",
  AI_PROVIDER: "CHITCHAT",
  AI_MODEL: "CHITCHAT",
  EDUCATIONAL: "LEARNING",
  GENERAL_CHAT: "CHITCHAT",
  CLARIFICATION_REQUIRED: "CLARIFY",
  UNKNOWN: "CHITCHAT",
};

const LABELS = Object.keys(INTENT_BY_LABEL).join(", ");

const SYSTEM_PROMPT = `Anda adalah pengklasifikasi maksud pertanyaan untuk DigiLib (sistem perpustakaan sekolah).
Tugas Anda HANYA menentukan maksud. Jangan menjawab pertanyaan, jangan menyebut fakta, dan jangan mengarang data.

Kategori yang tersedia:
${LABELS}

Aturan:
- Pertanyaan yang meminta DATA INTERNAL perpustakaan/digilib → pilih kategori data yang sesuai.
- Pertanyaan pengetahuan umum atau penjelasan konsep (mis. "apa itu buku digital?") → EDUCATIONAL.
- Sapaan/obrolan biasa → GENERAL_CHAT.
- Pertanyaan tentang provider/model AI yang sedang dipakai → AI_PROVIDER / AI_MODEL.
- Bila maksud tidak jelas atau ada beberapa kemungkinan → CLARIFICATION_REQUIRED.
- Pertanyaan lanjutan boleh memakai konteks percakapan untuk memahami maksud, tetapi konteks bukan sumber fakta.

Parameter opsional (isi HANYA bila pertanyaan menyebutkannya dengan jelas):
- role: STUDENT | TEACHER | LIBRARIAN | ADMIN | STAFF
- isActive: true | false
- status: ACTIVE | OVERDUE | RETURNED | REQUESTED | REJECTED | CANCELLED | UNPAID | PARTIAL | PAID
- format: EBOOK | PHYSICAL | ALL
- period: today | yesterday | this_week | this_month | this_year
- date: YYYY-MM-DD
- class: nama kelas (mis. "XI IPA 1")
- search: nama/email/NIS yang disebut pengguna
JANGAN mengisi userId, pemilik data, nama tabel/kolom, SQL, atau filter bebas.

Jawab HANYA dengan JSON valid tanpa markdown:
{"intent":"<KATEGORI>","confidence":<0..1>,"parameters":{},"needsClarification":<true|false>}`;

function stripCodeFence(text: string): string {
  return text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = stripCodeFence(text);
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Coba kandidat berikutnya.
    }
  }
  return null;
}

/** Hanya parameter primitif yang boleh diteruskan; tidak ada object bebas. */
function sanitizeParameters(value: unknown): Record<string, string | number | boolean | null> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      result[key] = item;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parameter classifier → hint query yang divalidasi backend.
//
// LLM tidak pernah mengirim SQL, nama tabel/kolom, userId, atau filter bebas.
// Hanya field allowlist di bawah yang diterjemahkan menjadi frasa yang SUDAH
// dikenali detektor deterministik. Identitas pemilik data selalu dari sesi.
// ---------------------------------------------------------------------------

const ROLE_HINTS: Record<string, string> = {
  STUDENT: "siswa",
  TEACHER: "guru",
  LIBRARIAN: "pustakawan",
  ADMIN: "admin",
  STAFF: "staf",
};

const STATUS_HINTS: Record<string, string> = {
  ACTIVE: "masih aktif",
  OVERDUE: "terlambat",
  RETURNED: "sudah dikembalikan",
  REQUESTED: "pengajuan",
  REJECTED: "ditolak",
  CANCELLED: "dibatalkan",
  UNPAID: "belum lunas",
  PARTIAL: "dibayar sebagian",
  PAID: "lunas",
};

const FORMAT_HINTS: Record<string, string> = {
  EBOOK: "ebook",
  PHYSICAL: "buku fisik",
  ALL: "",
};

const PERIOD_HINTS: Record<string, string> = {
  today: "hari ini",
  yesterday: "kemarin",
  this_week: "minggu ini",
  this_month: "bulan ini",
  this_year: "tahun ini",
};

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const SEARCH_PATTERN = /^[A-Za-z0-9@._' -]{1,60}$/;
const CLASS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/;
const SAFE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Teks yang tidak boleh diteruskan meski hanya menjadi frasa pencarian. */
const UNSAFE_TEXT =
  /\b(select|insert|update|delete|drop|alter|truncate|union|grant|revoke|exec|execute)\b|--|;|\/\*|\*\//i;

const DIRECTORY_INTENTS = new Set<Intent>(["USER_DIRECTORY", "USER_COUNT", "OPERATIONAL"]);
const TRANSACTION_INTENTS = new Set<Intent>([
  "OPERATIONAL",
  "MY_LOANS",
  "MY_HISTORY",
  "STATS",
  "MY_FINES",
]);
const CATALOG_INTENTS = new Set<Intent>(["CATALOG", "EBOOK_CATALOG", "STATS"]);

export interface ClassifierQueryHints {
  query: string;
  /** Field yang valid dan benar-benar diterapkan. */
  applied: string[];
  /** Field relevan tetapi nilainya tidak valid (pemanggil harus klarifikasi). */
  rejected: string[];
  /** Field di luar allowlist/intent; diabaikan sepenuhnya. */
  ignored: string[];
}

/**
 * Terjemahkan parameter classifier yang tervalidasi menjadi frasa query.
 * Tidak ada nilai LLM yang menjadi filter Prisma secara langsung: frasa hasil
 * validasi tetap melewati detektor deterministik + RBAC di pipeline/tools.
 */
export function buildClassifierQuery(
  intent: Intent,
  query: string,
  parameters: Record<string, string | number | boolean | null>
): ClassifierQueryHints {
  const applied: string[] = [];
  const rejected: string[] = [];
  const ignored: string[] = [];
  const hints: string[] = [];

  for (const [rawKey, value] of Object.entries(parameters)) {
    const key = rawKey.toLowerCase();

    if (key === "role") {
      if (!DIRECTORY_INTENTS.has(intent)) {
        ignored.push(rawKey);
        continue;
      }
      const role = typeof value === "string" ? value.trim().toUpperCase() : "";
      const hint = ROLE_HINTS[role];
      if (hint) {
        hints.push(hint);
        applied.push(rawKey);
      } else {
        rejected.push(rawKey);
      }
      continue;
    }

    if (key === "isactive" || key === "active") {
      if (!DIRECTORY_INTENTS.has(intent)) {
        ignored.push(rawKey);
        continue;
      }
      if (typeof value === "boolean") {
        hints.push(value ? "aktif" : "nonaktif");
        applied.push(rawKey);
      } else {
        rejected.push(rawKey);
      }
      continue;
    }

    if (key === "class") {
      if (!DIRECTORY_INTENTS.has(intent)) {
        ignored.push(rawKey);
        continue;
      }
      const cls = typeof value === "string" ? value.trim() : "";
      if (CLASS_PATTERN.test(cls) && !UNSAFE_TEXT.test(cls)) {
        hints.push(`kelas ${cls}`);
        applied.push(rawKey);
      } else {
        rejected.push(rawKey);
      }
      continue;
    }

    if (key === "search" || key === "name") {
      if (!DIRECTORY_INTENTS.has(intent)) {
        ignored.push(rawKey);
        continue;
      }
      const term = typeof value === "string" ? value.trim() : "";
      if (SEARCH_PATTERN.test(term) && !UNSAFE_TEXT.test(term)) {
        hints.push(term);
        applied.push(rawKey);
      } else {
        rejected.push(rawKey);
      }
      continue;
    }

    if (key === "status") {
      if (!TRANSACTION_INTENTS.has(intent)) {
        ignored.push(rawKey);
        continue;
      }
      const status = typeof value === "string" ? value.trim().toUpperCase() : "";
      const hint = STATUS_HINTS[status];
      if (hint) {
        hints.push(hint);
        applied.push(rawKey);
      } else {
        rejected.push(rawKey);
      }
      continue;
    }

    if (key === "format") {
      if (!CATALOG_INTENTS.has(intent)) {
        ignored.push(rawKey);
        continue;
      }
      const format = typeof value === "string" ? value.trim().toUpperCase() : "";
      if (format in FORMAT_HINTS) {
        if (FORMAT_HINTS[format]) hints.push(FORMAT_HINTS[format]);
        applied.push(rawKey);
      } else {
        rejected.push(rawKey);
      }
      continue;
    }

    if (key === "period") {
      if (!TRANSACTION_INTENTS.has(intent)) {
        ignored.push(rawKey);
        continue;
      }
      const period = typeof value === "string" ? value.trim().toLowerCase() : "";
      const hint = PERIOD_HINTS[period];
      if (hint) {
        hints.push(hint);
        applied.push(rawKey);
      } else {
        rejected.push(rawKey);
      }
      continue;
    }

    if (key === "date") {
      if (!TRANSACTION_INTENTS.has(intent)) {
        ignored.push(rawKey);
        continue;
      }
      const raw = typeof value === "string" ? value.trim() : "";
      const match = SAFE_DATE.exec(raw);
      const parsed = match ? new Date(`${raw}T00:00:00.000Z`) : null;
      if (
        match &&
        parsed &&
        !Number.isNaN(parsed.getTime()) &&
        parsed.getUTCFullYear() === Number(match[1]) &&
        parsed.getUTCMonth() + 1 === Number(match[2]) &&
        parsed.getUTCDate() === Number(match[3])
      ) {
        hints.push(`tanggal ${Number(match[3])} ${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`);
        applied.push(rawKey);
      } else {
        rejected.push(rawKey);
      }
      continue;
    }

    // userId, owner, limit, tabel/kolom, atau apa pun di luar allowlist.
    ignored.push(rawKey);
  }

  return {
    query: hints.length > 0 ? `${query} ${hints.join(" ")}`.trim() : query,
    applied,
    rejected,
    ignored,
  };
}

/**
 * Klasifikasikan maksud dengan provider yang sudah dikonfigurasi.
 * Mengembalikan null bila provider gagal, output tidak valid, label tidak
 * dikenal, atau confidence di bawah ambang.
 */
export async function classifyIntent(
  query: string,
  history: AIChatMessage[] = [],
  minConfidence = 0.6
): Promise<IntentClassification | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const recent = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-4)
    .map((message) => `${message.role === "user" ? "Pengguna" : "Asisten"}: ${message.content}`)
    .join("\n");

  const userPrompt = recent
    ? `Konteks percakapan (bukan sumber fakta):\n${recent}\n\nPertanyaan terbaru: ${trimmed}`
    : `Pertanyaan: ${trimmed}`;

  let raw: string;
  try {
    const provider = await getAIProvider();
    raw = await provider.chat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
  } catch (error) {
    console.warn(
      "[AI] Classifier NLU gagal, memakai intent deterministik.",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }

  if (typeof raw !== "string" || raw.trim().length === 0) return null;

  const parsed = parseJsonObject(raw);
  if (!parsed) return null;

  const label = typeof parsed.intent === "string" ? parsed.intent.trim().toUpperCase() : "";
  const intent = INTENT_BY_LABEL[label];
  if (!intent) return null;

  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  if (!Number.isFinite(confidence) || confidence < minConfidence) return null;

  const needsClarification = parsed.needsClarification === true;

  return {
    // Klasifikasi yang meminta klarifikasi tidak boleh menjalankan query data.
    intent: needsClarification ? "CLARIFY" : intent,
    confidence: Math.min(1, Math.max(0, confidence)),
    parameters: sanitizeParameters(parsed.parameters),
    needsClarification,
  };
}
