/**
 * Context resolver — memahami pertanyaan lanjutan dari riwayat percakapan.
 *
 * Konteks HANYA dipakai untuk memahami maksud dan referensi. Setiap jawaban
 * faktual tetap diambil ulang dari database oleh handler deterministik.
 * Riwayat berasal dari payload percakapan request itu sendiri, sehingga tidak
 * ada state global dan konteks antarpengguna tidak mungkin tercampur.
 *
 * Aturan penting:
 * - Intent baru yang eksplisit selalu menang atas konteks lama.
 * - Hanya pertanyaan "lanjutan murni" (tanpa kata benda domain baru) yang
 *   diwarisi konteksnya.
 * - Bila topik sebelumnya lebih dari satu dan tidak dapat dipilih dengan aman,
 *   minta klarifikasi.
 */

import type { AIChatMessage } from "./types";
import {
  isTargetedOtherUserRequest,
  normalizeQuery,
  type Intent,
} from "./intent";

export const AMBIGUOUS_CONTEXT_CLARIFICATION =
  "Pertanyaan Anda merujuk pada lebih dari satu topik. Mohon sebutkan apakah yang dimaksud data buku, pengguna, peminjaman, atau denda.";

export const MISSING_CONTEXT_CLARIFICATION =
  "Mohon sebutkan topik yang Anda maksud (buku, pengguna, peminjaman, atau denda) agar saya dapat mengambil data yang tepat.";

export interface ConversationResolution {
  /** Intent yang dipakai pipeline. */
  intent: Intent;
  /** Query yang diteruskan ke handler (menggabungkan konteks bila relevan). */
  query: string;
  /** True bila intent/query diubah oleh konteks. */
  resolved: boolean;
  /** Pesan klarifikasi deterministik; bila diisi, pipeline tidak menjalankan query. */
  clarification?: string;
}

type Topic = "fines" | "loans" | "audit" | "users" | "roles" | "ebooks" | "catalog" | "stats";

const FIRST_PERSON = /\b(saya|aku|ku|punyaku|milik saya|dendaku|pinjamanku)\b/;

/** Penanda bahwa pengguna sedang melanjutkan/mengubah topik sebelumnya. */
const FOLLOW_UP_MARKER =
  /^(kalau|lalu|terus|dan|bagaimana|gimana|yang)\b|\b(nya|itu|tadi|tersebut)\b/;

/**
 * Kata yang BOLEH muncul pada pertanyaan lanjutan murni: kata sambung, kata
 * tunjuk, penanda waktu, dan kata ganti pemilik. Kata di luar daftar ini
 * dianggap konten baru (mis. "pengguna", "Budi", "teknologi").
 */
const FOLLOW_UP_FILLER = new Set([
  "lalu", "terus", "kalau", "kalo", "dan", "atau", "jika", "bagaimana", "gimana",
  "yang", "dengan", "untuk", "dari", "pada", "di", "ke", "itu", "tadi", "tersebut",
  "nya", "sih", "dong", "ya", "kah", "aja", "saja", "juga", "pun", "masih", "belum",
  "siswa", "murid", "guru", "staf", "staff", "pustakawan", "admin", "administrator",
  "aktif", "nonaktif", "lunas", "dibayar", "terbayar", "terlambat", "telat", "terbaru",
  "terlama", "terakhir", "baru", "lama", "pertama", "awal",
  "sudah", "aktif", "nonaktif", "lunas", "kemarin", "hari", "ini", "minggu", "bulan",
  "tahun", "sekarang", "ada", "berapa", "banyak", "jumlah", "jumlahnya", "semua",
  "seluruh", "orangnya", "namanya", "judulnya", "bukunya", "dendanya", "peminjamnya",
  "sisanya", "pustakawannya", "adminnya", "administratornya", "siswanya", "muridnya",
  "gurunya", "stafnya", "staffnya", "anggotanya", "punyaku", "saya", "aku", "ku",
  "apa", "siapa", "mana", "kapan", "mana", "tolong", "sebutkan", "tampilkan",
  "tunjukkan", "daftar", "detail", "detailnya", "rinci", "rinciannya", "tanggal", "tgl", "bulan", "tahun",
  "berikan", "kasih", "info", "informasi", "penulis", "penulisnya", "pengarang", "pengarangnya",
  // Penanda urutan/peringkat pada lanjutan ("Yang paling lama siapa?",
  // "yang terbaru?"). Tanpa ini, lanjutan sah dianggap topik baru.
  "paling", "lama", "terlama", "baru", "terbaru", "terakhir", "urut", "urutkan",
  "pertama", "awal",
  "januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus",
  "september", "oktober", "november", "desember",
]);

/** Angka tanggal/tahun pada lanjutan ("17 Oktober 2026") bukan topik baru. */
const DATE_NUMBER = /^\d{1,4}$/;

/**
 * Pertanyaan lanjutan murni: setelah kata pembuka/permintaan dibuang, tidak ada
 * kata benda/entitas baru yang tersisa. Dengan begitu "Siapa saja?" adalah
 * lanjutan, sedangkan "Siapa saja pengguna yang terdaftar?" bukan.
 */
export function isBareFollowUp(query: string): boolean {
  let rest = normalizeQuery(query);
  if (!rest) return false;

  rest = rest
    .replace(/^(?:lalu|terus|kalau|kalo|dan|jika|bagaimana|gimana)\b\s*/, "")
    .replace(
      /^(?:tolong\s+)?(?:ada\s+)?(?:siapa(?:\s+saja)?|sebutkan|tampilkan|tunjukkan|apa(?:\s+saja)?|berapa(?:\s+(?:jumlahnya|banyak|sih))?|yang\s+mana|daftar)\b\s*/,
      ""
    );

  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => FOLLOW_UP_FILLER.has(token) || DATE_NUMBER.test(token));
}

/** Kata benda domain yang menandai intent baru yang eksplisit. */
const DOMAIN_NOUN =
  /\b(buku|ebook|katalog|koleksi|pengguna|user|akun|anggota|siswa|murid|guru|staf|pustakawan|denda|pinjam|peminjaman|pengembalian|transaksi|role)\b/;

const TOPIC_RULES: Array<{ topic: Topic; pattern: RegExp }> = [
  { topic: "fines", pattern: /\b(denda|tagihan|tunggakan|lunas|dibayar|pembayaran|bayar)\b/ },
  {
    topic: "loans",
    pattern:
      /\b(pinjam|meminjam|dipinjam|peminjaman|pinjaman|peminjam|kembali|dikembalikan|pengembalian|terlambat|telat|transaksi|aktif)\b/,
  },
  { topic: "audit", pattern: /\b(audit|log aktivitas|jejak aktivitas|dihapus)\b/ },
  {
    topic: "users",
    pattern:
      /\b(pengguna|user|akun|anggota|member|siswa|murid|guru|staf|staff|pustakawan|terdaftar)\b/,
  },
  { topic: "roles", pattern: /\brole\b/ },
  { topic: "ebooks", pattern: /\bebook\b/ },
  { topic: "catalog", pattern: /\b(buku|katalog|koleksi|judul|stok|penulis|pengarang|isbn)\b/ },
  { topic: "stats", pattern: /\b(statistik|jumlah|total|berapa)\b/ },
];

/** Semua topik yang muncul pada satu pesan, menurut urutan prioritas. */
function detectTopics(message: string): Topic[] {
  const q = ` ${normalizeQuery(message)} `;
  const topics = TOPIC_RULES.filter((rule) => rule.pattern.test(q)).map((rule) => rule.topic);
  // "stats" hanya pelengkap; bila ada topik domain lain, topik itulah acuannya.
  return topics.filter((topic) => topic !== "stats").length > 0
    ? topics.filter((topic) => topic !== "stats")
    : topics;
}

/**
 * Ambigu bila pesan sebelumnya membahas koleksi DAN pengguna sekaligus tanpa
 * topik transaksi yang lebih spesifik. Transaksi (pinjam/denda) sengaja
 * didahulukan karena selalu menyebut objeknya sendiri.
 */
function hasAmbiguousTopics(topics: Topic[]): boolean {
  if (topics.length <= 1) return false;
  if (topics.includes("fines") || topics.includes("loans") || topics.includes("audit")) {
    return false;
  }
  const hasCollection = topics.includes("catalog") || topics.includes("ebooks");
  return hasCollection && topics.includes("users");
}

/** Apakah teks meminta nama/judul (bukan sekadar angka). */
function wantsNames(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return /\b(siapa|nama|namanya|judul|judulnya|sebutkan|tampilkan|daftar)\b/.test(q);
}

function asksCount(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return /\b(berapa|jumlah|total|banyak)\b/.test(q);
}

function resolveTopicIntent(
  topic: Topic,
  role: string,
  prior: string,
  current: string,
  thirdParty: boolean
): Intent {
  const personal = FIRST_PERSON.test(normalizeQuery(prior)) || FIRST_PERSON.test(normalizeQuery(current));
  const staff = role === "ADMIN" || role === "LIBRARIAN";

  switch (topic) {
    case "fines":
      // Data pihak ketiga tidak pernah dijawab sebagai denda penanya.
      if (thirdParty) return "OPERATIONAL";
      return personal || !staff ? "MY_FINES" : "OPERATIONAL";

    case "loans":
      if (thirdParty) return "OPERATIONAL";
      if (personal) {
        return /\b(riwayat|history|pernah)\b/.test(normalizeQuery(prior))
          ? "MY_HISTORY"
          : "MY_LOANS";
      }
      return staff ? "OPERATIONAL" : "MY_LOANS";

    case "audit":
      return "USER_AUDIT";

    case "users":
      return asksCount(current) && !wantsNames(current) ? "USER_COUNT" : "USER_DIRECTORY";

    case "ebooks":
      return "EBOOK_CATALOG";

    case "catalog":
      return "CATALOG";

    case "roles":
      return "CHITCHAT";
    case "stats":
      return "STATS";
  }
}

/** Gabungkan query konteks hanya untuk intent non-personal. */
function buildHandlerQuery(intent: Intent, prior: string, current: string): string {
  const personalIntent =
    intent === "MY_LOANS" || intent === "MY_HISTORY" || intent === "MY_FINES" || intent === "MY_PROFILE";
  return personalIntent ? current : `${prior} ${current}`.trim();
}

/**
 * Resolusi konteks untuk satu request. `messages` adalah payload percakapan
 * request tersebut (pesan terakhir = pertanyaan saat ini).
 */
export function resolveConversationContext(input: {
  query: string;
  messages: AIChatMessage[];
  intent: Intent;
  role: string;
}): ConversationResolution {
  const { query, messages, intent, role } = input;
  const previousUserMessages = messages
    .slice(0, -1)
    .filter((message) => message.role === "user")
    .map((message) => message.content);

  if (previousUserMessages.length === 0) {
    // Pertanyaan lanjutan tanpa konteks apa pun tidak boleh ditebak, TETAPI
    // intent deterministik yang sudah spesifik (mis. ADMIN_CAPABILITIES,
    // CATALOG) tidak boleh diubah menjadi klarifikasi.
    if (
      intent === "CHITCHAT" &&
      isBareFollowUp(query) &&
      !DOMAIN_NOUN.test(normalizeQuery(query))
    ) {
      return {
        intent: "CLARIFY",
        query,
        resolved: true,
        clarification: MISSING_CONTEXT_CLARIFICATION,
      };
    }
    return { intent, query, resolved: false };
  }

  const q = normalizeQuery(query);
  const explicitNewIntent = intent !== "CHITCHAT" && !FOLLOW_UP_MARKER.test(q);
  if (explicitNewIntent && DOMAIN_NOUN.test(q)) {
    // Pertanyaan eksplisit baru mengalahkan konteks lama.
    return { intent, query, resolved: false };
  }

  if (!isBareFollowUp(query)) {
    return { intent, query, resolved: false };
  }

  // Ambil topik dari pesan pengguna TERAKHIR yang punya topik jelas.
  let prior = "";
  let topics: Topic[] | null = null;
  for (let i = previousUserMessages.length - 1; i >= 0; i -= 1) {
    const candidate = previousUserMessages[i];
    const found = detectTopics(candidate);
    if (found.length > 0) {
      prior = candidate;
      topics = found;
      break;
    }
  }

  if (!topics) {
    // Topik tidak dapat dipastikan: hanya klarifikasi bila maksud deterministik
    // juga tidak jelas. Intent spesifik tetap dipertahankan.
    if (intent === "CHITCHAT") {
      return {
        intent: "CLARIFY",
        query,
        resolved: true,
        clarification: MISSING_CONTEXT_CLARIFICATION,
      };
    }
    return { intent, query, resolved: false };
  }

  // Referensi bisa menunjuk lebih dari satu topik → klarifikasi, bukan menebak.
  if (hasAmbiguousTopics(topics)) {
    return {
      intent: "CLARIFY",
      query,
      resolved: true,
      clarification: AMBIGUOUS_CONTEXT_CLARIFICATION,
    };
  }

  const topic = topics[0];
  // "Siapa saja?" hanya masuk akal pada topik pengguna/transaksi/denda/audit.
  // Setelah topik katalog/statistik/ebook/role, minta klarifikasi alih-alih
  // mewarisi topik yang tidak cocok dengan kata tanya "siapa". Kecuali bila
  // yang ditanyakan adalah penulis/pengarang buku (lanjutan konteks katalog).
  const normalizedCurrent = normalizeQuery(query);
  const asksWho = /\bsiapa\b/.test(normalizedCurrent);
  const asksBookAuthor = /\b(penulis(?:nya)?|pengarang(?:nya)?|pencipta(?:nya)?)\b/.test(normalizedCurrent);
  if (
    asksWho &&
    !asksBookAuthor &&
    topics.every((t) => t === "catalog" || t === "stats" || t === "ebooks" || t === "roles")
  ) {
    return {
      intent: "CLARIFY",
      query,
      resolved: true,
      clarification: MISSING_CONTEXT_CLARIFICATION,
    };
  }
  const thirdParty =
    !FIRST_PERSON.test(normalizeQuery(prior)) && isTargetedOtherUserRequest(prior);
  const resolvedIntent = resolveTopicIntent(topic, role, prior, query, thirdParty);

  return {
    intent: resolvedIntent,
    query: buildHandlerQuery(resolvedIntent, prior, query),
    resolved: true,
  };
}
