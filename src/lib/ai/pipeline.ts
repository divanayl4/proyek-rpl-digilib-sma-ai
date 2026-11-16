/**
 * Pipeline pemrosesan respons AI Assistant.
 *
 * Seluruh logika penentuan jawaban yang sebelumnya menumpuk di route handler
 * dipusatkan di sini agar:
 * - Mudah diuji tanpa HTTP (input murni, output terstruktur).
 * - Setiap tahap punya kontrak yang jelas: sukses terstruktur atau
 *   `ChatError` dengan status/kode HTTP yang tepat.
 * - Route handler tinggal memetakan hasil ke `NextResponse`.
 *
 * Urutan tahap (identik dengan perilaku yang sudah stabil):
 *  1. Muat akun dari database (sumber identitas satu-satunya).
 *  2. Rate limit per pengguna.
 *  3. Validasi payload + normalisasi pertanyaan.
 *  4. Sapaan murni → deterministik.
 *  5. Deteksi intent → penolakan deterministik (coding/out-of-scope/data
 *     pengguna lain).
 *  6. Data pribadi → deterministik dari database (tetap jalan tanpa provider).
 *  6b. Data operasional/administratif yang diizinkan role (jumlah pengguna
 *     agregat, daftar identitas, pengaturan sistem, denda operasional) →
 *     deterministik dari database.
 *  7. Katalog/statistik/ringkasan → deterministik dari database, kecuali
 *     pertanyaan operasional Pustakawan/Admin.
 *  8. Jalur model + tool-calling (satu-satunya tahap yang butuh provider).
 *
 * Tahap 6–7 TIDAK membutuhkan provider AI; pemeriksaan konfigurasi hanya
 * dilakukan tepat sebelum tahap 8.
 */

import { prisma } from "@/lib/prisma";
import { getAIProvider, isAIConfigured } from "@/lib/ai";
import { canUseAIAssistant } from "@/lib/ai/access";
import {
  buildClassifierQuery,
  classifyIntent,
  CLASSIFIER_CLARIFICATION,
} from "@/lib/ai/classifier";
import { resolveConversationContext } from "@/lib/ai/contextResolver";
import {
  AIChatMessage,
  AIResponseIdentity,
  isAIProviderError,
} from "@/lib/ai/types";
import {
  Intent,
  detectIntent,
  detectTransactionsByDateFollowUpBasis,
  detectUserAuditType,
  extractUserAuditSearch,
  isBorrowsByDateQuery,
  isBorrowerRankingQuery,
  isEbookBorrowerOrReadingQuery,
  isEbookLoanHistoryQuery,
  isFineQuery,
  isGlobalActiveLoansQuery,
  isGlobalOverdueQuery,
  isGlobalReadingActivityQuery,
  isLateReturnedPhysicalQuery,
  isMyBorrowsByDateQuery,
  isMyHistoryTotalsQuery,
  isMyReadingActivityQuery,
  isOperationalQuery,
  isOtherUserActivityQuery,
  isOtherUserDataRequest,
  isOperationalTransactionStatsQuery,
  isReturnsByDateQuery,
  isTargetedOtherUserRequest,
  isUserAuditQuery,
  isUserDirectoryQuery,
  extractUserLookupTerm,
  normalizeQuery,
  selectHistory,
  validateChatPayload,
} from "@/lib/ai/intent";
import { buildPersonalAnswer, getMyBorrowsByDate } from "@/lib/ai/personal";
import { getUserActiveLoans, getUserHistoryTotals } from "@/lib/transactionStats";
import {
  ADMIN_ONLY_REFUSAL,
  AUDIT_ADMIN_ONLY,
  MUTATION_REFUSAL,
  NO_FINES,
  OPERATIONAL_BORROWS_UNAVAILABLE,
  OPERATIONAL_FINES_UNAVAILABLE,
  OPERATIONAL_READING_UNAVAILABLE,
  OTHER_USER_FINE_REFUSAL,
  OTHER_USER_REFUSAL,
  PERSONAL_DATA_UNAVAILABLE,
  READING_ACTIVITY_ADMIN_ONLY,
  SYSTEM_SETTINGS_UNAVAILABLE,
  USER_AUDIT_UNAVAILABLE,
  USER_COUNT_ADMIN_ONLY,
  USER_COUNT_FILTER_UNSUPPORTED,
  USER_COUNT_UNAVAILABLE,
  USER_DIRECTORY_LIMITED,
  USER_DIRECTORY_UNAVAILABLE,
  buildMyBorrowsByDateAnswer,
  formatDateID,
  formatRupiah,
  nonBorrowerNoFinesMessage,
  nonBorrowerPersonalMessage,
} from "@/lib/ai/personalAnswer";
import { FINE_RATE_UNAVAILABLE, buildFineRateAnswer } from "@/lib/ai/fineRates";
import {
  UserIdentity,
  buildPersonalGreeting,
  isPureGreeting,
  toUserIdentity,
} from "@/lib/ai/identity";
import { buildCatalogAnswer, getCatalogBookById, mergeCatalogQuery } from "@/lib/ai/catalog";
import { buildBookSummaryAnswer, CATALOG_DATA_UNAVAILABLE } from "@/lib/ai/catalogAnswer";
import { hasFormatCue, resolveCatalogFormat } from "@/lib/ai/catalogFormat";
import { EBOOK_FORMAT } from "@/lib/config/ebook";
import { getEbookAccessState } from "@/lib/config/ebook";
import {
  getMyReadingActivity,
  listReadingActivity,
  type ReadingActivityRow,
} from "@/lib/ebook-reading";
import {
  READING_ACTIVITY_CONFIG,
  READING_ACTIVITY_STATUS,
  readingActivityStatusLabel,
} from "@/lib/config/reading";
import {
  ALL_SYSTEM_ROLES,
  buildRoleCapabilityAnswer,
  buildRoleExplanation,
  detectRoleInquiryTarget,
  ROLE_RESTRICTION_REFUSAL,
} from "@/lib/ai/roleCapabilities";
import {
  JAKARTA_TIME_ZONE,
  extractPartialDay,
  formatWibDateTime,
  formatWibTime,
  jakartaParts,
  resolveJakartaDateRange,
} from "@/lib/ai/datetime";
import {
  detectRequestedMetrics,
  getOperationalStats,
  resolveStatsPeriod,
  resolveTransactionFormat,
  type OperationalEbookStats,
  type OperationalMetric,
  type OperationalPhysicalStats,
  type OperationalStats,
  type TransactionFormat,
} from "@/lib/ai/operationalStats";
import { buildToolSystemPrompt } from "@/lib/ai/prompt";
import { executeTool, toolsForRole } from "@/lib/ai/tools";
import { sanitizeInternalTerms } from "@/lib/ai/internalTerms";
import {
  INTERNAL_PROMPT_REFUSAL,
  OUT_OF_SCOPE_REFUSAL,
  containsInternalPromptLeak,
  enforceNoSourceCode,
  classifyToolResult,
  hasUsableToolEvidence,
  stripInternalMarkers,
  verifyModelAnswer,
  type ToolEvidence,
} from "@/lib/ai/verify";

export interface ChatReference {
  id: string;
  title: string;
  author: string;
  coverUrl?: string | null;
  available?: number | null;
}

/** Hasil sukses yang siap diserialisasi ke JSON. */
export interface ChatSuccess {
  message: string;
  intent: Intent | "CHITCHAT";
  /**
   * True hanya bila jawaban didukung bukti yang benar-benar tersedia:
   * query database deterministik, atau tool yang dieksekusi pada giliran ini.
   * Jawaban jalur model tanpa tool (atau dengan tool yang gagal) bernilai false.
   */
  verified: boolean;
  references: ChatReference[];
  /**
   * Provider/model yang benar-benar menghasilkan jawaban pada request ini.
   * Hanya diisi jalur model; tidak pernah dibaca dari state global.
   */
  ai?: AIResponseIdentity;
}

/**
 * Kegagalan terstruktur. `status` adalah status HTTP, `code` opsional untuk
 * dikenali UI (mis. AI_NOT_CONFIGURED, RATE_LIMITED).
 */
export class ChatError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfter?: number;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = "ChatError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, ChatError.prototype);
  }
}

export function isChatError(error: unknown): error is ChatError {
  return (
    error instanceof ChatError ||
    (error instanceof Error && error.name === "ChatError")
  );
}

export const FRIENDLY_FAILURE =
  "Maaf, asisten AI sedang mengalami gangguan. Silakan coba kembali beberapa saat lagi.";

/**
 * Pesan akhir bila batas penggunaan provider masih tercapai setelah retry.
 * Sengaja singkat dan tidak menyebut nama provider/jenis limit (TPM/RPM).
 */
export const FRIENDLY_RATE_LIMITED =
  "Asisten AI sedang sibuk. Silakan coba lagi beberapa saat lagi.";

// ---------------------------------------------------------------------------
// Rate limit (per pengguna, di memori).
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;

/** Direset antar pengujian agar tidak bocor antar test. */
export function resetRateLimits(): void {
  rateLimitMap.clear();
}

function checkRateLimit(userId: string): void {
  const now = Date.now();

  if (rateLimitMap.size > 1000) {
    rateLimitMap.forEach((value, key) => {
      if (now >= value.resetAt) rateLimitMap.delete(key);
    });
  }

  const limit = rateLimitMap.get(userId);
  if (limit && now < limit.resetAt) {
    if (limit.count >= RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((limit.resetAt - now) / 1000);
      throw new ChatError(
        `Terlalu banyak pesan. Tunggu ${retryAfter} detik lalu coba lagi.`,
        429,
        undefined,
        retryAfter
      );
    }
    limit.count += 1;
  } else {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  }
}

// ---------------------------------------------------------------------------
// Akun.
// ---------------------------------------------------------------------------

export interface ChatAccount {
  name: string;
  role: string;
  gender: string | null;
  class: string | null;
  isActive: boolean;
}

async function loadAccount(userId: string): Promise<ChatAccount> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, gender: true, class: true, isActive: true },
  });
  if (!account || !account.isActive) {
    throw new ChatError("Sesi Anda tidak valid. Silakan masuk kembali.", 401);
  }
  if (!canUseAIAssistant(account.role)) {
    throw new ChatError("Akses ditolak.", 403);
  }
  return account;
}

// ---------------------------------------------------------------------------
// Tahap deterministik.
// ---------------------------------------------------------------------------

function answerGreeting(query: string, identity: UserIdentity): ChatSuccess | null {
  if (!isPureGreeting(query)) return null;
  return {
    message: buildPersonalGreeting(identity),
    intent: "CHITCHAT",
    verified: true,
    references: [],
  };
}

/**
 * Klarifikasi netral untuk permintaan data pihak ketiga yang AMBIGU (nama
 * ditulis huruf kecil/KAPITAL/campuran sehingga tidak dapat dipastikan sebagai
 * nama orang). Deterministik, singkat, tidak menyebut/mengungkap data siapa pun,
 * dan dijawab SEBELUM pengambilan data sensitif apa pun.
 */
export const THIRD_PARTY_CLARIFICATION =
  "Maaf, saya belum bisa memastikan maksud pertanyaan Anda. Bisa diperjelas?\n\n" +
  "• Jika menanyakan data **Anda sendiri**, tuliskan \"saya\" (mis. \"riwayat peminjaman saya\").\n" +
  "• Jika mencari buku, sebutkan judul, mata pelajaran, atau penulisnya (mis. \"cari buku Fisika\").\n\n" +
  "Saya tidak dapat menampilkan data peminjaman atau denda milik pengguna lain.";

/** Penolakan aman untuk permintaan password/kredensial. */
export const PASSWORD_REFUSAL =
  "Maaf, saya tidak dapat melihat atau menampilkan password akun. " +
  "Jika Anda lupa password, silakan hubungi administrator atau petugas perpustakaan untuk melakukan penggantian password melalui prosedur resmi.";

/** Panduan singkat penggunaan perpustakaan DigiLib. */
const LIBRARY_GUIDE_RESPONSE =
  "Panduan singkat penggunaan DigiLib:\n\n" +
  "**Meminjam Buku:**\n" +
  "- Cari buku di Katalog, buka detail buku, klik tombol Pinjam.\n" +
  "- Buku fisik: berlaku sesuai durasi yang ditetapkan pustakawan.\n" +
  "- Ebook: masa akses terbatas; klik Baca untuk membuka langsung.\n\n" +
  "**Mengembalikan Buku:**\n" +
  "- Kembalikan buku fisik ke petugas perpustakaan atau ajukan pengembalian melalui menu Peminjaman Saya.\n\n" +
  "**Denda:**\n" +
  "- Denda dikenakan apabila buku dikembalikan melewati batas waktu.\n" +
  "- Lihat detail denda di menu Peminjaman Saya atau tanyakan kepada saya.\n\n" +
  "Untuk informasi lebih lanjut, hubungi petugas perpustakaan.";

function answerRefusal(intent: Intent, query: string, role?: string): ChatSuccess | null {
  // Permintaan pihak ketiga yang AMBIGU → klarifikasi netral untuk SEMUA role,
  // dijawab di sini agar tidak ada pengambilan data sensitif sebelum klarifikasi.
  // Pengecualian: ADMIN boleh mencoba mencocokkan nama ke database lebih dulu
  // (lihat answerAdminUserHistory); bila tidak ada yang cocok, klarifikasi tetap
  // dipakai.
  if (intent === "CLARIFY") {
    if (role === "ADMIN") return null;
    return { message: THIRD_PARTY_CLARIFICATION, intent, verified: true, references: [] };
  }
  if (intent === "PASSWORD") {
    return { message: PASSWORD_REFUSAL, intent, verified: true, references: [] };
  }
  if (intent === "MUTATION") {
    return { message: MUTATION_REFUSAL, intent, verified: true, references: [] };
  }
  if (intent === "CODING" || intent === "OUT_OF_SCOPE") {
    return { message: OUT_OF_SCOPE_REFUSAL, intent, verified: true, references: [] };
  }
  if (intent === "LIBRARY_GUIDE") {
    return { message: LIBRARY_GUIDE_RESPONSE, intent, verified: true, references: [] };
  }

  // Pemantauan aktivitas membaca GLOBAL adalah fitur baru khusus ADMIN.
  // Pustakawan TIDAK otomatis memperoleh akses ini (tidak ada data yang
  // diambil sebelum penolakan). Siswa/Guru tetap hanya boleh data sendiri.
  if (isGlobalReadingActivityQuery(query) && role !== "ADMIN") {
    return { message: READING_ACTIVITY_ADMIN_ONLY, intent, verified: true, references: [] };
  }

  // Rincian jumlah pengguna per peran hanya untuk Administrator. Ditolak
  // SEBELUM jalur STUDENT/TEACHER agar alasannya tepat (kewenangan, bukan
  // sekadar privasi data pengguna lain).
  if (intent === "USER_COUNT" && role !== "ADMIN") {
    return { message: USER_COUNT_ADMIN_ONLY, intent, verified: true, references: [] };
  }

  // Riwayat audit pembuatan/penghapusan akun: HANYA ADMIN. Non-ADMIN ditolak
  // deterministik di sini (sebelum query sensitif dijalankan) dengan pesan yang
  // seragam — tidak mengungkapkan apakah akun tertentu ada/dibuat/dihapus, dan
  // tidak pernah sampai ke jalur model.
  if (intent === "USER_AUDIT" && role !== "ADMIN") {
    return { message: AUDIT_ADMIN_ONLY, intent, verified: true, references: [] };
  }

  // Pertanyaan tentang tugas/kemampuan ADMIN: hanya ADMIN yang boleh mendapat
  // jawaban detail. Non-admin mendapat penolakan standar tanpa membocorkan
  // informasi internal.
  if (intent === "ADMIN_CAPABILITIES" && role !== "ADMIN") {
    return {
      message:
        `${ROLE_RESTRICTION_REFUSAL} ` +
        "Maaf, saya tidak dapat memberikan informasi mengenai kewenangan internal, " +
        "hak akses, atau data yang dapat diakses oleh admin. " +
        "Saya dapat membantu menjelaskan fitur DigiLib yang tersedia untuk akun Anda " +
        "atau membantu pertanyaan lain sesuai hak akses Anda.",
      intent,
      verified: true,
      references: [],
    };
  }

  // Pembatasan informasi tugas/fungsi/wewenang berdasarkan role pengguna.
  // Deteksi dilakukan di server menggunakan query teks asli — BUKAN berdasarkan
  // klaim role dari pesan pengguna. Role selalu berasal dari sesi autentikasi.
  // Admin boleh melihat penjelasan semua role.
  // Non-admin hanya boleh melihat penjelasan role akunnya sendiri.
  {
    const targetRole = detectRoleInquiryTarget(query);
    if (targetRole) {
      if (role === "ADMIN") {
        // Admin diizinkan — biarkan pipeline lanjut ke MY_CAPABILITIES / ADMIN_CAPABILITIES
        // atau tangani lewat buildRoleExplanation di processChat.
        // Kembalikan null agar tidak diblokir di sini.
      } else if (role === targetRole) {
        // Pengguna bertanya tentang role-nya sendiri — izinkan.
      } else {
        // Pengguna bertanya tentang tugas role lain — tolak di server.
        return {
          message: ROLE_RESTRICTION_REFUSAL,
          intent: "OUT_OF_SCOPE",
          verified: true,
          references: [],
        };
      }
    }
  }

  // STAFF tidak termasuk dalam OPERATIONAL_ROLES (lihat access.ts) sehingga
  // harus diblokir dari data operasional/direktori pengguna, sama seperti
  // STUDENT dan TEACHER. LIBRARIAN dan ADMIN diizinkan melanjutkan.
  const isStudentLevel = !role || role === "STUDENT" || role === "TEACHER" || role === "STAFF";
  if (isStudentLevel) {
    const restricted =
      intent === "OPERATIONAL" ||
      intent === "USER_COUNT" ||
      intent === "USER_DIRECTORY" ||
      intent === "SYSTEM_SETTINGS" ||
      isOtherUserDataRequest(query) ||
      isOtherUserActivityQuery(query) ||
      isUserDirectoryQuery(query);
    // STUDENT dan TEACHER dilarang melihat data transaksi/denda pihak ketiga,
    // daftar/jumlah pengguna, riwayat global, denda global, atau pengaturan sistem.
    if (restricted) {
      // Pengaturan sistem BUKAN data pengguna lain — pakai penolakan khusus
      // kewenangan Admin agar alasannya tepat, bukan alasan privasi.
      if (intent === "SYSTEM_SETTINGS") {
        return { message: ADMIN_ONLY_REFUSAL, intent, verified: true, references: [] };
      }
      // Pesan penolakan disesuaikan dengan jenis data yang diminta: pertanyaan
      // denda dijawab dengan penolakan denda, bukan penolakan riwayat peminjaman.
      const message = isFineQuery(query) ? OTHER_USER_FINE_REFUSAL : OTHER_USER_REFUSAL;
      return { message, intent, verified: true, references: [] };
    }
  }

  // Pustakawan boleh melihat data operasional GLOBAL (daftar transaksi, siapa
  // yang meminjam, keterlambatan), tetapi TIDAK boleh membuka data pribadi
  // pengguna tertentu yang disebut namanya (identitas, riwayat, denda). Daftar
  // operasional tetap memuat nama peminjam seperti dasbor; yang diblokir adalah
  // permintaan tertarget ("riwayat peminjaman Budi", "denda milik Budi").
  if (role === "LIBRARIAN" && isTargetedOtherUserRequest(query)) {
    const message = isFineQuery(query) ? OTHER_USER_FINE_REFUSAL : OTHER_USER_REFUSAL;
    return { message, intent, verified: true, references: [] };
  }

  // Pengaturan sistem hanya untuk Administrator (Pustakawan ditolak).
  if (role === "LIBRARIAN" && intent === "SYSTEM_SETTINGS") {
    return { message: ADMIN_ONLY_REFUSAL, intent, verified: true, references: [] };
  }

  return null;
}

async function answerMyNotifications(
  query: string,
  userId: string
): Promise<ChatSuccess> {
  const q = normalizeQuery(query);
  const asksUnreadCount = /\bberapa\b/.test(q) && /\b(?:belum\s+dibaca|unread)\b/.test(q);

  const findMany =
    typeof prisma.notification?.findMany === "function"
      ? prisma.notification.findMany.bind(prisma.notification)
      : null;
  if (!findMany) {
    return {
      message: "Data notifikasi belum dapat diakses saat ini. Silakan coba lagi.",
      intent: "MY_PROFILE",
      verified: true,
      references: [],
    };
  }

  try {
    const notifications = (await findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    })) as Array<{
      title: string;
      message: string;
      type: string;
      isRead: boolean;
      createdAt: Date;
    }>;

    const countFn =
      typeof prisma.notification?.count === "function"
        ? prisma.notification.count.bind(prisma.notification)
        : null;
    const unreadCount = countFn
      ? ((await countFn({ where: { userId, isRead: false } })) as number)
      : notifications.filter((n) => !n.isRead).length;

    if (asksUnreadCount) {
      return {
        message: `Ada ${unreadCount} notifikasi yang belum dibaca.`,
        intent: "MY_PROFILE",
        verified: true,
        references: [],
      };
    }

    if (notifications.length === 0) {
      return {
        message: "Tidak ada notifikasi untuk akun Anda.",
        intent: "MY_PROFILE",
        verified: true,
        references: [],
      };
    }

    const lines = notifications.map((n) => {
      const status = n.isRead ? "sudah dibaca" : "belum dibaca";
      return `- ${n.title}: ${n.message} (${status}, ${formatWibDateTime(n.createdAt)})`;
    });

    return {
      message: `Notifikasi Anda:\n\n${lines.join("\n")}\n\nTotal ${unreadCount} notifikasi belum dibaca.`,
      intent: "MY_PROFILE",
      verified: true,
      references: [],
    };
  } catch {
    return {
      message: "Data notifikasi belum dapat diakses saat ini. Silakan coba lagi.",
      intent: "MY_PROFILE",
      verified: true,
      references: [],
    };
  }
}

async function answerPersonal(
  intent: Intent,
  query: string,
  userId: string,
  role: string
): Promise<ChatSuccess | null> {
  if (intent === "MY_HISTORY" && isMyHistoryTotalsQuery(query)) {
    try {
      const totals = await getUserHistoryTotals(userId);
      return {
        message:
          `Total riwayat peminjamanmu: **${totals.total}** transaksi ` +
          `(${totals.physicalTotal} buku fisik + ${totals.ebookTotal} ebook).`,
        intent,
        verified: true,
        references: [],
      };
    } catch (dbError) {
      console.error("[AI] Gagal mengambil total riwayat pengguna.", dbError);
      return {
        message: PERSONAL_DATA_UNAVAILABLE,
        intent,
        verified: true,
        references: [],
      };
    }
  }

  if (intent === "MY_PROFILE") {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, role: true, class: true, identityNumber: true, email: true },
      });
      if (!user) {
        return {
          message: "Profil akun tidak ditemukan.",
          intent: "MY_PROFILE",
          verified: true,
          references: [],
        };
      }
      const roleLabels: Record<string, string> = {
        STUDENT: "Siswa",
        TEACHER: "Guru",
        LIBRARIAN: "Pustakawan",
        ADMIN: "Administrator",
      };
      const roleName = roleLabels[user.role] || user.role;
      let msg = `Anda terdaftar sebagai **${user.name}** (${roleName}).`;
      if (user.class) msg += `\n- Kelas: ${user.class}`;
      if (user.identityNumber) msg += `\n- Nomor Identitas (NIS/NIP): ${user.identityNumber}`;
      else msg += `\n- Nomor Identitas (NIS/NIP): belum tercatat di sistem.`;
      if (user.email) msg += `\n- Email: ${user.email}`;
      return {
        message: msg,
        intent: "MY_PROFILE",
        verified: true,
        references: [],
      };
    } catch {
      return {
        message: PERSONAL_DATA_UNAVAILABLE,
        intent: "MY_PROFILE",
        verified: true,
        references: [],
      };
    }
  }
  if (intent !== "MY_LOANS" && intent !== "MY_HISTORY" && intent !== "MY_FINES") {
    return null;
  }

  // ADMIN dan PUSTAKAWAN bukan peminjam untuk pinjaman/riwayat. Namun mereka
  // tetap bisa memiliki DENDA pribadi (mis. transaksi lama atau akun yang juga
  // pernah meminjam). Karena itu MY_FINES selalu diperiksa dari `userId` sesi;
  // pesan "bukan peminjam" hanya dipakai bila hasil query denda benar-benar
  // kosong. Jangan pernah menjawab "tidak punya denda" tanpa memeriksa data.
  const isStaffFineQuery =
    intent === "MY_FINES" && (role === "ADMIN" || role === "LIBRARIAN");
  const nonBorrowerMessage = nonBorrowerPersonalMessage(role);
  if (nonBorrowerMessage && !isStaffFineQuery) {
    return {
      message: nonBorrowerMessage,
      intent,
      verified: true,
      references: [],
    };
  }

  try {
    const answer = await buildPersonalAnswer(intent, query, userId);
    if (intent === "MY_FINES" && answer.message === NO_FINES) {
      const noFinesMessage = nonBorrowerNoFinesMessage(role);
      if (noFinesMessage) {
        return {
          message: noFinesMessage,
          intent,
          verified: true,
          references: [],
        };
      }
    }
    return {
      message: answer.message,
      intent,
      verified: true,
      references: answer.references,
    };
  } catch (dbError) {
    console.error("[AI] Gagal mengambil data pribadi pengguna.", dbError);
    return {
      message: PERSONAL_DATA_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }
}

/**
 * Jawaban deterministik untuk pertanyaan TARIF denda (keterlambatan/kerusakan).
 * Nominal dibaca dari pengaturan aktif oleh `buildFineRateAnswer`; fungsi ini
 * hanya memetakan kegagalan pembacaan menjadi pesan keterbatasan — bukan angka
 * bawaan yang mungkin tidak berlaku.
 */
async function answerFineRate(intent: Intent, query: string): Promise<ChatSuccess> {
  try {
    const answer = await buildFineRateAnswer(query);
    return {
      message: answer.message,
      intent,
      verified: true,
      references: [],
    };
  } catch (dbError) {
    console.error("[AI] Gagal membaca tarif denda.", dbError);
    return {
      message: FINE_RATE_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }
}

/**
 * Jawaban deterministik untuk pertanyaan transaksi MILIK SENDIRI pada satu
 * tanggal ("saya meminjam apa kemarin?", "kapan saya pinjam buku 18 Oktober?",
 * atau lanjutan singkat "kemarin?" setelah konteks pribadi).
 *
 * Semua judul/status/waktu berasal dari `getMyBorrowsByDate` yang sudah
 * dibatasi ke `userId` sesi, sehingga model TIDAK pernah mengarang transaksi
 * bertanggal untuk pengguna. Bila tidak ada tanggal yang dapat dipahami,
 * mengembalikan `null` agar diteruskan ke jalur personal biasa.
 */
async function answerMyBorrowsByDate(
  query: string,
  userId: string,
  role: string,
  hasHistory: boolean,
  previousUserMessages: string[]
): Promise<ChatSuccess | null> {
  if (!isMyBorrowsByDateQuery(query, hasHistory, previousUserMessages)) return null;

  const nonBorrowerMessage = nonBorrowerPersonalMessage(role);
  if (nonBorrowerMessage) {
    return {
      message: nonBorrowerMessage,
      intent: "MY_HISTORY",
      verified: true,
      references: [],
    };
  }

  // Satu tanggal lengkap diprioritaskan; bila pengguna hanya menyebut
  // bulan/tahun ("pinjaman saya bulan Oktober"), pakai periode tersebut agar
  // jawaban tidak salah menjadi "tidak ada peminjaman aktif".
  const range = resolveStatsPeriod(query);
  if (!range) {
    const day = extractPartialDay(query);
    if (day === null) return null;
    const year = jakartaYearNow();
    const paddedDay = String(day).padStart(2, "0");
    return {
      message:
        `Permintaanmu menyebut tanggal "${day}" tanpa bulan dan tahun, sehingga saya ` +
        `belum dapat menentukan transaksi yang dimaksud. Mohon sebutkan tanggal ` +
        `lengkapnya, misalnya "tanggal ${day} Oktober ${year}" atau "${year}-10-${paddedDay}".`,
      intent: "MY_HISTORY",
      verified: true,
      references: [],
    };
  }

  try {
    const items = await getMyBorrowsByDate(userId, range.start, range.end);
    const asksCount = /\b(berapa|jumlah|total|banyak)\b/.test(normalizeQuery(query));
    const answer = buildMyBorrowsByDateAnswer(range.label, items, asksCount);
    return {
      message: answer.message,
      intent: "MY_HISTORY",
      verified: true,
      references: answer.references.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        coverUrl: null,
        available: null,
      })),
    };
  } catch (dbError) {
    console.error("[AI] Gagal mengambil transaksi pribadi per tanggal.", dbError);
    return {
      message: PERSONAL_DATA_UNAVAILABLE,
      intent: "MY_HISTORY",
      verified: true,
      references: [],
    };
  }
}

/** Label ramah untuk pengaturan sistem non-sensitif yang boleh ditampilkan Admin. */
const SETTING_LABELS: Record<string, string> = {
  finePerDayIDR: "Tarif denda keterlambatan per hari (Rupiah)",
};

/** Jenis denda yang dimaksud pengguna: keterlambatan, kerusakan, atau keduanya. */
function detectFineType(query: string): "LATE" | "DAMAGE" | "ALL" {
  const q = ` ${normalizeQuery(query)} `;
  const late = /\b(keterlambatan|terlambat|telat|overdue)\b/.test(q);
  const damage = /\b(kerusakan|rusak)\b/.test(q);
  if (late && !damage) return "LATE";
  if (damage && !late) return "DAMAGE";
  return "ALL";
}

interface FineOverviewRecord {
  bookId?: string;
  title: string;
  author: string;
  userName: string;
  userRole?: string;
  amount: number;
  lateAmount: number;
  damageAmount: number;
  daysLate: number;
  outstanding: number;
  status: string;
}

/**
 * Jawaban denda operasional (Pustakawan/Admin) yang DIBANGUN dari hasil query
 * database aktual — bukan tebakan model. Denda keterlambatan dan kerusakan
 * dipisahkan agar pertanyaan "denda keterlambatan" tidak pernah dijawab dengan
 * data denda kerusakan. Bila tidak ada data yang cocok, dinyatakan jujur; bila
 * query gagal, keterbatasan disampaikan (error TIDAK diubah menjadi "tidak ada
 * denda").
 */
async function answerFinesOperational(
  intent: Intent,
  query: string,
  role: string,
  userId: string
): Promise<ChatSuccess> {
  const type = detectFineType(query);
  const raw = await executeTool("get_fines_overview", { type }, userId, role);
  const data = JSON.parse(raw) as {
    count?: number;
    totalOutstanding?: number;
    totalAssessed?: number;
    totalPaid?: number;
    userCount?: number;
    fines?: FineOverviewRecord[];
    error?: string;
  };

  if (data.error || typeof data.count !== "number" || !Array.isArray(data.fines)) {
    return { message: OPERATIONAL_FINES_UNAVAILABLE, intent, verified: true, references: [] };
  }

  const typeLabel =
    type === "LATE" ? "keterlambatan" : type === "DAMAGE" ? "kerusakan" : null;

  const q = normalizeQuery(query);
  const wantsList = /\b(tampilkan|daftar|sebutkan|list|rincian|detail)\b/.test(q);
  const asksNames = /\bsiapa\b/.test(q);
  if (!wantsList) {
    const typeText = typeLabel ? ` ${typeLabel}` : "";
    if (/\b(?:pengguna|user|orang)\b/.test(q) && /\b(?:berapa|jumlah|total)\b/.test(q)) {
      return {
        message: `Ada ${data.userCount ?? 0} pengguna dengan denda${typeText} yang tercatat di sistem.`,
        intent,
        verified: true,
        references: [],
      };
    }
    if (/\b(?:transaksi|catatan|record)\b/.test(q) && /\b(?:berapa|jumlah|total)\b/.test(q)) {
      return {
        message: `Ada ${data.count ?? 0} transaksi dengan denda${typeText} yang tercatat di sistem.`,
        intent,
        verified: true,
        references: [],
      };
    }
    if (/\b(?:sisa|tunggakan|belum dibayar|outstanding)\b/.test(q)) {
      return {
        message: `Total denda${typeText} yang belum dibayar: ${formatRupiah(data.totalOutstanding ?? 0)}.`,
        intent,
        verified: true,
        references: [],
      };
    }
    if (/\b(?:dibayar|lunas|terbayar)\b/.test(q)) {
      return {
        message: `Total denda${typeText} yang sudah dibayar: ${formatRupiah(data.totalPaid ?? 0)}.`,
        intent,
        verified: true,
        references: [],
      };
    }
    if (/\b(?:total|jumlah|berapa)\b/.test(q) && /\bdenda\b/.test(q)) {
      return {
        message: `Total denda${typeText} yang tercatat: ${formatRupiah(data.totalAssessed ?? 0)}.`,
        intent,
        verified: true,
        references: [],
      };
    }
  }

  if (data.fines.length === 0) {
    const message = typeLabel
      ? `Tidak ada denda ${typeLabel} yang tercatat di sistem.`
      : "Tidak ada denda yang tercatat di sistem.";
    return { message, intent, verified: true, references: [] };
  }

  const lines = data.fines.map((fine) => {
    const reasons: string[] = [];
    if (fine.lateAmount > 0) {
      reasons.push(`keterlambatan ${fine.daysLate} hari (${formatRupiah(fine.lateAmount)})`);
    }
    if (fine.damageAmount > 0) {
      reasons.push(`kerusakan (${formatRupiah(fine.damageAmount)})`);
    }
    const status =
      fine.status === "PAID"
        ? "lunas"
        : fine.status === "PARTIAL"
          ? `dibayar sebagian, sisa ${formatRupiah(fine.outstanding)}`
          : `belum dibayar (${formatRupiah(fine.outstanding)})`;
    return `- ${fine.userName} — ${fine.title}: ${reasons.join(" + ") || "denda tercatat"} — ${status}`;
  });

  const outstanding = typeof data.totalOutstanding === "number" ? data.totalOutstanding : 0;
  // Bila hasil dibatasi `TOOL_ROW_LIMIT`, nyatakan jumlah total yang sebenarnya
  // agar daftar tidak diklaim lengkap. Pola ini sama dengan answerOverdueOperational.
  const shown = data.fines.length;
  const total = typeof data.count === "number" && data.count >= shown ? data.count : shown;
  const truncatedNote = total > shown ? ` (menampilkan ${shown} teratas dari ${total})` : "";
  const header = `${typeLabel ? `Denda ${typeLabel} yang tercatat` : "Denda yang tercatat"}${truncatedNote}:`;
  const footer =
    outstanding > 0
      ? `\n\nTotal denda yang belum dibayar: ${formatRupiah(outstanding)}.`
      : "\n\nSemua denda tersebut sudah lunas.";

  const seen = new Set<string>();
  const references: ChatReference[] = [];
  for (const fine of data.fines) {
    if (typeof fine.bookId === "string" && !seen.has(fine.bookId)) {
      seen.add(fine.bookId);
      references.push({
        id: fine.bookId,
        title: fine.title,
        author: fine.author,
        coverUrl: null,
        available: null,
      });
    }
  }

  return {
    message: `${header}\n\n${lines.join("\n")}${footer}`,
    intent,
    verified: true,
    references,
  };
}

/**
 * Label status transaksi peminjaman untuk jawaban Pustakawan/Admin.
 * Statusnya disalin apa adanya dari database — tidak ada interpretasi.
 */
const BORROW_STATUS_LABEL: Record<string, string> = {
  BORROWED: "sedang dipinjam",
  OVERDUE: "terlambat",
  RETURNED: "sudah dikembalikan",
};

/**
 * Status untuk daftar KETERLAMBATAN. Semua baris pada daftar itu berasal dari
 * filter "status BORROWED/OVERDUE dan jatuh tempo sudah lewat, belum
 * dikembalikan", jadi statusnya tidak boleh disebut "sedang dipinjam" — itu
 * bertentangan dengan judul daftar dan menyembunyikan keterlambatan. Label
 * disamakan dengan `describeBorrowStatus` agar konsisten di seluruh jawaban.
 */
function describeOverdueStatus(status: string): string {
  if (status === "BORROWED" || status === "OVERDUE") {
    return "terlambat (belum dikembalikan)";
  }
  return BORROW_STATUS_LABEL[status] ?? status.toLowerCase();
}

/**
 * Status peminjaman yang AKTUAL untuk ditampilkan: tidak menyimpulkan "sedang
 * dipinjam" hanya karena ada tanggal pinjam. Bila `returnDate` terisi, transaksi
 * sudah dikembalikan; bila belum dan jatuh tempo sudah lewat, transaksi
 * terlambat (belum dikembalikan).
 */
function describeBorrowStatus(
  borrow: { status: string; returnDate: Date | null; dueDate: Date },
  now: Date
): string {
  if (borrow.returnDate || borrow.status === "RETURNED") return "sudah dikembalikan";
  if (borrow.status === "OVERDUE") return "terlambat (belum dikembalikan)";
  if (borrow.dueDate.getTime() < now.getTime()) return "terlambat (belum dikembalikan)";
  if (borrow.status === "BORROWED") return "sedang dipinjam";
  return BORROW_STATUS_LABEL[borrow.status] ?? borrow.status.toLowerCase();
}

const EBOOK_LOAN_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "masa akses aktif",
  RETURNED: "sudah dikembalikan",
  EXPIRED: "kedaluwarsa",
};

/**
 * Label status ebook yang AKTUAL untuk ditampilkan. Status diturunkan dari
 * timestamp (getEbookAccessState) — bukan dari kolom `status` yang baru
 * disinkronkan secara lazy — agar ebook yang masa aksesnya sudah berakhir TIDAK
 * disebut "sedang dibaca". Label ACTIVE sengaja "masa akses aktif": loan aktif
 * BUKAN bukti aktivitas membaca. Aktivitas membaca dicatat terpisah pada
 * EbookReadingSession.
 */
function describeEbookLoanStatus(
  loan: { borrowedAt: Date; returnedAt: Date | null; expiresAt: Date },
  now: Date
): string {
  const state = getEbookAccessState(loan, now);
  return EBOOK_LOAN_STATUS_LABEL[state] ?? state.toLowerCase();
}

const ROLE_LABEL: Record<string, string> = {
  STUDENT: "Siswa",
  TEACHER: "Guru",
  LIBRARIAN: "Pustakawan",
  ADMIN: "Administrator",
  STAFF: "Staf",
};

/** Role pengguna yang diminta pada pertanyaan jumlah pengguna, bila disebut. */
function detectUserRoleFilter(query: string): string | null {
  const q = ` ${normalizeQuery(query)} `;
  if (/\b(admin|administrator)(?:nya)?\b/.test(q)) return "ADMIN";
  if (/\b(pustakawan|librarian)(?:nya)?\b/.test(q)) return "LIBRARIAN";
  if (/\b(guru|teacher|tenaga\s+pendidik)(?:nya)?\b/.test(q)) return "TEACHER";
  if (/\b(siswa|murid|student|pelajar)(?:nya)?\b/.test(q)) return "STUDENT";
  if (/\b(staf|staff)(?:nya)?\b/.test(q)) return "STAFF";
  return null;
}

/** Filter status akun: aktif / nonaktif, atau null bila tidak disebut. */
function detectUserActiveFilter(query: string): boolean | null {
  const q = ` ${normalizeQuery(query)} `;
  if (/\b(nonaktif|non-aktif|tidak\s+aktif|belum\s+aktif|inactive)\b/.test(q)) return false;
  if (/\b(aktif|active)\b/.test(q)) return true;
  return null;
}

/** Kata yang mengakhiri frasa kelas pada pertanyaan pengguna. */
const CLASS_FILTER_STOPWORDS = new Set([
  "yang",
  "di",
  "pada",
  "untuk",
  "dan",
  "atau",
  "dengan",
  "dari",
  "itu",
  "ini",
  "ada",
  "berapa",
  "jumlah",
  "total",
  "siswa",
  "murid",
  "pengguna",
  "orang",
  "terdaftar",
  "aktif",
  "nonaktif",
  "laki",
  "perempuan",
  "pria",
  "wanita",
  "male",
  "female",
  "putra",
  "putri",
  "tahun",
  "bulan",
]);

/**
 * Filter kelas dari pertanyaan, mis. "kelas XII IPA 1" / "kelas 12 ipa 1".
 * Angka 10/11/12 dinormalisasi ke X/XI/XII agar cocok dengan `User.class`.
 * `exact` false berarti awalan (mis. "XII" atau "XII IPA").
 */
function detectUserClassFilter(
  query: string
): { value: string; exact: boolean } | null {
  const q = ` ${normalizeQuery(query)} `;
  const match = /\bkelas\s+([a-z0-9]+(?:\s+[a-z0-9]+){0,5})/.exec(q);
  if (!match) return null;

  const tokens: string[] = [];
  for (const token of match[1].split(/\s+/)) {
    if (!token || CLASS_FILTER_STOPWORDS.has(token)) break;
    tokens.push(token);
  }
  if (tokens.length === 0) return null;

  const romanByNumber: Record<string, string> = { "10": "X", "11": "XI", "12": "XII" };
  const first = romanByNumber[tokens[0]] ?? tokens[0];
  const value = [first, ...tokens.slice(1)].map((token) => token.toUpperCase()).join(" ");
  return { value, exact: tokens.length >= 3 };
}

/**
 * Buang kata kunci kelas dari hasil `extractUserLookupTerm`.
 *
 * Contoh: "Siapa saja siswa kelas XII IPA 1?" → kata kunci mentah
 * "kelas xii ipa". Kelas sudah diterapkan sebagai filter `class`, sehingga
 * menyisakannya sebagai `search` membuat query mencari nama/email/NIS yang
 * mengandung "kelas xii ipa" dan (salah) melaporkan tidak ada pengguna.
 * Kata kunci nama yang tersisa (mis. "Budi kelas XII IPA 1") tetap dipertahankan.
 */
function removeClassTokensFromSearch(
  search: string | null,
  classValue: string | null
): string | null {
  if (!search) return null;
  if (!classValue) return search;
  const classTokens = new Set(["kelas", ...classValue.toLowerCase().split(/\s+/)]);
  const kept = search
    .split(/\s+/)
    .filter((token) => token.length > 0 && !classTokens.has(token.toLowerCase()));
  return kept.length > 0 ? kept.join(" ") : null;
}

/** Filter gender dari pertanyaan, atau null bila tidak disebut. */
function detectUserGenderFilter(query: string): "MALE" | "FEMALE" | null {
  const q = ` ${normalizeQuery(query)} `;
  if (/\b(perempuan|wanita|female|putri)\b/.test(q)) return "FEMALE";
  if (/\b(laki\s*laki|pria|male|putra)\b/.test(q)) return "MALE";
  return null;
}

/**
 * Atribut pengguna yang tidak tersedia pada data. Mengembalikan label atribut
 * agar jawaban menyatakan keterbatasan, bukan menjawab total umum.
 */
function detectUnsupportedUserFilter(query: string): string | null {
  const q = ` ${normalizeQuery(query)} `;
  if (
    /\bkelas\b[^?]*\b(?:dan|atau)\b\s+(?:kelas\s+)?(?:x|xi|xii|10|11|12)\b/.test(q)
  ) {
    return "lebih dari satu kelas";
  }
  if (/\b(jurusan|program\s+keahlian|kompetensi\s+keahlian)\b/.test(q)) {
    return "jurusan";
  }
  if (/\b(agama|umur|usia|tahun\s+lahir|tanggal\s+lahir)\b/.test(q)) {
    return "atribut tersebut";
  }
  return null;
}

/**
 * Jawaban deterministik jumlah pengguna (khusus ADMIN). Angka selalu berasal
 * dari database melalui tool `get_user_count`. Bila pengguna hanya menanyakan
 * satu role/periode/status, jawaban TIDAK menampilkan rincian role lain.
 */
async function answerUserCount(
  intent: Intent,
  query: string,
  userId: string,
  role: string
): Promise<ChatSuccess> {
  // Sabuk pengaman ganda: answerRefusal sudah menolak non-ADMIN sebelum query.
  if (role !== "ADMIN") {
    return { message: USER_COUNT_ADMIN_ONLY, intent, verified: true, references: [] };
  }

  const roleFilter = detectUserRoleFilter(query);
  const isActive = detectUserActiveFilter(query);
  const period = resolveStatsPeriod(query);
  const classFilter = detectUserClassFilter(query);
  const genderFilter = detectUserGenderFilter(query);
  const unsupportedFilter = detectUnsupportedUserFilter(query);

  // Jangan menjawab total umum bila pengguna meminta filter yang tidak dapat
  // diterapkan; itu akan menjadi jawaban yang menyesatkan.
  if (unsupportedFilter) {
    return {
      message: USER_COUNT_FILTER_UNSUPPORTED,
      intent,
      verified: true,
      references: [],
    };
  }
  if (/\bkelas\b/.test(` ${normalizeQuery(query)} `) && !classFilter) {
    return {
      message: USER_COUNT_FILTER_UNSUPPORTED,
      intent,
      verified: true,
      references: [],
    };
  }

  const args: Record<string, unknown> = {};
  if (roleFilter) args.role = roleFilter;
  if (isActive !== null) args.isActive = isActive;
  if (period) args.period = period.key;
  if (classFilter) args.class = classFilter.value;
  if (genderFilter) args.gender = genderFilter;

  const raw = await executeTool("get_user_count", args, userId, role);
  let data: {
    totalUsers?: number;
    byRole?: Record<string, number>;
    error?: string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return { message: USER_COUNT_UNAVAILABLE, intent, verified: true, references: [] };
  }

  if (data.error || !data.byRole || typeof data.byRole !== "object") {
    return { message: USER_COUNT_UNAVAILABLE, intent, verified: true, references: [] };
  }

  const summaryRoles: Array<[string, string]> = [
    ["ADMIN", "Administrator"],
    ["LIBRARIAN", "Pustakawan"],
    ["TEACHER", "Guru"],
    ["STUDENT", "Siswa"],
    ["STAFF", "Staf"],
  ];

  const requestedKeys = roleFilter ? [roleFilter] : summaryRoles.map(([key]) => key);
  const counts = requestedKeys.map((key) => data.byRole?.[key]);
  if (
    counts.some(
      (count) => typeof count !== "number" || !Number.isFinite(count) || count < 0
    )
  ) {
    return { message: USER_COUNT_UNAVAILABLE, intent, verified: true, references: [] };
  }

  // Total = penjumlahan hitungan yang diminta (tidak ada penghitungan ganda).
  const total = counts.reduce<number>((sum, count) => sum + (count as number), 0);

  const scopeParts: string[] = [];
  if (genderFilter === "MALE") scopeParts.push("laki-laki");
  if (genderFilter === "FEMALE") scopeParts.push("perempuan");
  if (isActive === true) scopeParts.push("aktif");
  if (isActive === false) scopeParts.push("nonaktif");
  if (classFilter) scopeParts.push(`kelas ${classFilter.value}`);
  if (period) scopeParts.push(`terdaftar ${period.label}`);
  const scope = scopeParts.length > 0 ? ` ${scopeParts.join(" ")}` : " terdaftar";
  const roleName = roleFilter ? ROLE_LABEL[roleFilter] ?? roleFilter : null;

  if (roleName) {
    return {
      message: `Jumlah ${roleName.toLowerCase()}${scope} di DigiLib: **${total}** pengguna.`,
      intent,
      verified: true,
      references: [],
    };
  }

  const wantsDetail = /\b(rincian|detail|per\s*role|breakdown|sebaran|daftar)\b/i.test(query);
  const lines = summaryRoles.map(
    ([key, label], index) => `- ${label}: ${counts[index] as number}`
  );

  if (!wantsDetail) {
    return {
      message: `Jumlah pengguna${scope} di DigiLib: **${total}** pengguna.`,
      intent,
      verified: true,
      references: [],
    };
  }

  return {
    message:
      `Jumlah pengguna${scope} di DigiLib: **${total}** pengguna.\n\n` +
      lines.join("\n"),
    intent,
    verified: true,
    references: [],
  };
}

/** Label aksi AuditLog akun untuk jawaban yang mudah dibaca. */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  CREATE_USER: "dibuat",
  REGISTER_STUDENT: "didaftarkan sendiri",
  DELETE_USER: "dihapus",
  USER_DELETED: "dihapus",
  DEACTIVATE_USER: "dinonaktifkan",
  USER_DEACTIVATED: "dinonaktifkan",
};

/**
 * Tentukan apakah pertanyaan adalah pertanyaan transaksi per-tanggal dan atas
 * dasar tanggal apa (pinjam atau kembali). Mengembalikan null bila bukan.
 *
 * Urutan penting: pertanyaan PENGEMBALIAN diprioritaskan karena kata "transaksi"
 * juga cocok dengan kata kerja peminjaman. Lanjutan bertanggal yang hanya
 * menyebut tanggal memakai konteks percakapan (lihat
 * `detectTransactionsByDateFollowUpBasis`).
 */
function detectTransactionDateBasis(
  query: string,
  hasHistory: boolean,
  previousUserMessages: string[]
): "BORROW" | "RETURN" | null {
  if (isReturnsByDateQuery(query)) return "RETURN";
  if (isBorrowsByDateQuery(query)) return "BORROW";
  return detectTransactionsByDateFollowUpBasis(query, hasHistory, previousUserMessages);
}

/**
 * Jawaban deterministik untuk pertanyaan transaksi per-tanggal
 * ("siapa yang meminjam buku pada tanggal X" / "siapa yang mengembalikan buku
 * pada tanggal X") bagi Pustakawan/Admin. Jawaban DIBANGUN dari transaksi aktual
 * pada rentang hari Asia/Jakarta — bukan dari daftar transaksi terbaru dan bukan
 * karangan model.
 *
 * Dasar tanggal mengikuti jenis riwayat yang ditanyakan dan selalu dinyatakan
 * eksplisit: pertanyaan PEMINJAMAN difilter & ditampilkan menurut tanggal
 * pinjam; pertanyaan PENGEMBALIAN menurut tanggal kembali. Jenis transaksi tidak
 * pernah dicampur tanpa label.
 *
 * Kontrak:
 * - Tidak ada tanggal yang dapat dipahami → `null` (diteruskan ke jalur model).
 * - Tanggal parsial ("tanggal 18") → minta pengguna melengkapi bulan/tahun,
 *   JANGAN menebak.
 * - Query kosong → dinyatakan jujur "tidak ada transaksi pada tanggal itu".
 * - Query gagal → `OPERATIONAL_BORROWS_UNAVAILABLE` (bukan "tidak ada").
 * - Buku yang sudah diarsipkan tetap ditampilkan (riwayat tetap valid) dengan
 *   penanda arsip.
 */
async function answerTransactionsByDateOperational(
  intent: Intent,
  query: string,
  userId: string,
  hasHistory: boolean,
  previousUserMessages: string[]
): Promise<ChatSuccess | null> {
  const basis = detectTransactionDateBasis(query, hasHistory, previousUserMessages);
  if (!basis) return null;

  let range: any = resolveJakartaDateRange(query);
  if (!range) {
    const period = resolveStatsPeriod(query);
    if (period) {
      range = {
        start: period.start,
        end: period.end,
        key: period.key,
        label: period.label,
      } as any;
    } else {
      const day = extractPartialDay(query);
      if (day === null) return null;
      const year = jakartaYearNow();
      const paddedDay = String(day).padStart(2, "0");
      return {
        message:
          `Permintaan Anda menyebut tanggal "${day}" tanpa bulan dan tahun, sehingga saya ` +
          `belum dapat menentukan transaksi yang dimaksud. Mohon sebutkan tanggal lengkapnya, ` +
          `misalnya "tanggal ${day} Oktober ${year}" atau "${year}-10-${paddedDay}".`,
        intent,
        verified: true,
        references: [],
      };
    }
  }

  const isReturn = basis === "RETURN";
  const noun = isReturn ? "pengembalian" : "peminjaman";
  const basisText = isReturn ? "berdasarkan tanggal kembali" : "berdasarkan tanggal pinjam";
  const now = new Date();

  try {
    const [borrows, ebookLoans] = await Promise.all([
      prisma.borrowRecord.findMany({
        where: isReturn
          ? { returnDate: { gte: range.start, lt: range.end } }
          : {
              status: { in: ["BORROWED", "OVERDUE", "RETURNED"] },
              borrowDate: { gte: range.start, lt: range.end },
            },
        include: {
          book: { select: { id: true, title: true, author: true, archivedAt: true } },
          user: { select: { name: true, role: true } },
        },
        orderBy: isReturn ? { returnDate: "asc" } : { borrowDate: "asc" },
      }),
      prisma.ebookLoan.findMany({
        where: isReturn
          ? { returnedAt: { gte: range.start, lt: range.end } }
          : { borrowedAt: { gte: range.start, lt: range.end } },
        include: {
          book: { select: { id: true, title: true, author: true, archivedAt: true } },
          user: { select: { name: true, role: true } },
        },
        orderBy: isReturn ? { returnedAt: "asc" } : { borrowedAt: "asc" },
      }),
    ]);

    if (borrows.length === 0 && ebookLoans.length === 0) {
      return {
        message:
          `Tidak ada transaksi ${noun} yang tercatat pada ${range.label} ` +
          `(${basisText}, waktu Asia/Jakarta).`,
        intent,
        verified: true,
        references: [],
      };
    }

    const lines: string[] = [];
    const references: ChatReference[] = [];
    const seenBookIds = new Set<string>();

    const addReference = (book: { id: string; title: string; author: string }) => {
      if (seenBookIds.has(book.id)) return;
      seenBookIds.add(book.id);
      references.push({ id: book.id, title: book.title, author: book.author, coverUrl: null, available: null });
    };

    const action = isReturn ? "dikembalikan" : "dipinjam";

    for (const b of borrows) {
      const roleName = ROLE_LABEL[b.user.role] ?? b.user.role;
      const when = isReturn ? b.returnDate : b.borrowDate;
      const status = describeBorrowStatus(b, now);
      const archiveNote = b.book.archivedAt ? " — buku arsip (riwayat tetap valid)" : "";
      lines.push(
        `- ${b.user.name} (${roleName}) — "${b.book.title}" — ${action} pukul ${formatWibTime(
          when as Date
        )} WIB — ${status}${archiveNote}`
      );
      addReference(b.book);
    }

    for (const l of ebookLoans) {
      const roleName = ROLE_LABEL[l.user.role] ?? l.user.role;
      const when = isReturn ? l.returnedAt : l.borrowedAt;
      const status = describeEbookLoanStatus(l, now);
      const archiveNote = l.book.archivedAt ? " — buku arsip (riwayat tetap valid)" : "";
      lines.push(
        `- ${l.user.name} (${roleName}) — "${l.book.title}" (ebook) — ${action} pukul ${formatWibTime(
          when as Date
        )} WIB — ${status}${archiveNote}`
      );
      addReference(l.book);
    }

    const total = borrows.length + ebookLoans.length;
    return {
      message:
        `Transaksi ${noun} pada ${range.label} (${basisText}, waktu Asia/Jakarta):\n\n` +
        `${lines.join("\n")}\n\nTotal ${total} transaksi.`,
      intent,
      verified: true,
      references,
    };
  } catch (dbError) {
    console.error("[AI] Gagal mengambil transaksi per tanggal.", dbError);
    return {
      message: OPERATIONAL_BORROWS_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }
}

/**
 * Jawaban deterministik untuk pertanyaan keterlambatan GLOBAL
 * ("Buku apa saja yang sedang terlambat?") bagi Pustakawan/Admin.
 *
 * Data diambil dari tool `get_overdue_borrows` (DB aktual) dan disajikan dengan
 * jam/tanggal Asia/Jakarta. Buku yang sudah diarsipkan TIDAK dihilangkan:
 * barisnya tetap ditampilkan dengan penanda arsip selama transaksinya masih
 * berstatus terlambat.
 *
 * Kontrak:
 * - Tidak ada keterlambatan → dinyatakan jujur "tidak ada".
 * - Query gagal → `OPERATIONAL_BORROWS_UNAVAILABLE` (bukan "tidak ada").
 */
async function answerOverdueOperational(
  userId: string,
  role: string
): Promise<ChatSuccess> {
  const raw = await executeTool("get_overdue_borrows", {}, userId, role);

  let data: {
    count?: number;
    total?: number;
    overdue?: Array<{
      bookId?: string;
      title: string;
      author: string;
      status: string;
      dueDate: string;
      userName: string;
      userRole?: string | null;
      archived?: boolean;
    }>;
    error?: string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return {
      message: OPERATIONAL_BORROWS_UNAVAILABLE,
      intent: "OPERATIONAL",
      verified: true,
      references: [],
    };
  }

  // Kegagalan query/otorisasi tidak boleh disamarkan sebagai "tidak ada".
  if (data.error || typeof data.count !== "number" || !Array.isArray(data.overdue)) {
    return {
      message: OPERATIONAL_BORROWS_UNAVAILABLE,
      intent: "OPERATIONAL",
      verified: true,
      references: [],
    };
  }

  if (data.overdue.length === 0) {
    return {
      message:
        "Tidak ada peminjaman yang sedang terlambat dikembalikan saat ini " +
        "(waktu Asia/Jakarta).",
      intent: "OPERATIONAL",
      verified: true,
      references: [],
    };
  }

  const lines = data.overdue.map((item) => {
    const roleName = item.userRole ? ROLE_LABEL[item.userRole] ?? item.userRole : "";
    const who = roleName ? `${item.userName} (${roleName})` : item.userName;
    const status = describeOverdueStatus(item.status);
    const archiveNote = item.archived ? " — buku arsip (riwayat tetap valid)" : "";
    // `dueDate` dari tool sudah memuat zona WIB.
    return `- ${who} — "${item.title}" — jatuh tempo ${item.dueDate} — ${status}${archiveNote}`;
  });

  const references: ChatReference[] = [];
  const seen = new Set<string>();
  for (const item of data.overdue) {
    if (typeof item.bookId !== "string" || seen.has(item.bookId)) continue;
    seen.add(item.bookId);
    references.push({
      id: item.bookId,
      title: item.title,
      author: item.author,
      coverUrl: null,
      available: null,
    });
  }

  const shown = data.overdue.length;
  const total = typeof data.total === "number" && data.total >= shown ? data.total : shown;
  const truncatedNote = total > shown ? ` (menampilkan ${shown} teratas)` : "";

  return {
    message:
      `Peminjaman yang sedang terlambat${truncatedNote}:\n\n` +
      `${lines.join("\n")}\n\nTotal ${total} peminjaman terlambat (waktu Asia/Jakarta).`,
    intent: "OPERATIONAL",
    verified: true,
    references,
  };
}

/**
 * Jawaban deterministik untuk pertanyaan PEMINJAMAN AKTIF seluruh sistem
 * ("buku apa saja yang sedang dipinjam", "peminjaman yang belum dikembalikan",
 * "pinjaman aktif") bagi Pustakawan/Admin.
 *
 * Sumber data adalah tool `get_active_loans` (BorrowRecord berstatus
 * BORROWED/OVERDUE dan EbookLoan dengan masa akses berlaku). Format mengikuti
 * kebijakan produk: default buku fisik, ebook hanya bila disebut eksplisit,
 * ALL bila pengguna meminta semua format.
 *
 * Kontrak:
 * - Data ditemukan → daftar + total sebenarnya (bukan panjang daftar).
 * - Query sukses tetapi kosong → dinyatakan jujur "tidak ada".
 * - Query gagal/otorisasi gagal → `OPERATIONAL_BORROWS_UNAVAILABLE`, TIDAK
 *   pernah disamarkan sebagai "tidak ada".
 */
async function answerActiveLoansOperational(
  intent: Intent,
  query: string,
  userId: string,
  role: string
): Promise<ChatSuccess> {
  const format = resolveTransactionFormat(query);
  const q = normalizeQuery(query);
  // Lanjutan "Yang paling lama siapa?" / "yang paling awal?" menanyakan
  // peminjaman terlama pada daftar peminjam aktif yang barusan dibahas.
  // Urutan ditentukan di query database (bukan dari teks yang sudah diformat).
  const wantsEarliest = /\b(paling\s+lama|terlama|paling\s+awal|paling\s+dulu)\b/.test(q);
  const unavailable: ChatSuccess = {
    message: OPERATIONAL_BORROWS_UNAVAILABLE,
    intent,
    verified: true,
    references: [],
  };

  const raw = await executeTool(
    "get_active_loans",
    wantsEarliest ? { format, order: "EARLIEST" } : { format },
    userId,
    role
  );

  type ActiveRow = {
    bookId?: string | null;
    title: string;
    author?: string;
    statusLabel?: string;
    borrowDate?: string;
    dueDate?: string;
    daysLate?: number;
    daysRemaining?: number;
    userName?: string;
    userRole?: string | null;
    archived?: boolean;
  };
  let data: {
    total?: number;
    shown?: number;
    activeCounts?: { physical?: number; ebook?: number };
    activeBorrows?: ActiveRow[];
    activeEbooks?: ActiveRow[];
    error?: string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return unavailable;
  }

  if (
    data.error ||
    typeof data.total !== "number" ||
    !Array.isArray(data.activeBorrows) ||
    !Array.isArray(data.activeEbooks)
  ) {
    return unavailable;
  }

  const borrowRows = data.activeBorrows;
  const ebookRows = data.activeEbooks;
  const physicalTotal = data.activeCounts?.physical ?? borrowRows.length;
  const ebookTotal = data.activeCounts?.ebook ?? ebookRows.length;
  const totalRelevant =
    format === "PHYSICAL" ? physicalTotal : format === "EBOOK" ? ebookTotal : data.total;
  const shownRelevant =
    format === "PHYSICAL"
      ? borrowRows.length
      : format === "EBOOK"
        ? ebookRows.length
        : borrowRows.length + ebookRows.length;

  if (totalRelevant === 0) {
    const message =
      format === "EBOOK"
        ? "Tidak ada ebook dengan masa akses aktif saat ini (waktu Asia/Jakarta)."
        : format === "ALL"
          ? "Tidak ada peminjaman aktif, baik buku fisik maupun ebook, saat ini (waktu Asia/Jakarta)."
          : "Tidak ada buku fisik yang sedang dipinjam (belum dikembalikan) saat ini (waktu Asia/Jakarta).";
    return { message, intent, verified: true, references: [] };
  }

  // Pertanyaan JUMLAH ("berapa peminjaman aktif?") dijawab angka total, bukan
  // daftar panjang yang tidak diminta.
  const asksCountOnly =
    /\b(berapa|jumlah|total|banyak)\b/.test(q) && !/\bsiapa\b/.test(q);
  if (asksCountOnly) {
    const message =
      format === "EBOOK"
        ? `Saat ini ada ${ebookTotal} ebook dengan masa akses aktif (waktu Asia/Jakarta).`
        : format === "ALL"
          ? `Saat ini ada ${physicalTotal} buku fisik dan ${ebookTotal} ebook yang aktif ` +
            `(${data.total} peminjaman aktif, waktu Asia/Jakarta).`
          : `Saat ini ada ${physicalTotal} buku fisik yang sedang dipinjam (belum dikembalikan, waktu Asia/Jakarta).`;
    return { message, intent, verified: true, references: [] };
  }

  const references: ChatReference[] = [];
  const seenBooks = new Set<string>();
  const addReference = (row: ActiveRow) => {
    if (typeof row.bookId !== "string" || seenBooks.has(row.bookId)) return;
    seenBooks.add(row.bookId);
    references.push({
      id: row.bookId,
      title: row.title,
      author: row.author ?? "",
      coverUrl: null,
      available: null,
    });
  };

  const who = (row: ActiveRow) => {
    if (!row.userName) return "";
    const roleName = row.userRole ? ROLE_LABEL[row.userRole] ?? row.userRole : "";
    return roleName ? `${row.userName} (${roleName})` : row.userName;
  };

  const sections: string[] = [];

  if (format !== "EBOOK") {
    sections.push("**Buku fisik**");
    if (borrowRows.length === 0) {
      sections.push("- Tidak ada buku fisik yang sedang dipinjam (belum dikembalikan).");
    } else {
      for (const row of borrowRows) {
        addReference(row);
        const lateDays = typeof row.daysLate === "number" ? row.daysLate : 0;
        const statusText =
          lateDays > 0
            ? `terlambat ${lateDays} hari (belum dikembalikan)`
            : row.statusLabel ?? "sedang dipinjam";
        const archiveNote = row.archived ? " — buku arsip" : "";
        sections.push(
          `- ${who(row)} — "${row.title}" — dipinjam ${row.borrowDate ?? "-"} — ` +
            `jatuh tempo ${row.dueDate ?? "-"} — ${statusText}${archiveNote}`
        );
      }
    }
  }

  if (format !== "PHYSICAL") {
    if (sections.length > 0) sections.push("");
    sections.push("**Ebook**");
    if (ebookRows.length === 0) {
      sections.push("- Tidak ada ebook dengan masa akses aktif.");
    } else {
      for (const row of ebookRows) {
        addReference(row);
        const remaining =
          typeof row.daysRemaining === "number" ? ` — sisa ${row.daysRemaining} hari` : "";
        const archiveNote = row.archived ? " — buku arsip" : "";
        sections.push(
          `- ${who(row)} — "${row.title}" (ebook) — masa akses berakhir ` +
            `${row.dueDate ?? "-"} — ${row.statusLabel ?? "masa akses aktif"}${remaining}${archiveNote}`
        );
      }
    }
  }

  const truncatedNote =
    totalRelevant > shownRelevant ? ` (menampilkan ${shownRelevant} teratas)` : "";
  const footer =
    format === "PHYSICAL"
      ? `Total ${physicalTotal} buku fisik sedang dipinjam (waktu Asia/Jakarta).`
      : format === "EBOOK"
        ? `Total ${ebookTotal} ebook dengan masa akses aktif (waktu Asia/Jakarta).`
        : `Total ${physicalTotal} buku fisik + ${ebookTotal} ebook = ${data.total} peminjaman aktif ` +
          `(waktu Asia/Jakarta).`;

  return {
    message:
      `Peminjaman aktif${wantsEarliest ? " (diurutkan dari peminjaman paling lama)" : ""}${truncatedNote}:\n\n` +
      `${sections.join("\n")}\n\n${footer}`,
    intent,
    verified: true,
    references,
  };
}

/**
 * Jawaban deterministik untuk pertanyaan RIWAYAT AUDIT pembuatan/penghapusan
 * akun pengguna. HANYA ADMIN.
 *
 * Keamanan:
 * - Diperiksa ulang di sini (selain di answerRefusal) bahwa role = ADMIN; role
 *   lain menerima `AUDIT_ADMIN_ONLY` tanpa query apa pun.
 * - Data diambil dari tool `get_user_audit_history` (AuditLog aktual), bukan
 *   dari ingatan model maupun konteks percakapan.
 * - Tidak menampilkan password/token/secret; hanya identitas akun, pelaku,
 *   aksi, dan waktu.
 *
 * Kontrak:
 * - Tanggal parsial ambigu ("tanggal 18") → minta pelengkapan, JANGAN menebak.
 * - Kosong → dinyatakan jujur "tidak ada catatan audit" untuk filter tersebut.
 * - Query gagal → `USER_AUDIT_UNAVAILABLE` (bukan "tidak ada").
 */
async function answerUserAuditOperational(
  query: string,
  userId: string,
  role: string
): Promise<ChatSuccess> {
  // Sabuk pengaman ganda: fungsi ini hanya boleh dijalankan untuk ADMIN.
  if (role !== "ADMIN") {
    return { message: AUDIT_ADMIN_ONLY, intent: "USER_AUDIT", verified: true, references: [] };
  }

  // Perioda hari/bulan/tahun ("3 September", "September 2026", "2026") →
  // gunakan resolveStatsPeriod agar audit per bulan/tahun juga didukung.
  const period = resolveStatsPeriod(query);
  const range = period
    ? { start: period.start, end: period.end, key: period.key, label: period.label }
    : resolveJakartaDateRange(query);
  if (!range) {
    const day = extractPartialDay(query);
    if (day !== null) {
      const year = jakartaYearNow();
      const paddedDay = String(day).padStart(2, "0");
      return {
        message:
          `Permintaan Anda menyebut tanggal "${day}" tanpa bulan dan tahun, sehingga saya ` +
          `belum dapat menentukan aktivitas audit yang dimaksud. Mohon sebutkan tanggal ` +
          `lengkapnya, misalnya "tanggal ${day} Oktober ${year}" atau "${year}-10-${paddedDay}".`,
        intent: "USER_AUDIT",
        verified: true,
        references: [],
      };
    }
  }

  const type = detectUserAuditType(query);
  const search = extractUserAuditSearch(query);

  const args: Record<string, unknown> = { type };
  if (range) args.date = range.key;
  if (search) args.search = search;

  const raw = await executeTool("get_user_audit_history", args, userId, role);

  let data: {
    count?: number;
    total?: number;
    events?: Array<{
      action: string;
      at: string;
      actorName: string | null;
      actorRole: string | null;
      targetName: string | null;
      targetRole: string | null;
      accountCreatedAt: string | null;
    }>;
    error?: string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return {
      message: USER_AUDIT_UNAVAILABLE,
      intent: "USER_AUDIT",
      verified: true,
      references: [],
    };
  }

  // Kegagalan query/otorisasi tidak boleh disamarkan sebagai "tidak ada".
  if (data.error || typeof data.count !== "number" || !Array.isArray(data.events)) {
    return {
      message: USER_AUDIT_UNAVAILABLE,
      intent: "USER_AUDIT",
      verified: true,
      references: [],
    };
  }

  const typeLabel =
    type === "CREATE"
      ? "pembuatan akun"
      : type === "DELETE"
        ? "penghapusan akun"
        : "pembuatan dan penghapusan akun";
  const scopeLabel = range ? ` pada ${range.label}` : "";
  const searchNote = search ? ` untuk kata kunci "${search}"` : "";

  if (data.events.length === 0) {
    return {
      message: `Tidak ada catatan audit ${typeLabel}${scopeLabel}${searchNote} pada data yang tersimpan.`,
      intent: "USER_AUDIT",
      verified: true,
      references: [],
    };
  }

  const lines = data.events.map((e, i) => {
    const action = AUDIT_ACTION_LABEL[e.action] ?? e.action;
    // Email pengguna lain tidak pernah ditampilkan. Identitas target memakai
    // nama akun bila masih tersedia; jika tidak, cukup peran/tanpa identitas.
    const target = e.targetName
      ? `${e.targetName}${e.targetRole ? ` (${ROLE_LABEL[e.targetRole] ?? e.targetRole})` : ""}`
      : e.targetRole
        ? `akun berperan ${ROLE_LABEL[e.targetRole] ?? e.targetRole}`
        : "(identitas target tidak tercatat dalam audit)";
    const actor = e.actorName
      ? `${e.actorName}${e.actorRole ? ` (${ROLE_LABEL[e.actorRole] ?? e.actorRole})` : ""}`
      : "tidak tercatat";
    let line = `${i + 1}. Akun ${target} ${action} oleh ${actor} — audit dicatat ${e.at}.`;
    // Bedakan waktu PEMBUATAN AKUN dari waktu PENCATATAN AUDIT.
    if (e.action !== "USER_DELETED") {
      line += e.accountCreatedAt
        ? ` Waktu akun dibuat: ${e.accountCreatedAt}.`
        : " Waktu akun dibuat: tidak tersedia (audit tidak menyimpannya).";
    }
    return line;
  });

  const shown = data.events.length;
  const total = typeof data.total === "number" && data.total >= shown ? data.total : shown;
  const truncatedNote = total > shown ? ` (menampilkan ${shown} terbaru dari ${total})` : "";

  return {
    message:
      `Riwayat audit ${typeLabel}${scopeLabel}${searchNote}${truncatedNote}:\n\n` +
      `${lines.join("\n")}\n\nWaktu ditampilkan dalam zona Asia/Jakarta (WIB).`,
    intent: "USER_AUDIT",
    verified: true,
    references: [],
  };
}

/** Tahun berjalan menurut zona Asia/Jakarta (bukan UTC). */
function jakartaYearNow(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: JAKARTA_TIME_ZONE,
      year: "numeric",
    }).format(new Date())
  );
}

/** Batas jumlah peminjam teratas yang ditampilkan pada jawaban peringkat. */
const TOP_BORROWERS_LIMIT = 5;

/**
 * Jawaban deterministik untuk pertanyaan PERINGKAT peminjam (Pustakawan/Admin).
 *
 * Peringkat dihitung dari transaksi peminjaman buku yang BENAR-BENAR tercatat
 * di database (status BORROWED/OVERDUE/RETURNED) — bukan dari karangan model.
 * Transaksi yang masih berupa pengajuan (REQUESTED) atau dibatalkan/ditolak
 * tidak dihitung sebagai peminjaman. Ebook tidak disertakan agar definisinya
 * tegas.
 *
 * Kontrak: query gagal → `OPERATIONAL_BORROWS_UNAVAILABLE` (bukan "tidak ada").
 */
async function answerMostActiveBorrowers(
  intent: Intent
): Promise<ChatSuccess> {
  try {
    const grouped = await prisma.borrowRecord.groupBy({
      by: ["userId"],
      where: { status: { in: ["BORROWED", "OVERDUE", "RETURNED"] } },
      _count: { userId: true },
      orderBy: { _count: { userId: "desc" } },
      take: TOP_BORROWERS_LIMIT,
    });

    if (grouped.length === 0) {
      return {
        message: "Belum ada transaksi peminjaman buku yang tercatat di sistem.",
        intent,
        verified: true,
        references: [],
      };
    }

    const ids = grouped.map((row) => row.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, role: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));

    const lines: string[] = [];
    grouped.forEach((row, index) => {
      const user = userById.get(row.userId);
      if (!user) return;
      const roleName = ROLE_LABEL[user.role] ?? user.role;
      lines.push(
        `${index + 1}. ${user.name} (${roleName}) — ${row._count.userId} peminjaman`
      );
    });

    return {
      message:
        `Peminjam paling aktif (berdasarkan jumlah transaksi peminjaman buku yang tercatat):\n\n` +
        `${lines.join("\n")}\n\n` +
        `Catatan: peringkat dihitung dari transaksi peminjaman buku di database ` +
        `(waktu Asia/Jakarta); pengajuan yang belum disetujui atau ditolak tidak dihitung.`,
      intent,
      verified: true,
      references: [],
    };
  } catch (dbError) {
    console.error("[AI] Gagal menghitung peminjam teraktif.", dbError);
    return {
      message: OPERATIONAL_BORROWS_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }
}

/** Batas baris daftar pemegang masa akses ebook pada jawaban operasional. */
const EBOOK_OVERVIEW_LIMIT = 20;

/** Kata yang tidak pernah menjadi bagian judul/penulis pada pertanyaan ebook. */
const EBOOK_OVERVIEW_STOPWORDS = new Set([
  "yang", "dari", "untuk", "pada", "dengan", "adalah", "apa", "apakah",
  "siapa", "saja", "semua", "seluruh", "daftar", "tampilkan", "tunjukkan",
  "lihat", "ebook", "buku", "sedang", "lagi", "masih", "aktif", "masa",
  "akses", "sekarang", "saat", "ini", "itu", "sedang", "membaca", "baca",
  "dibaca", "pembacaan", "aktivitas", "riwayat", "peminjam", "meminjam",
  "pinjam", "dipinjam", "peminjaman", "berapa", "jumlah", "total", "bulan",
  "tahun", "minggu", "hari", "tanggal", "kemarin", "lalu", "ini", "siswa",
  "murid", "guru", "anggota", "pengguna", "user", "orang", "oleh", "dan",
  "atau", "di", "ke", "nama", "judul", "penulis", "pengarang", "bisa",
  "boleh", "punya", "memiliki", "tercatat", "terbaru",
]);

/** Kata kunci judul/penulis ebook yang disebut pengguna (opsional). */
function ebookOverviewTerms(query: string): string[] {
  return normalizeQuery(query)
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 4 &&
        !EBOOK_OVERVIEW_STOPWORDS.has(word) &&
        !/^\d+$/.test(word)
    );
}

/** Kata yang tidak pernah menjadi judul/penulis pada pertanyaan aktivitas baca. */
const READING_ACTIVITY_STOPWORDS = new Set(
  Array.from(EBOOK_OVERVIEW_STOPWORDS).concat([
    "terakhir", "terbaru", "membuka", "dibuka", "buka", "membukanya",
    "bukaan", "sesi", "halaman", "progres", "persen", "sampai", "saya",
    "aku", "ku", "punyaku", "unik", "pernah", "belum", "mana", "kapan",
    "jam", "menit", "berapa", "adakah", "apakah", "membacanya",
  ])
);

function readingActivityTerms(query: string): string[] {
  return normalizeQuery(query)
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 4 &&
        !READING_ACTIVITY_STOPWORDS.has(word) &&
        !/^\d+$/.test(word)
    );
}

function readingRowReferences(rows: ReadingActivityRow[]): ChatReference[] {
  const references: ChatReference[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.book.id)) continue;
    seen.add(row.book.id);
    references.push({
      id: row.book.id,
      title: row.book.title,
      author: row.book.author,
      coverUrl: null,
      available: null,
    });
  }
  return references;
}

function formatReadingMoment(value: Date): string {
  return formatWibDateTime(value);
}

function readingMomentLine(row: ReadingActivityRow): string {
  const status = readingActivityStatusLabel(row.status);
  return (
    `dibuka ${formatReadingMoment(row.firstOpenedAt)}, ` +
    `aktivitas terakhir ${formatReadingMoment(row.lastActivityAt)} ` +
    `(${status})`
  );
}

/**
 * Jawaban deterministik aktivitas membaca MILIK SENDIRI.
 *
 * Sumbernya EbookReadingSession, bukan EbookLoan. Peminjaman aktif tidak
 * pernah diubah menjadi aktivitas membaca, dan nomor halaman tidak dikarang
 * bila viewer tidak menyediakannya.
 */
async function answerMyReadingActivity(
  intent: Intent,
  query: string,
  userId: string
): Promise<ChatSuccess> {
  const q = ` ${normalizeQuery(query)} `;
  const asksPage = /\b(halaman|progres|persen)\b/.test(q);
  const asksLast = /\b(terakhir|terbaru)\b/.test(q);
  const terms = readingActivityTerms(query);
  const period = resolveStatsPeriod(query);

  try {
    const rows = await getMyReadingActivity({
      userId,
      search: terms[0],
      start: period?.start,
      end: period?.end,
      limit: asksLast ? 3 : 10,
    });
    const periodNote = period ? ` pada ${period.label}` : "";
    const scope = terms.length > 0 ? ` untuk "${terms.join(" ")}"` : "";

    if (rows.length === 0) {
      return {
        message:
          `Belum ada aktivitas membaca ebook yang tercatat untuk akun Anda` +
          `${periodNote}${scope}. ` +
          "Peminjaman atau masa akses ebook tidak otomatis dihitung sebagai aktivitas membaca.",
        intent,
        verified: true,
        references: [],
      };
    }

    if (asksPage) {
      const row = rows[0];
      if (row.lastPage === null) {
        return {
          message:
            `Sesi membaca terakhir yang tercatat adalah "${row.book.title}" ` +
            `(${readingMomentLine(row)}). ` +
            "Namun viewer PDF bawaan browser tidak melaporkan nomor halaman, " +
            "jadi saya tidak dapat memastikan sampai halaman berapa Anda membaca. " +
            "Nilai progres tidak dikarang.",
          intent,
          verified: true,
          references: readingRowReferences([row]),
        };
      }
      return {
        message:
          `Sesi membaca terakhir yang tercatat adalah "${row.book.title}" ` +
          `(${readingMomentLine(row)}). Halaman terakhir yang dilaporkan: ` +
          `${row.lastPage}` +
          (row.progressPercent !== null && row.book.pageCount !== null
            ? ` dari ${row.book.pageCount} halaman (${row.progressPercent}%).`
            : ". Total halaman tidak tersedia, jadi persentase progres tidak dihitung.") +
          " Nilai ini berasal dari sinyal halaman yang valid, bukan perkiraan.",
        intent,
        verified: true,
        references: readingRowReferences([row]),
      };
    }

    const shown = rows.slice(0, asksLast ? 3 : 6);
    const lines = shown.map(
      (row) =>
        `- "${row.book.title}" — ${row.book.author} — ${readingMomentLine(row)}`
    );
    const header = asksLast
      ? `Aktivitas membaca ebook terakhir yang tercatat${periodNote}${scope}:`
      : `Aktivitas membaca ebook Anda${periodNote}${scope}:`;

    return {
      message:
        `${header}\n\n${lines.join("\n")}\n\n` +
        "Catatan: “Aktivitas terbaru” berarti ada sinyal aktivitas dalam " +
        `${READING_ACTIVITY_CONFIG.idleTimeoutMinutes} menit terakhir, bukan bukti ` +
        "Anda membaca terus-menerus. Membuka ebook dan meminjam ebook adalah " +
        "konsep yang berbeda.",
      intent,
      verified: true,
      references: readingRowReferences(shown),
    };
  } catch (dbError) {
    console.error("[AI] Gagal mengambil aktivitas membaca pribadi.", dbError);
    return {
      message: OPERATIONAL_READING_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }
}

/**
 * Jawaban deterministik aktivitas membaca GLOBAL. Hanya ADMIN.
 *
 * Membedakan jumlah sesi, pengguna unik, dan ebook unik; tidak menyamakan
 * pinjaman dengan aktivitas, dan tidak mengklaim siapa pun "sedang membaca"
 * hanya karena sesi masih dalam jendela idle.
 */
async function answerEbookReadingOperational(
  intent: Intent,
  query: string,
  role: string
): Promise<ChatSuccess> {
  if (role !== "ADMIN") {
    return { message: ADMIN_ONLY_REFUSAL, intent, verified: true, references: [] };
  }

  const q = ` ${normalizeQuery(query)} `;
  const asksActive = /\b(aktif|masih|sekarang|saat\s+ini|sedang|lagi)\b/.test(q);
  const asksLast = /\b(terakhir|terbaru|paling\s+akhir)\b/.test(q);
  const asksCounts =
    /\b(?:berapa|jumlah|total)\b/.test(q) ||
    /\b(?:pengguna|ebook|buku)\s+unik\b/.test(q);
  const asksSessionsOnly = /\btotal\s+sesi\b/.test(q);
  const asksUniqueBooksOnly =
    /\b(?:ebook|buku)\s+unik\b/.test(q) && !/\bpengguna\s+unik\b/.test(q);
  const asksNames = /\bsiapa\b/.test(q);
  const terms = readingActivityTerms(query);
  const period = resolveStatsPeriod(query);
  const now = new Date();
  const status = asksActive ? READING_ACTIVITY_STATUS.ACTIVE : null;

  try {
    const result = await listReadingActivity({
      filters: {
        search: terms[0],
        status,
        start: period?.start,
        end: period?.end,
        periodLabel: period?.label,
      },
      pageSize: asksNames ? 1000 : asksLast ? 1 : 12,
      now,
    });
    const periodNote = period ? ` pada ${period.label}` : "";
    const scope = terms.length > 0 ? ` untuk "${terms.join(" ")}"` : "";

    if (result.total === 0) {
      const message = asksActive
        ? `Tidak ada sesi dengan sinyal aktivitas dalam ` +
          `${READING_ACTIVITY_CONFIG.idleTimeoutMinutes} menit terakhir` +
          `${periodNote}${scope}. Ini bukan bukti bahwa tidak ada yang pernah ` +
          "membaca; sesi lama tetap tersimpan sebagai riwayat tidak aktif."
        : `Belum ada sesi aktivitas membaca ebook yang cocok${periodNote}${scope}. ` +
          "Data aktivitas tidak dibuat dari peminjaman lama.";
      return { message, intent, verified: true, references: [] };
    }

    if (asksSessionsOnly) {
      const s = result.summary;
      return {
        message: `Pada ${result.periodLabel}${scope}, tercatat ${s.totalSessions} sesi aktivitas membaca ebook.`,
        intent,
        verified: true,
        references: [],
      };
    }
    if (asksUniqueBooksOnly) {
      const s = result.summary;
      return {
        message: `Pada ${result.periodLabel}${scope}, tercatat ${s.uniqueBooks} ebook unik yang dibuka.`,
        intent,
        verified: true,
        references: [],
      };
    }
    if (asksCounts) {
      const s = result.summary;
      return {
        message:
          `Pada ${result.periodLabel}${scope}, tercatat ${s.totalSessions} sesi ` +
          `aktivitas membaca ebook oleh ${s.uniqueUsers} pengguna unik dan ` +
          `${s.uniqueBooks} ebook unik. ` +
          `Rincian status saat ini: ${s.activeSessions} sesi dengan aktivitas ` +
          `dalam ${READING_ACTIVITY_CONFIG.idleTimeoutMinutes} menit terakhir, ` +
          `${s.openedSessions} sesi baru dibuka, dan ${s.inactiveSessions} sesi ` +
          "tidak aktif.\n\nJumlah sesi tidak sama dengan jumlah pengguna: satu " +
          "pengguna dapat memiliki beberapa sesi. Peminjaman aktif juga tidak " +
          "sama dengan aktivitas membaca.",
        intent,
        verified: true,
        references: [],
      };
    }

    if (asksLast) {
      const row = result.rows[0];
      return {
        message:
          `Aktivitas terakhir yang tercatat${periodNote}${scope}:\n\n` +
          `- ${row.user.name} — "${row.book.title}" — ${readingMomentLine(row)}` +
          (result.total > 1
            ? `\n\nMenampilkan 1 dari ${result.total} sesi yang cocok (urut waktu aktivitas terakhir).`
            : "") +
          "\n\nCatatan: ini waktu aktivitas terakhir yang tercatat, bukan bukti " +
          "orang tersebut sedang membaca saat ini. Masa pinjam dan aktivitas " +
          "membaca adalah dua hal berbeda.",
        intent,
        verified: true,
        references: readingRowReferences([row]),
      };
    }

    if (asksNames) {
      const unique = new Map<string, string>();
      for (const row of result.rows) {
        if (!unique.has(row.user.id)) unique.set(row.user.id, row.user.name);
      }
      const names = Array.from(unique.values());
      return {
        message: `Pengguna yang tercatat membuka ebook${scope ? ` ${scope}` : ""}:\n\n- ${names.join("\n- ")}`,
        intent,
        verified: true,
        references: [],
      };
    }

    const shown = result.rows;
    const lines = shown.map(
      (row) =>
        `- ${row.user.name} (${ROLE_LABEL[row.user.role] ?? row.user.role}) — ` +
        `"${row.book.title}" — ${readingMomentLine(row)}`
    );
    const header = asksActive
      ? `Sesi dengan sinyal aktivitas dalam ${READING_ACTIVITY_CONFIG.idleTimeoutMinutes} ` +
        `menit terakhir${periodNote}${scope}:`
      : `Aktivitas membaca ebook terbaru${periodNote}${scope}:`;
    const truncated =
      result.total > shown.length
        ? `\n\nMenampilkan ${shown.length} teratas dari ${result.total} sesi.`
        : `\n\nTotal ${result.total} sesi.`;

    return {
      message:
        `${header}\n\n${lines.join("\n")}${truncated}\n\n` +
        "Status “Aktivitas terbaru” hanya berarti ada sinyal aktivitas dalam " +
        `${READING_ACTIVITY_CONFIG.idleTimeoutMinutes} menit terakhir, bukan bukti ` +
        "membaca terus-menerus. Nomor halaman/progres tidak tersedia dari viewer " +
        "PDF bawaan browser dan tidak dikarang.",
      intent,
      verified: true,
      references: readingRowReferences(shown),
    };
  } catch (dbError) {
    console.error("[AI] Gagal mengambil aktivitas membaca global.", dbError);
    return {
      message: OPERATIONAL_READING_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }
}

/**
 * Jawaban deterministik untuk pertanyaan Pustakawan/Admin tentang peminjam
 * ebook / aktivitas membaca ebook.
 *
 * Kebenaran data:
 * - Sumber masa akses: EbookLoan dengan `returnedAt = null` dan `expiresAt > now`.
 *   Status itu berarti MASA AKSES masih berlaku, BUKAN bukti pengguna sedang
 *   membaca.
 * - Pertanyaan aktivitas membaca TIDAK dijawab dari EbookLoan. Untuk ADMIN
 *   diarahkan ke EbookReadingSession; untuk LIBRARIAN (tanpa akses global baru)
 *   disampaikan keterbatasan kewenangan secara jujur, bukan klaim bahwa sistem
 *   tidak mencatat aktivitas.
 * - Judul/penulis opsional difilter dari kata kunci pertanyaan; jumlah total
 *   dan jumlah yang ditampilkan dibedakan agar daftar terpotong tidak diklaim
 *   lengkap.
 *
 * Kontrak: query gagal → `OPERATIONAL_BORROWS_UNAVAILABLE` (bukan "tidak ada").
 */
async function answerEbookBorrowerOperational(
  intent: Intent,
  query: string,
  role: string
): Promise<ChatSuccess> {
  const q = ` ${normalizeQuery(query)} `;
  const asksReading = /\b(membaca|baca|dibaca|pembacaan|aktivitas)\b/.test(q);

  // ADMIN: pertanyaan aktivitas membaca memakai sesi reader, bukan loan.
  if (asksReading && role === "ADMIN") {
    return answerEbookReadingOperational(intent, query, role);
  }

  const terms = ebookOverviewTerms(query);
  const now = new Date();

  try {
    // Filter status murni timestamp — kolom status bisa tertinggal (lazy).
    const loans = await prisma.ebookLoan.findMany({
      where: { returnedAt: null, expiresAt: { gt: now } },
      include: {
        book: { select: { id: true, title: true, author: true } },
        user: { select: { name: true, role: true } },
      },
      orderBy: { borrowedAt: "desc" },
    });

    const matching =
      terms.length === 0
        ? loans
        : loans.filter((loan) => {
            const haystack = `${loan.book.title} ${loan.book.author}`.toLowerCase();
            return terms.some((term) => haystack.includes(term));
          });

    const total = matching.length;
    const scope = terms.length > 0 ? ` untuk kata kunci "${terms.join(" ")}"` : "";
    const shown = matching.slice(0, EBOOK_OVERVIEW_LIMIT);
    const readingLimitation = asksReading
      ? "Aktivitas membaca ebook dicatat melalui sesi reader. Pemantauan aktivitas membaca seluruh pengguna hanya tersedia untuk Administrator, sehingga saya tidak dapat menampilkan sesi baca semua pengguna. "
      : "";

    if (total === 0) {
      const message =
        `${readingLimitation}` +
        `Saat ini tidak ada peminjaman ebook dengan masa akses aktif${scope} (waktu Asia/Jakarta).` +
        (asksReading
          ? " Masa akses aktif bukan bukti aktivitas membaca."
          : "");
      return { message, intent, verified: true, references: [] };
    }

    const lines = shown.map((loan) => {
      const roleName = ROLE_LABEL[loan.user.role] ?? loan.user.role;
      return `- ${loan.user.name} (${roleName}) — "${loan.book.title}" — masa akses sampai ${formatDateID(
        loan.expiresAt
      )}`;
    });

    const period = resolveStatsPeriod(query);
    const periodNote =
      asksReading && period
        ? " Pertanyaan per periode untuk aktivitas membaca tidak dijawab dari masa akses; daftar ini adalah status masa akses saat ini."
        : "";
    const header = `${readingLimitation}Peminjaman ebook dengan masa akses aktif${scope}:`;
    const footer = asksReading
      ? "\n\nDaftar ini menunjukkan masa akses yang masih berlaku, bukan bukti ebook telah dibaca."
      : "\n\nCatatan: masa akses aktif berarti ebook boleh dibuka, bukan bukti ebook sedang dibaca.";
    const truncated =
      total > shown.length
        ? `\n\nMenampilkan ${shown.length} teratas dari ${total} peminjaman ebook aktif.`
        : `\n\nTotal ${total} peminjaman ebook aktif.`;

    const references: ChatReference[] = [];
    const seen = new Set<string>();
    for (const loan of matching) {
      if (seen.has(loan.book.id)) continue;
      seen.add(loan.book.id);
      references.push({
        id: loan.book.id,
        title: loan.book.title,
        author: loan.book.author,
        coverUrl: null,
        available: null,
      });
    }

    return {
      message: `${header}${periodNote}\n\n${lines.join("\n")}${truncated}${footer}`,
      intent,
      verified: true,
      references,
    };
  } catch (dbError) {
    console.error("[AI] Gagal mengambil data peminjaman ebook.", dbError);
    return {
      message: OPERATIONAL_BORROWS_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }
}

/**
 * Jawaban deterministik RIWAYAT/SELURUH peminjaman ebook (Pustakawan/Admin).
 *
 * Berbeda dari `answerEbookBorrowerOperational` yang hanya menampilkan masa
 * akses yang masih aktif. Sumbernya `get_all_ebook_loans` (semua status) dengan
 * total dan jumlah yang ditampilkan dibedakan. Status ACTIVE tetap berarti masa
 * akses, bukan bukti membaca.
 */
async function answerEbookLoansHistory(
  intent: Intent,
  query: string,
  userId: string,
  role: string
): Promise<ChatSuccess> {
  const q = ` ${normalizeQuery(query)} `;
  let status: "ACTIVE" | "EXPIRED" | "RETURNED" | null = null;
  if (/\b(dikembalikan|mengembalikan|selesai|returned)\b/.test(q)) {
    status = "RETURNED";
  } else if (/\b(kedaluwarsa|kadaluwarsa|expired|berakhir)\b/.test(q)) {
    status = "EXPIRED";
  } else if (
    /\b(aktif|masih|berlaku)\b/.test(q) &&
    !/\b(?:riwayat|semua|seluruh|daftar|pernah|keseluruhan)\b/.test(q)
  ) {
    status = "ACTIVE";
  }

  const raw = await executeTool(
    "get_all_ebook_loans",
    status ? { status } : {},
    userId,
    role
  );

  let data: {
    count?: number;
    total?: number;
    shown?: number;
    loans?: Array<{
      bookId?: string;
      title: string;
      author: string;
      status: string;
      borrowedAt: string;
      expiresAt: string;
      returnedAt: string | null;
      userName: string;
    }>;
    error?: string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return { message: OPERATIONAL_BORROWS_UNAVAILABLE, intent, verified: true, references: [] };
  }

  if (data.error || !Array.isArray(data.loans)) {
    return { message: OPERATIONAL_BORROWS_UNAVAILABLE, intent, verified: true, references: [] };
  }

  const shown = data.loans;
  const total =
    typeof data.total === "number" && data.total >= shown.length
      ? data.total
      : typeof data.count === "number" && data.count >= shown.length
        ? data.count
        : shown.length;
  const statusLabel = status
    ? EBOOK_LOAN_STATUS_LABEL[status] ?? status.toLowerCase()
    : "semua status";

  if (total === 0) {
    return {
      message: `Belum ada transaksi peminjaman ebook dengan ${statusLabel} yang tercatat di sistem.`,
      intent,
      verified: true,
      references: [],
    };
  }

  const lines = shown.map((loan) => {
    const loanStatus = EBOOK_LOAN_STATUS_LABEL[loan.status] ?? loan.status.toLowerCase();
    const timing = loan.returnedAt
      ? `dikembalikan ${loan.returnedAt}`
      : `masa akses sampai ${loan.expiresAt}`;
    return `- ${loan.userName} — "${loan.title}" — ${loanStatus} — dipinjam ${loan.borrowedAt}; ${timing}`;
  });

  const truncated =
    total > shown.length
      ? `\n\nMenampilkan ${shown.length} transaksi terbaru dari ${total} transaksi.`
      : `\n\nTotal ${total} transaksi.`;

  const references: ChatReference[] = [];
  const seen = new Set<string>();
  for (const loan of shown) {
    if (!loan.bookId || seen.has(loan.bookId)) continue;
    seen.add(loan.bookId);
    references.push({
      id: loan.bookId,
      title: loan.title,
      author: loan.author,
      coverUrl: null,
      available: null,
    });
  }

  return {
    message:
      `Riwayat peminjaman ebook (${statusLabel}, seluruh pengguna):\n\n` +
      `${lines.join("\n")}${truncated}\n\n` +
      "Catatan: status ACTIVE berarti masa akses masih berlaku, bukan bukti ebook sedang dibaca. " +
      "Aktivitas membaca dicatat terpisah pada sesi reader.",
    intent,
    verified: true,
    references,
  };
}

/**
 * Jawaban deterministik untuk pertanyaan operasional/administratif yang
 * diizinkan role:
 * - USER_COUNT (Pustakawan): jumlah pengguna AGREGAT dari database, tanpa
 *   identitas. Keputusan ini deterministik agar angkanya akurat dan tidak pernah
 *   berasal dari halusinasi model.
 * - USER_DIRECTORY: tidak ada tool yang menyediakan daftar identitas — sampaikan
 *   keterbatasan secara jujur.
 * - SYSTEM_SETTINGS (Admin): pengaturan non-sensitif dari database, rahasia
 *   (password/token/secret) tidak pernah disertakan.
 * - OPERATIONAL yang menyangkut denda: dijawab deterministik dari database
 *   (lihat answerFinesOperational) agar jenis denda tidak tertukar.
 *
 * Intent OPERATIONAL lain (mis. transaksi/riwayat global) mengembalikan null
 * agar diteruskan ke jalur model dengan tool yang sesuai.
 */
/**
 * Pilih metrik yang benar-benar ditanyakan. Bila pengguna menyebut metrik
 * spesifik ("pengembalian", "denda", "aktif", "ditolak"), jangan menambahkan
 * total transaksi generik — jawab hanya yang diminta.
 *
 * `BORROWS` dan `EBOOKS` sama-sama penanda "total transaksi" menurut format.
 * Keduanya dibuang saat ada metrik status spesifik, lalu dikembalikan hanya
 * bila pengguna secara eksplisit meminta total transaksi sekaligus.
 */
function selectRequestedMetrics(
  query: string,
  metrics: OperationalMetric[]
): OperationalMetric[] {
  const q = ` ${normalizeQuery(query)} `;
  const specific = metrics.filter(
    (metric) => metric !== "BORROWS" && metric !== "EBOOKS"
  );
  if (specific.length === 0) {
    return metrics.some((metric) => metric === "BORROWS" || metric === "EBOOKS")
      ? ["BORROWS"]
      : metrics;
  }

  // "total transaksi dan pengembalian" memang meminta total + status. Tetapi
  // "total transaksi ebook yang sudah dikembalikan" hanya meminta status.
  const explicitTotal =
    /\b(total|seluruh|semua)\s+transaksi\b/.test(q) &&
    !/\b(?:yang|sudah|telah|statusnya|berstatus)\b[\s\S]*\b(?:dikembalikan|ditolak|dibatalkan|terlambat|kedaluwarsa|expired|aktif|menunggu|pending|berjalan)\b/.test(
      q
    );

  return explicitTotal ? ["BORROWS", ...specific] : specific;
}

const OPERATIONAL_BORROW_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "menunggu persetujuan",
  BORROWED: "dipinjam/aktif",
  OVERDUE: "terlambat",
  RETURNED: "dikembalikan",
  CANCELLED: "dibatalkan",
  REJECTED: "ditolak",
};

function physicalStatusBreakdown(stats: OperationalPhysicalStats): string {
  return Object.entries(stats.statusCounts)
    .filter(([, count]) => count > 0)
    .map(
      ([status, count]) =>
        `${OPERATIONAL_BORROW_STATUS_LABEL[status] ?? status.toLowerCase()} ${count}`
    )
    .join(", ");
}

function buildPhysicalOperationalLines(
  metrics: OperationalMetric[],
  stats: OperationalPhysicalStats,
  period: string,
  currentNote: string
): string[] {
  const lines: string[] = [];
  for (const metric of metrics) {
    switch (metric) {
      case "BORROWS": {
        const breakdown = physicalStatusBreakdown(stats);
        const definition =
          "semua status: pengajuan, dipinjam/aktif, terlambat, dikembalikan, ditolak, dan dibatalkan";
        lines.push(
          breakdown.length > 0
            ? `Ada ${stats.totalBorrows} transaksi peminjaman buku fisik${period} di perpustakaan (${definition}). Rincian status: ${breakdown}.`
            : `Ada ${stats.totalBorrows} transaksi peminjaman buku fisik${period} di perpustakaan (${definition}).`
        );
        break;
      }
      case "ACTIVE":
        if (stats.activeBorrows === 0) {
          lines.push(
            `Saat ini tidak ada peminjaman buku fisik yang sedang aktif${currentNote}.`
          );
        } else {
          lines.push(
            `Saat ini ada ${stats.activeBorrows} peminjaman buku fisik aktif (status BORROWED/OVERDUE)${currentNote}.`
          );
        }
        break;
      case "PENDING":
        lines.push(
          `Saat ini ada ${stats.pendingRequests} pengajuan peminjaman buku fisik yang menunggu persetujuan${currentNote}.`
        );
        break;
      case "OVERDUE":
        lines.push(
          `Saat ini ada ${stats.overdueBorrows} peminjaman buku fisik yang terlambat dikembalikan${currentNote} (waktu Asia/Jakarta).`
        );
        break;
      case "RETURNS":
        lines.push(
          `Ada ${stats.returns} pengembalian buku fisik${period} (status RETURNED, berdasarkan tanggal kembali).`
        );
        break;
      case "REJECTED":
        lines.push(
          `Ada ${stats.rejectedBorrows} transaksi buku fisik yang ditolak${period} (status REJECTED).`
        );
        break;
      case "CANCELLED":
        lines.push(
          `Ada ${stats.cancelledBorrows} transaksi buku fisik yang dibatalkan${period} (status CANCELLED).`
        );
        break;
      case "EXPIRED":
        lines.push(
          "Status kedaluwarsa tidak berlaku untuk buku fisik; buku fisik memakai status terlambat (OVERDUE)."
        );
        break;
      case "FINES":
        if (stats.fines.records === 0 && stats.fines.assessed === 0) {
          lines.push(`Tidak ada denda buku fisik${period} yang tercatat di sistem.`);
        } else {
          lines.push(
            `Ada ${stats.fines.records} catatan denda buku fisik${period} dengan total denda ` +
              `${formatRupiah(stats.fines.assessed)}; sudah dibayar ` +
              `${formatRupiah(stats.fines.collected)}; sisa ` +
              `${formatRupiah(stats.fines.outstanding)}.`
          );
        }
        break;
      case "EBOOKS":
        // Penanda total ebook; bukan angka buku fisik.
        break;
    }
  }
  return lines;
}

function ebookStatusBreakdown(stats: OperationalEbookStats): string {
  return (
    `aktif ${stats.statusCounts.ACTIVE}, ` +
    `kedaluwarsa ${stats.statusCounts.EXPIRED}, ` +
    `dikembalikan ${stats.statusCounts.RETURNED}`
  );
}

function buildEbookOperationalLines(
  metrics: OperationalMetric[],
  stats: OperationalEbookStats,
  period: string,
  currentNote: string
): string[] {
  const lines: string[] = [];
  let totalAdded = false;
  for (const metric of metrics) {
    switch (metric) {
      case "BORROWS":
      case "EBOOKS":
        if (totalAdded) break;
        totalAdded = true;
        lines.push(
          `Ada ${stats.totalLoans} transaksi peminjaman ebook${period} ` +
            `(semua status EbookLoan, berdasarkan tanggal pinjam). ` +
            `Rincian status: ${ebookStatusBreakdown(stats)}.`
        );
        lines.push(
          "Catatan: EbookLoan tidak memiliki status pengajuan, terlambat, ditolak, atau dibatalkan; " +
            "EXPIRED berarti masa akses habis, bukan keterlambatan pengembalian."
        );
        break;
      case "ACTIVE":
        if (stats.activeLoans === 0) {
          lines.push(
            `Saat ini tidak ada peminjaman ebook dengan masa akses aktif${currentNote}.`
          );
        } else {
          lines.push(
            `Saat ini ada ${stats.activeLoans} peminjaman ebook dengan masa akses aktif ` +
              `(belum dikembalikan dan belum kedaluwarsa)${currentNote}.`
          );
        }
        break;
      case "EXPIRED":
        lines.push(
          `Saat ini ada ${stats.expiredLoans} peminjaman ebook yang masa aksesnya ` +
            `kedaluwarsa (EXPIRED; bukan keterlambatan pengembalian)${currentNote}.`
        );
        break;
      case "OVERDUE":
        lines.push(
          `Status terlambat tidak berlaku untuk ebook. EbookLoan memakai EXPIRED untuk masa akses ` +
            `yang habis; saat ini ada ${stats.expiredLoans} masa akses kedaluwarsa${currentNote}.`
        );
        break;
      case "RETURNS":
        lines.push(
          `Ada ${stats.returns} pengembalian ebook${period} (berdasarkan returnedAt, tanggal kembali).`
        );
        break;
      case "PENDING":
        lines.push(
          "Status pengajuan/menunggu tidak berlaku untuk ebook; EbookLoan langsung mencatat peminjaman dan masa akses."
        );
        break;
      case "REJECTED":
        lines.push("Status ditolak tidak berlaku untuk ebook.");
        break;
      case "CANCELLED":
        lines.push("Status dibatalkan tidak berlaku untuk ebook.");
        break;
      case "FINES":
        lines.push(
          "Denda tidak berlaku untuk transaksi ebook; denda hanya dihitung dari pengembalian buku fisik."
        );
        break;
    }
  }
  return lines;
}

/**
 * Jawaban deterministik statistik transaksi operasional (Pustakawan/Admin).
 * Angka berasal langsung dari `getOperationalStats` (count/aggregate database),
 * dipisahkan menurut format, bukan dari daftar baris atau interpretasi model.
 */
async function answerOperationalStats(
  intent: Intent,
  query: string
): Promise<ChatSuccess> {
  const format: TransactionFormat = resolveTransactionFormat(query);
  const requested = selectRequestedMetrics(query, detectRequestedMetrics(query));
  const metrics =
    requested.length > 0
      ? requested
      : (["BORROWS"] as OperationalMetric[]);

  let stats: OperationalStats;
  try {
    stats = await getOperationalStats(resolveStatsPeriod(query), new Date(), format);
  } catch (dbError) {
    console.error("[AI] Gagal mengambil statistik operasional.", dbError);
    return {
      message: metrics.includes("FINES") && metrics.length === 1
        ? OPERATIONAL_FINES_UNAVAILABLE
        : OPERATIONAL_BORROWS_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }

  const period =
    stats.period && stats.period.granularity !== "day"
      ? ` ${stats.period.label}`
      : stats.period
        ? ` pada ${stats.period.label}`
        : "";
  // Label periode untuk baris "Total ...". Tanpa periode, sebut "keseluruhan";
  // dengan periode, JANGAN menyebut "keseluruhan" karena angka hanya mencakup
  // periode yang diminta (mis. "Total transaksi pada Oktober 2026").
  const totalPeriodNote = stats.period
    ? ` pada ${stats.period.label}`
    : " keseluruhan";
  const currentNote = stats.period ? " (status saat ini, tidak dibatasi periode)" : "";

  if (format === "PHYSICAL") {
    const physical = stats.physical;
    if (!physical) {
      return {
        message: OPERATIONAL_BORROWS_UNAVAILABLE,
        intent,
        verified: true,
        references: [],
      };
    }
    const lines = buildPhysicalOperationalLines(metrics, physical, period, currentNote);
    return {
      message: lines.length === 1 ? lines[0] : lines.map((line) => `- ${line}`).join("\n"),
      intent,
      verified: true,
      references: [],
    };
  }

  if (format === "EBOOK") {
    const ebook = stats.ebook;
    if (!ebook) {
      return {
        message: OPERATIONAL_BORROWS_UNAVAILABLE,
        intent,
        verified: true,
        references: [],
      };
    }
    const lines = buildEbookOperationalLines(metrics, ebook, period, currentNote);
    return {
      message: lines.length === 1 ? lines[0] : lines.map((line) => `- ${line}`).join("\n"),
      intent,
      verified: true,
      references: [],
    };
  }

  // ALL: selalu tampilkan dua bagian terpisah. Total gabungan hanya dihitung
  // untuk metrik yang definisinya sama pada kedua format.
  const physical = stats.physical;
  const ebook = stats.ebook;
  const q = ` ${normalizeQuery(query)} `;
  const explicitBothFormats = /\bebook\b/.test(q) && /\b(?:fisik|buku)\b/.test(q);
  if (!physical || !ebook) {
    return {
      message: OPERATIONAL_BORROWS_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }

  if (!explicitBothFormats && metrics.length === 1 && metrics[0] === "BORROWS") {
    const total = physical.totalBorrows + ebook.totalLoans;
    return {
      message: `Total transaksi${totalPeriodNote}: ${total} transaksi peminjaman (${physical.totalBorrows} buku fisik + ${ebook.totalLoans} ebook).`,
      intent,
      verified: true,
      references: [],
    };
  }

  const physicalLines = buildPhysicalOperationalLines(
    metrics,
    physical,
    period,
    currentNote
  );
  const ebookLines = buildEbookOperationalLines(metrics, ebook, period, currentNote);
  const totalLines: string[] = [];

  if (metrics.includes("BORROWS")) {
    totalLines.push(
      `Total transaksi${totalPeriodNote}: ${physical.totalBorrows + ebook.totalLoans} transaksi peminjaman ` +
        `(${physical.totalBorrows} buku fisik + ${ebook.totalLoans} ebook).`
    );
  }
  if (metrics.includes("RETURNS")) {
    totalLines.push(
      `Total pengembalian${totalPeriodNote}: ${physical.returns + ebook.returns} pengembalian ` +
        `(${physical.returns} buku fisik + ${ebook.returns} ebook).`
    );
  }

  const message = [
    ...(totalLines.length > 0 ? [totalLines[0], ""] : []),
    `Rincian transaksi${period} — buku fisik dan ebook:`,
    "",
    "**Buku fisik**",
    ...physicalLines.map((line) => `- ${line}`),
    "",
    "**Ebook**",
    ...ebookLines.map((line) => `- ${line}`),
    ...(totalLines.length > 1 ? ["", ...totalLines.slice(1).map((line) => `- ${line}`)] : []),
  ].join("\n");

  return { message, intent, verified: true, references: [] };
}

/**
 * Jawaban deterministik daftar identitas pengguna (khusus ADMIN). Data berasal
 * dari tool `get_user_directory` (database aktual), bukan karangan model.
 */
async function answerUserDirectoryAdmin(
  query: string,
  userId: string,
  role: string
): Promise<ChatSuccess> {
  const roleFilter = detectUserRoleFilter(query);
  const isActive = detectUserActiveFilter(query);
  const classFilter = detectUserClassFilter(query);
  const search = removeClassTokensFromSearch(
    extractUserLookupTerm(query),
    classFilter?.value ?? null
  );

  const args: Record<string, unknown> = {};
  if (roleFilter) args.role = roleFilter;
  if (isActive !== null) args.isActive = isActive;
  if (classFilter) {
    args.class = classFilter.value;
    args.classExact = classFilter.exact;
  }
  if (search) args.search = search;

  const raw = await executeTool("get_user_directory", args, userId, role);
  let data: {
    total?: number;
    shown?: number;
    users?: Array<{
      name: string;
      email: string;
      role: string;
      isActive: boolean;
      identityNumber: string | null;
      class: string | null;
      createdAt: string;
    }>;
    note?: string;
    error?: string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return {
      message: USER_DIRECTORY_UNAVAILABLE,
      intent: "USER_DIRECTORY",
      verified: true,
      references: [],
    };
  }

  if (data.error || !Array.isArray(data.users)) {
    return {
      message: USER_DIRECTORY_UNAVAILABLE,
      intent: "USER_DIRECTORY",
      verified: true,
      references: [],
    };
  }

  if (data.users.length === 0) {
    return {
      message: "Tidak ada pengguna yang cocok dengan filter yang diminta.",
      intent: "USER_DIRECTORY",
      verified: true,
      references: [],
    };
  }

  const asksIdentity = /\bidentitas\b/.test(normalizeQuery(query));
  const lines = data.users.map((user) => {
    const roleLabel = ROLE_LABEL[user.role] ?? user.role;
    const status = user.isActive ? "aktif" : "nonaktif";
    const identity = user.identityNumber
      ? ` — ${user.identityNumber}`
      : asksIdentity
        ? " — nomor identitas belum tercatat"
        : "";
    // Kelas hanya relevan untuk siswa; pustakawan/guru/staf bukan siswa.
    const cls = user.role === "STUDENT" && user.class ? ` — kelas ${user.class}` : "";
    return `- ${user.name} (${roleLabel}) — ${user.email}${identity}${cls} — ${status}`;
  });

  const shown = typeof data.shown === "number" ? data.shown : data.users.length;
  const total = typeof data.total === "number" ? data.total : shown;
  const truncatedNote = total > shown ? ` (menampilkan ${shown} dari ${total})` : "";

  return {
    message: `Daftar pengguna DigiLib${truncatedNote}:\n\n${lines.join("\n")}`,
    intent: "USER_DIRECTORY",
    verified: true,
    references: [],
  };
}

async function answerOperational(
  intent: Intent,
  query: string,
  role: string,
  userId: string,
  hasHistory: boolean,
  previousUserMessages: string[]
): Promise<ChatSuccess | null> {
  if (role !== "LIBRARIAN" && role !== "ADMIN") return null;

  // Aktivitas membaca GLOBAL memakai EbookReadingSession, bukan EbookLoan.
  // Ditaruh sebelum statistik transaksi agar "berapa pengguna unik yang
  // membuka ebook" tidak dijawab sebagai statistik peminjaman.
  if (isGlobalReadingActivityQuery(query)) {
    return answerEbookReadingOperational(intent, query, role);
  }

  // Transaksi peminjaman buku fisik yang sudah dikembalikan tetapi terlambat.
  if (isLateReturnedPhysicalQuery(query)) {
    const period = resolveStatsPeriod(query);
    const where: Record<string, unknown> = { status: "RETURNED", returnDate: { not: null } };
    if (period) where.returnDate = { gte: period.start, lt: period.end, not: null };
    let count = 0;
    const findMany =
      typeof prisma.borrowRecord?.findMany === "function"
        ? prisma.borrowRecord.findMany.bind(prisma.borrowRecord)
        : null;
    if (findMany) {
      const rows = (await findMany({
        where,
        select: { dueDate: true, returnDate: true },
      })) as Array<{ dueDate: Date; returnDate: Date | null }>;
      count = rows.filter((row) => row.returnDate && row.returnDate.getTime() > row.dueDate.getTime()).length;
    }
    const periodText = period ? ` ${period.label}` : "";
    return {
      message: `Ada ${count} transaksi peminjaman buku fisik yang terlambat dikembalikan${periodText}.`,
      intent,
      verified: true,
      references: [],
    };
  }

  // Pertanyaan denda operasional dijawab deterministik dari DB agar jenis denda
  // (keterlambatan vs kerusakan) tidak tertukar dan metriknya sesuai permintaan.
  if (intent === "OPERATIONAL" && isFineQuery(query)) {
    return answerFinesOperational(intent, query, role, userId);
  }

  // Pertanyaan JUMLAH/STATISTIK transaksi (termasuk per periode) dijawab
  // deterministik dari count/aggregate database. Ini mencegah "berapa jumlah
  // pengembalian" dijawab sebagai statistik katalog dan mencegah angka daftar
  // yang dibatasi (maks 12 baris) diklaim sebagai total.
  if (isOperationalTransactionStatsQuery(query)) {
    return answerOperationalStats(intent, query);
  }

  // Riwayat/seluruh peminjaman ebook (semua status) — bukan hanya masa akses
  // aktif. Ditaruh setelah statistik agar "berapa transaksi ebook" tetap dijawab
  // sebagai angka agregat, bukan sebagai daftar.
  if (isEbookLoanHistoryQuery(query)) {
    return answerEbookLoansHistory(intent, query, userId, role);
  }

  // Pertanyaan keterlambatan GLOBAL ("Buku apa saja yang sedang terlambat?").
  // detectIntent bisa menandainya sebagai MY_LOANS karena redaksi tanpa kata
  // ganti; bagi Pustakawan/Admin ini adalah data operasional seluruh sistem,
  // sehingga dijawab deterministik dari database (bukan "pinjaman saya").
  if (isGlobalOverdueQuery(query)) {
    return answerOverdueOperational(userId, role);
  }

  // Peringkat peminjam ("Siapa yang paling sering meminjam buku?") dijawab
  // deterministik dari agregat transaksi nyata di database — bukan karangan
  // model. Role lain sudah ditolak di answerRefusal sebelum sampai ke sini.
  const personLookupTerm = extractUserLookupTerm(query);
  const qPerson = normalizeQuery(query);
  const asksPersonIdentity = /\b(siapa|identitas)\b/.test(qPerson);
  const hasCapitalizedName = query
    .split(/\s+/)
    .slice(1)
    .some((token) => /^[A-Z][a-z]{2,}$/.test(token.replace(/[^A-Za-z]/g, "")));
  const hasIdentityNumber = /\b\d{4,}\b/.test(query);
  const hasEmailToken = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(query);
  // Pertanyaan agregat (jumlah per role/daftar banyak orang) atau transaksi
  // operasional tertentu ditangani handler lain; fokus di sini adalah lookup
  // identitas/profil satu pengguna spesifik oleh Admin. Pertanyaan audit
  // pembuatan/penghapusan akun harus selalu ditangani handler USER_AUDIT.
  const hasAggregateOrTransaction =
    /\b(jumlah|total|berapa|daftar\s+seluruh|daftar\s+semua|semua\s+pengguna|seluruh\s+pengguna|transaksi|peminjaman|denda|riwayat)\b/.test(
      qPerson
    );
  const asksSpecificUserInfo =
    asksPersonIdentity ||
    /\b(tampilkan|lihat|cari|carikan|cek|periksa|info|informasi|detail|data|profil|akun|email|nis|nip|kelas)\b/.test(
      qPerson
    );
  const explicitIdentity = /\bnomor\s+identitas\b/.test(qPerson) || /\bidentitasnya\b/.test(qPerson);
  const canLookupNamedUser =
    hasCapitalizedName || hasIdentityNumber || hasEmailToken || explicitIdentity;
  const isAuditRelatedUserQuery =
    intent === "USER_AUDIT" ||
    isUserAuditQuery(query) ||
    /\b(dibuat|didaftarkan|membuat|mendaftar|dihapus|menghapus|dinonaktifkan|menonaktifkan|deaktivasi|audit|log\s+aktivitas)\b/.test(
      qPerson
    );
  const isBookContextQuery =
    /\b(buku|ebook|judul|katalog|kategori|penulis|pengarang|penerbit|isbn|sinopsis|ringkasan|detail\s+buku)\b/.test(
      qPerson
    );
  if (
    role === "ADMIN" &&
    !isAuditRelatedUserQuery &&
    !isBookContextQuery &&
    personLookupTerm &&
    asksSpecificUserInfo &&
    canLookupNamedUser &&
    (!hasAggregateOrTransaction || explicitIdentity) &&
    !/\b(terlambat|terbaru|paling|meminjam|mengembalikan|membaca)\b/.test(qPerson)
  ) {
    return answerUserDirectoryAdmin(query, userId, role);
  }

  if (isBorrowerRankingQuery(query)) {
    return answerMostActiveBorrowers(intent);
  }

  // Peminjam/masa akses ebook (Pustakawan/Admin). Dijawab dari EbookLoan dengan
  // label "masa akses aktif". Pertanyaan aktivitas membaca TIDAK disamakan
  // dengan masa akses: ADMIN memakai sesi reader, LIBRARIAN diberi keterbatasan
  // kewenangan yang jujur.
  if (
    isEbookBorrowerOrReadingQuery(query) &&
    !/\b(saya|aku|ku|punyaku)\b/.test(` ${normalizeQuery(query)} `)
  ) {
    return answerEbookBorrowerOperational(intent, query, role);
  }

  // Riwayat AUDIT pembuatan/penghapusan akun (khusus ADMIN). Non-ADMIN sudah
  // ditolak deterministik di answerRefusal sehingga umumnya tidak sampai ke sini;
  // handler tetap memeriksa role lagi sebagai sabuk pengaman.
  if (intent === "USER_AUDIT") {
    return answerUserAuditOperational(query, userId, role);
  }

  // Pertanyaan denda operasional dijawab deterministik dari DB agar jenis denda
  // (keterlambatan vs kerusakan) tidak tertukar.
  if (intent === "OPERATIONAL" && isFineQuery(query)) {
    return answerFinesOperational(intent, query, role, userId);
  }

  // Pertanyaan transaksi per-tanggal ("siapa yang meminjam buku pada tanggal X",
  // "siapa yang mengembalikan buku pada tanggal X", atau lanjutan bertanggal
  // "yang 17 Oktober 2026?") dijawab deterministik dari transaksi pada rentang
  // hari Asia/Jakarta agar jam/daftar peminjam tidak berasal dari tebakan model.
  // Bila bukan pertanyaan per-tanggal, fungsi mengembalikan null dan pertanyaan
  // diteruskan ke jalur berikutnya.
  const transactionsByDate = await answerTransactionsByDateOperational(
    intent,
    query,
    userId,
    hasHistory,
    previousUserMessages
  );
  if (transactionsByDate) return transactionsByDate;

  // Peminjaman AKTIF seluruh sistem ("buku apa saja yang sedang dipinjam",
  // "peminjaman yang belum dikembalikan", "pinjaman aktif"). Ditaruh setelah
  // pertanyaan per-tanggal agar "yang sedang dipinjam pada tanggal X" tetap
  // dijawab dari transaksi tanggal tersebut. Pertanyaan ini tentang TRANSAKSI,
  // bukan katalog koleksi, sehingga tidak boleh dijawab "tidak ada di katalog".
  if (isGlobalActiveLoansQuery(query)) {
    return answerActiveLoansOperational(intent, query, userId, role);
  }

  if (intent === "USER_COUNT") {
    return answerUserCount(intent, query, userId, role);
  }

  if (intent === "USER_DIRECTORY") {
    // Administrator boleh memperoleh identitas seluruh pengguna dari database.
    if (role === "ADMIN") {
      return answerUserDirectoryAdmin(query, userId, role);
    }
    // Jumlah pengguna agregat BUKAN izin untuk membuka identitas pengguna.
    return { message: USER_DIRECTORY_LIMITED, intent, verified: true, references: [] };
  }

  if (intent === "SYSTEM_SETTINGS" && role === "ADMIN") {
    const raw = await executeTool("get_system_settings", {}, userId, role);
    const data = JSON.parse(raw) as { settings?: Record<string, string>; error?: string };
    if (data.error || !data.settings) {
      return { message: SYSTEM_SETTINGS_UNAVAILABLE, intent, verified: true, references: [] };
    }
    const entries = Object.entries(data.settings);
    if (entries.length === 0) {
      return {
        message: "Belum ada pengaturan sistem non-sensitif yang tersedia.",
        intent,
        verified: true,
        references: [],
      };
    }
    const lines = entries.map(([key, value]) => `- ${SETTING_LABELS[key] ?? key}: ${value}`);
    const header =
      entries.length === 1
        ? "Saat ini hanya ada satu pengaturan sistem non-sensitif yang tersedia:"
        : "Pengaturan sistem non-sensitif yang tersedia:";
    return {
      message: `${header}\n\n${lines.join("\n")}`,
      intent,
      verified: true,
      references: [],
    };
  }

  return null;
}

async function answerCatalog(
  intent: Intent,
  query: string,
  allMessages: AIChatMessage[],
  role: string
): Promise<ChatSuccess | null> {
  const useOperationalModel =
    (role === "LIBRARIAN" || role === "ADMIN") &&
    (isOperationalQuery(query) || isUserDirectoryQuery(query) || isOtherUserDataRequest(query));
  if (
    (intent !== "CATALOG" &&
      intent !== "BOOK_PHYSICAL" &&
      intent !== "EBOOK_CATALOG" &&
      intent !== "BOOK_SUMMARY" &&
      intent !== "STATS") ||
    useOperationalModel
  ) {
    return null;
  }

  const previousUserMessages = allMessages
    .slice(0, -1)
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  const catalogQuery = mergeCatalogQuery(query, previousUserMessages);

  // Format ditentukan dari pertanyaan TERBARU bila ia menyebut format secara
  // eksplisit; konteks gabungan hanya dipakai untuk follow-up tanpa penanda
  // format (mis. "stoknya berapa?" setelah pertanyaan ebook). Bila follow-up
  // tidak menyebut format sama sekali, intent eksplisit (EBOOK_CATALOG /
  // BOOK_PHYSICAL) tetap menjadi acuan agar "Berapa jumlahnya?" setelah daftar
  // ebook tidak dijawab sebagai jumlah buku fisik.
  const catalogFormat = hasFormatCue(query)
    ? resolveCatalogFormat(query)
    : intent === "EBOOK_CATALOG"
      ? "EBOOK"
      : intent === "BOOK_PHYSICAL"
        ? "PHYSICAL"
        : resolveCatalogFormat(catalogQuery);

  try {
    const catalogResult = await buildCatalogAnswer(intent, catalogQuery, catalogFormat);
    return {
      message: catalogResult.message,
      intent,
      verified: true,
      references: catalogResult.references.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        coverUrl: r.coverUrl ?? null,
        available: typeof r.available === "number" ? r.available : null,
      })),
    };
  } catch (dbError) {
    console.error("[AI] Gagal mengambil data katalog.", dbError);
    return {
      message: CATALOG_DATA_UNAVAILABLE,
      intent,
      verified: true,
      references: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Konteks entitas buku spesifik (lanjutan deterministik, in-request).
// ---------------------------------------------------------------------------

const BOOK_FOLLOWUP_CLARIFICATION =
  "Buku mana yang Anda maksud? Mohon sebutkan judul buku yang dimaksud agar saya dapat memberikan informasi yang tepat.";

function normalizeBookRefs(
  refs: unknown
): Array<{ id: string; title: string; author: string }> {
  if (!Array.isArray(refs)) return [];
  const out: Array<{ id: string; title: string; author: string }> = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const id = typeof (ref as any)?.id === "string" ? (ref as any).id : "";
    const title = typeof (ref as any)?.title === "string" ? (ref as any).title : "";
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const author =
      typeof (ref as any)?.author === "string" ? (ref as any).author : "";
    out.push({ id, title, author });
  }
  return out;
}

function getLastAssistantBookRefs(
  messages: AIChatMessage[]
): Array<{ id: string; title: string; author: string }> {
  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const refs = normalizeBookRefs((m as any).references);
    if (refs.length > 0) return refs;
  }
  return [];
}

function hasExplicitDifferentBookName(
  query: string,
  focused: Array<{ id: string; title: string; author: string }>
): boolean {
  const q = normalizeQuery(query);
  // Jika menyebut judul/penulis buku fokus secara eksplisit, boleh (bukan buku lain).
  const mentionsFocused = focused.some((b) => {
    const t = b.title.toLowerCase();
    const a = (b.author || "").toLowerCase();
    return (t && q.includes(t)) || (a && a.length >= 4 && q.includes(a));
  });
  if (mentionsFocused) return false;

  // Sinyal nama buku eksplisit lain: ada kata kunci bermakna selain penanda rujukan/properti umum.
  const stop = new Set([
    "buku", "ebook", "judul", "ini", "itu", "tadi", "tersebut", "bukunya",
    "judulnya", "namanya", "apa", "apakah", "siapa", "berapa", "berapa", "ada",
    "yang", "dan", "atau", "dari", "untuk", "pada", "dengan", "di", "ke",
    "masih", "sudah", "saja", "tolong", "sebutkan", "tampilkan", "berikan",
    "kasih", "info", "informasi", "detail", "detailnya", "rincian", "rinciannya",
    "penulis", "penulisnya", "pengarang", "pengarangnya", "pencipta",
    "stok", "stoknya", "tersedia", "ketersediaan", "ketersediaannya", "bisa",
    "dipinjam", "dibaca", "tahun", "terbit", "diterbitkan", "penerbit",
    "penerbitnya", "kategori", "kategorinya", "isbn", "sinopsis", "deskripsi",
    "ringkasan", "ringkas", "mapel", "pelajaran", "kelas", "format", "berapa",
  ]);
  const tokens = q.split(/\s+/).filter((t) => t.length >= 4 && !stop.has(t));
  // Token bermakna tersisa biasanya menandakan pencarian/nama spesifik lain.
  return tokens.length > 0;
}

function isBookReferenceFollowUp(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\b(buku|judul|ebook)\s+(ini|itu|tadi|tersebut)\b/.test(q) ||
    /\b(ini|itu|tadi|tersebut)\s+(buku|judul|ebook)\b/.test(q) ||
    /\b(bukunya|judulnya|penulisnya|pengarangnya|penciptanya|stoknya|ketersediaannya|penerbitnya|kategorinya|tahunnya|sinopsisnya|deskripsinya)\b/.test(q) ||
    /\b(siapa\s+(penulis|pengarang|pencipta)(?:nya)?\b)/.test(q) ||
    /\b(apa\s+kategori(?:nya)?\b)/.test(q) ||
    /\b(diterbitkan\s+(tahun\s+berapa|kapan)|tahun\s+berapa\s+(terbit|diterbitkan)|kapan\s+(terbit|diterbitkan)|pada\s+tahun\s+berapa)\b/.test(q) ||
    /\b(stok(?:nya)?\s+berapa|berapa\s+stok(?:nya)?|berapa\s+(jumlah\s+)?stok)\b/.test(q) ||
    /\b(masih\s+tersedia|apakah\s+.*\btersedia\b|apakah\s+.*\bbisa\s+dipinjam\b)\b/.test(q)
  );
}

type BookProperty =
  | "DETAIL"
  | "AUTHOR"
  | "STOCK"
  | "AVAILABILITY"
  | "YEAR"
  | "PUBLISHER"
  | "CATEGORY"
  | "ISBN"
  | "SUBJECT"
  | "GRADE"
  | "FORMAT"
  | "DESCRIPTION";

function detectBookProperty(query: string): BookProperty | null {
  const q = normalizeQuery(query);
  if (/\b(detail|detailnya|rincian|rinciannya|informasi|info|sinopsis|deskripsi|ringkas|ringkasan|rangkum|summary)\b/.test(q)) {
    return "DETAIL";
  }
  if (/\b(siapa\s+(penulis|pengarang|pencipta)|penulis(?:nya)?\b|pengarang(?:nya)?\b|pencipta(?:nya)?\b)\b/.test(q)) {
    return "AUTHOR";
  }
  if (/\b(stok|stoknya|persediaan|berapa\s+stok|jumlah\s+stok)\b/.test(q)) {
    return "STOCK";
  }
  if (/\b(tersedia|ketersediaan|ketersediaannya|bisa\s+dipinjam|dapat\s+dipinjam|masih\s+ada|masih\s+tersedia)\b/.test(q)) {
    return "AVAILABILITY";
  }
  if (/\b(diterbitkan|tahun\s+berapa|terbit\s+kapan|kapan\s+terbit|tahun\s+terbit|tahunnya|pada\s+tahun\s+berapa)\b/.test(q)) {
    return "YEAR";
  }
  if (/\b(penerbit|penerbitnya|diterbitkan\s+oleh)\b/.test(q)) {
    return "PUBLISHER";
  }
  if (/\b(kategori|kategorinya|jenis\s+buku)\b/.test(q)) {
    return "CATEGORY";
  }
  if (/\bisbn\b/.test(q)) {
    return "ISBN";
  }
  if (/\b(mata\s+pelajaran|mapel|subjek|subject)\b/.test(q)) {
    return "SUBJECT";
  }
  if (/\b(kelas\s+berapa|tingkat\s+berapa|grade)\b/.test(q)) {
    return "GRADE";
  }
  if (/\b(format|bentuk|fisik\s+atau\s+ebook|ebook\s+atau\s+fisik)\b/.test(q)) {
    return "FORMAT";
  }
  return null;
}

function formatBookAvailability(book: { format?: string; stock: number; available: number }) {
  if (book.format === EBOOK_FORMAT) {
    return "Ebook aktif di katalog dan dapat dibaca di DigiLib (tanpa stok eksemplar fisik).";
  }
  if (book.stock <= 0) {
    return "Belum ada eksemplar yang tercatat (stok kosong).";
  }
  if (book.available <= 0) {
    return `Stok total ${book.stock} eksemplar, semuanya sedang dipinjam (0 tersedia).`;
  }
  const onLoan = Math.max(0, book.stock - book.available);
  const loanNote = onLoan > 0 ? `; ${onLoan} sedang dipinjam` : "";
  return `Tersedia ${book.available} dari ${book.stock} eksemplar${loanNote}.`;
}

function buildFocusedBookPropertyAnswer(
  book: Awaited<ReturnType<typeof getCatalogBookById>>,
  property: BookProperty,
  intent: Intent
): ChatSuccess | null {
  if (!book) return null;
  const ref = {
    id: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl ?? null,
    available: book.format === EBOOK_FORMAT ? null : book.available,
  };
  const base = (message: string): ChatSuccess => ({
    message,
    intent,
    verified: true,
    references: [ref],
  });

  switch (property) {
    case "DETAIL": {
      const summary = buildBookSummaryAnswer(book, false, (book.format as any) ?? undefined);
      return {
        message: summary.message,
        intent: "BOOK_SUMMARY",
        verified: true,
        references: summary.references.map((r) => ({
          id: r.id,
          title: r.title,
          author: r.author,
          coverUrl: r.coverUrl ?? null,
          available: typeof r.available === "number" ? r.available : r.available ?? null,
        })),
      };
    }
    case "AUTHOR":
      return base(`Penulis **${book.title}** adalah **${book.author}**.`);
    case "STOCK":
      if (book.format === EBOOK_FORMAT) {
        return base(
          `**${book.title}** adalah ebook dan tidak memiliki stok eksemplar fisik. Selama judulnya aktif di katalog, ebook dapat dibaca di DigiLib.`
        );
      }
      return base(
        `Stok **${book.title}**: total ${book.stock} eksemplar, tersedia ${Math.max(
          0,
          book.available
        )} eksemplar saat ini.`
      );
    case "AVAILABILITY":
      return base(`Ketersediaan **${book.title}**: ${formatBookAvailability(book)}`);
    case "YEAR":
      return base(
        book.year
          ? `**${book.title}** diterbitkan pada tahun **${book.year}**.`
          : `Tahun terbit **${book.title}** belum tercatat di katalog DigiLib.`
      );
    case "PUBLISHER":
      return base(
        book.publisher
          ? `Penerbit **${book.title}** adalah **${book.publisher}**.`
          : `Penerbit **${book.title}** belum tercatat di katalog DigiLib.`
      );
    case "CATEGORY":
      return base(`Kategori **${book.title}** adalah **${book.category}**.`);
    case "ISBN":
      return base(
        book.isbn
          ? `ISBN **${book.title}** adalah **${book.isbn}**.`
          : `ISBN **${book.title}** belum tercatat di katalog DigiLib.`
      );
    case "SUBJECT":
      return base(
        book.subject
          ? `Mata pelajaran **${book.title}** adalah **${book.subject}**.`
          : `Mata pelajaran **${book.title}** belum tercatat di katalog DigiLib.`
      );
    case "GRADE":
      return base(
        book.grade
          ? `**${book.title}** ditujukan untuk kelas **${book.grade}**.`
          : `Kelas untuk **${book.title}** belum tercatat di katalog DigiLib.`
      );
    case "FORMAT":
      return base(
        book.format === EBOOK_FORMAT
          ? `**${book.title}** adalah koleksi **ebook** (dibaca digital di DigiLib).`
          : `**${book.title}** adalah koleksi **buku fisik**.`
      );
    case "DESCRIPTION":
      return base(
        book.description
          ? `Deskripsi **${book.title}**: ${book.description}`
          : `Deskripsi/ringkasan isi **${book.title}** belum tercatat di katalog DigiLib.`
      );
    default:
      return null;
  }
}

async function answerFocusedBookFollowUp(
  query: string,
  allMessages: AIChatMessage[],
  intent: Intent
): Promise<ChatSuccess | null> {
  if (allMessages.length < 2) return null;
  const refs = getLastAssistantBookRefs(allMessages);
  if (refs.length === 0) return null;

  const q = normalizeQuery(query);
  const referential = isBookReferenceFollowUp(query);
  const property = detectBookProperty(query);
  // Pertanyaan properti buku tanpa kata rujukan eksplisit tetapi dalam konteks
  // percakapan (mis. "Diterbitkan tahun berapa?" setelah detail satu buku).
  const followUpContextual =
    !!property &&
    refs.length === 1 &&
    !hasExplicitDifferentBookName(query, refs) &&
    // Hindari menangkap pertanyaan katalog/operasional baru yang tidak merujuk buku fokus.
    !/\b(ada\s+berapa|berapa\s+buku|berapa\s+judul|kategori|carikan|rekomendasi|daftar\s+(buku|kategori|pengguna)|siapa\s+saya|peminjaman|denda|transaksi)\b/.test(q);

  if (!referential && !followUpContextual) return null;
  if (hasExplicitDifferentBookName(query, refs) && !referential) return null;

  if (refs.length > 1) {
    // Jika pengguna menyebut judul/penulis salah satu buku yang terdaftar, fokuskan ke itu.
    const matched = refs.filter((b) => {
      const t = (b.title || "").toLowerCase();
      const a = (b.author || "").toLowerCase();
      return (t && q.includes(t)) || (a && a.length >= 4 && q.includes(a));
    });
    if (matched.length === 1) {
      const book = await getCatalogBookById(matched[0].id);
      if (!book) return null;
      const prop = property ?? "DETAIL";
      return buildFocusedBookPropertyAnswer(book, prop, intent);
    }
    return {
      message: BOOK_FOLLOWUP_CLARIFICATION,
      intent: "CLARIFY",
      verified: true,
      references: [],
    };
  }

  const focused = refs[0];
  const book = await getCatalogBookById(focused.id);
  if (!book) {
    // Data buku tidak lagi tersedia di katalog aktif; jangan menebak.
    return null;
  }

  const prop = property ?? (referential ? "DETAIL" : null);
  if (!prop) return null;

  return buildFocusedBookPropertyAnswer(book, prop, intent);
}

// ---------------------------------------------------------------------------
// Tahap model.
// ---------------------------------------------------------------------------

async function answerWithModel(
  intent: Intent,
  history: AIChatMessage[],
  hasHistory: boolean,
  identity: UserIdentity,
  role: string,
  userId: string
): Promise<ChatSuccess> {
  if (!(await isAIConfigured())) {
    throw new ChatError(
      "Asisten AI belum dikonfigurasi. Administrator perlu mengatur provider dan API key melalui menu Konfigurasi AI (atau AI_API_KEY pada file .env).",
      503,
      "AI_NOT_CONFIGURED"
    );
  }

  const tools = toolsForRole(role);
  const systemPrompt: AIChatMessage = {
    role: "system",
    content: buildToolSystemPrompt({ identity, hasHistory, role }),
  };
  // Pertanyaan terbaru menjadi acuan format pada jalur model. Argumen model
  // hanya dipakai bila pertanyaan tidak menyebut format sama sekali.
  const latestUserQuery =
    [...history].reverse().find((message) => message.role === "user")?.content ?? "";

  let answer: string;
  // Identitas provider/model HANYA berasal dari respons request ini.
  let providerIdentity: AIResponseIdentity | null = null;
  // Bukti hanya dari tool yang benar-benar dieksekusi pada giliran ini.
  // Keberhasilan model menghasilkan teks TIDAK dihitung sebagai bukti.
  const evidence: ToolEvidence[] = [];
  const chatMessages = [systemPrompt, ...history];
  const toolExecutor = async (name: string, args: Record<string, unknown>) => {
    // `role` berasal dari akun yang dimuat server (processChat → loadAccount),
    // BUKAN dari payload pengguna. executeTool memakainya untuk memeriksa izin
    // kategori tool di backend sebelum handler menyentuh database.
    // Format statistik transaksi selalu mengikuti pertanyaan terbaru;
    // argumen model hanya dipakai bila pertanyaan tidak menyebut format.
    const toolArgs =
      name === "get_transaction_stats"
        ? {
            ...args,
            format: resolveTransactionFormat(latestUserQuery, args.format),
          }
        : args;
    const content = await executeTool(name, toolArgs, userId, role);
    evidence.push({ name, content, status: classifyToolResult(content) });
    return content;
  };

  try {
    const provider = await getAIProvider(userId);
    if (provider.chatWithToolsDetailed) {
      const result = await provider.chatWithToolsDetailed(chatMessages, tools, toolExecutor);
      answer = result.content;
      providerIdentity = {
        provider: result.provider,
        model: result.model,
        fallbackUsed: result.fallbackUsed,
        primaryProvider: result.primaryProvider,
        primaryModel: result.primaryModel,
      };
    } else if (provider.chatWithTools != null) {
      answer = await provider.chatWithTools(chatMessages, tools, toolExecutor);
    } else if (provider.chatDetailed) {
      const result = await provider.chatDetailed(chatMessages);
      answer = result.content;
      providerIdentity = {
        provider: result.provider,
        model: result.model,
        fallbackUsed: result.fallbackUsed,
        primaryProvider: result.primaryProvider,
        primaryModel: result.primaryModel,
      };
    } else {
      answer = await provider.chat(chatMessages);
    }
  } catch (error) {
    if (isAIProviderError(error)) {
      console.error("[AI] Provider error in answerWithModel:", {
        status: error.status,
        upstreamStatus: error.upstreamStatus,
        code: error.code,
        providerCode: error.providerCode,
        providerType: error.providerType,
        providerStatus: error.providerStatus,
        category: error.category,
        message: error.message,
        retryAfter: error.retryAfter,
      });
      // Batas penggunaan dikembalikan dengan pesan yang jelas; kegagalan lain
      // memakai pesan generik agar detail internal provider tidak bocor ke UI.
      if (error.status === 429) {
        throw new ChatError(
          FRIENDLY_RATE_LIMITED,
          429,
          "RATE_LIMITED",
          error.retryAfter
        );
      }
      throw new ChatError(FRIENDLY_FAILURE, 502, "AI_UNAVAILABLE");
    }
    console.error("[AI] Unexpected error in answerWithModel:", error);
    throw error;
  }

  const factualIntents = new Set([
    "OPERATIONAL",
    "USER_DIRECTORY",
    "USER_COUNT",
    "STATS",
    "MY_FINES",
    "MY_LOANS",
    "MY_HISTORY",
    "FINE_RATE",
    "CATALOG",
    "BOOK_PHYSICAL",
    "EBOOK_CATALOG",
    "USER_AUDIT",
  ]);
  if (factualIntents.has(intent) && !hasUsableToolEvidence(evidence)) {
    // Tool tidak dipanggil, gagal, atau hasilnya tidak valid: jangan pernah
    // membiarkan model menyusun jawaban faktual dari tebakan.
    throw new ChatError(
      "Data belum dapat diambil dari database. Silakan coba lagi.",
      502,
      "AI_UNAVAILABLE"
    );
  }

  if (typeof answer !== "string" || answer.trim().length === 0) {
    throw new ChatError(FRIENDLY_FAILURE, 502);
  }

  let finalAnswer = stripInternalMarkers(answer);
  if (finalAnswer.length === 0) {
    throw new ChatError(FRIENDLY_FAILURE, 502);
  }

  if (containsInternalPromptLeak(finalAnswer)) {
    console.warn("[AI] jawaban memuat isi instruksi sistem — diblokir.");
    finalAnswer = INTERNAL_PROMPT_REFUSAL;
  } else {
    const guarded = enforceNoSourceCode(finalAnswer);
    if (guarded.blocked) {
      console.warn("[AI] jawaban memuat source code — diblokir.");
    }
    finalAnswer = guarded.answer;
  }

  // Nama fungsi/tool internal (mis. `get_my_history`), istilah "tool/intent/
  // pipeline", atau ajakan "memanggil fungsi" TIDAK boleh muncul di jawaban
  // pengguna. Kalimat yang memuatnya dibuang; bila tidak ada sisa yang bermakna,
  // dipakai pesan aman. Ini menutup kebocoran istilah internal di akar jalurnya,
  // bukan sekadar menghapus satu string dari prompt.
  const sanitized = sanitizeInternalTerms(finalAnswer);
  if (sanitized !== finalAnswer) {
    console.warn("[AI] jawaban memuat istilah internal — dibersihkan.");
    finalAnswer = sanitized;
  }

  // Sumber angka yang sah: hasil tool + pertanyaan pengguna sendiri (mis. tanggal
  // yang diminta). Angka lain dianggap klaim yang tidak dapat ditelusuri.
  const allowedClaimSources = [
    latestUserQuery,
    ...history.filter((message) => message.role === "user").map((message) => message.content),
  ].filter(Boolean);
  const verified = verifyModelAnswer(finalAnswer, evidence, intent, allowedClaimSources);

  if (factualIntents.has(intent) && !verified) {
    // Data ada, tetapi jawaban model memuat angka/judul yang tidak dapat
    // ditelusuri ke hasil query. Jangan pernah menampilkannya sebagai fakta.
    throw new ChatError(
      "Jawaban tidak dapat diverifikasi dari data perpustakaan. Silakan coba lagi.",
      502,
      "AI_UNAVAILABLE"
    );
  }

  return {
    message: finalAnswer,
    intent,
    verified,
    references: [],
    ...(providerIdentity ? { ai: providerIdentity } : {}),
  };
}

// ---------------------------------------------------------------------------
// Orkestrasi.
// ---------------------------------------------------------------------------

export interface ProcessChatInput {
  userId: string;
  messages: unknown;
}

/**
 * Jalankan seluruh pipeline dan kembalikan jawaban terstruktur.
 * Melempar `ChatError` untuk kegagalan yang sudah dipetakan ke HTTP.
 */
function isRoleInfoQuery(query: string): boolean {
  const q = normalizeQuery(query);
  if (!/\brole\b/.test(q)) return false;
  if (/\b(pengguna|user|anggota)\b/.test(q)) return false;
  return /\b(berapa|jumlah|ada|apa\s+saja|siapa\s+saja|daftar|list|tersedia|sebutkan|tampilkan)\b/.test(q);
}

async function answerRoleInfo(query: string): Promise<ChatSuccess> {
  const q = normalizeQuery(query);
  const roleFilter = detectUserRoleFilter(query);
  const wantsList = /\b(apa\s+saja|siapa\s+saja|daftar|list|sebutkan|tampilkan)\b/.test(q);

  let roleKeys: string[] = [];
  const groupBy =
    typeof prisma.user?.groupBy === "function" ? prisma.user.groupBy.bind(prisma.user) : null;
  if (groupBy) {
    try {
      const groups = (await groupBy({ by: ["role"], _count: { _all: true } } as any)) as Array<{
        role: string;
      }>;
      roleKeys = (groups ?? []).map((g) => g.role).filter(Boolean);
    } catch {
      roleKeys = [];
    }
  }
  if (roleKeys.length === 0) {
    roleKeys = [...ALL_SYSTEM_ROLES];
  }
  if (roleFilter) {
    roleKeys = roleKeys.filter((role) => role === roleFilter);
    if (roleKeys.length === 0) roleKeys = [roleFilter];
  }

  const labels = roleKeys.map((role) => ROLE_LABEL[role] ?? role);
  const message = wantsList
    ? `Role yang tersedia${roleFilter ? " untuk siswa" : ""}: ${labels.join(", ")}.`
    : `Ada ${labels.length} role dalam sistem.`;
  return { message, intent: "CHITCHAT", verified: true, references: [] };
}

function isModelInfoQuery(query: string): boolean {
  const q = normalizeQuery(query);
  if (/\bmodel\b/.test(q) || /\bprovider\b/.test(q)) {
    return /\b(apa|yang|sedang|digunakan|aktif|dipakai|pakai)\b/.test(q);
  }
  // "AI" alone only counts when explicitly asking about usage/active model.
  return /\bai\b/.test(q) && /\b(digunakan|aktif|dipakai|sedang)\b/.test(q);
}

async function answerModelInfo(query: string): Promise<ChatSuccess> {
  const { getRuntimeAIConfig } = await import("@/lib/ai/configStore");
  const { getAIProviderDefinition } = await import("@/lib/ai/providers");
  const runtime = await getRuntimeAIConfig();
  if (runtime.status === "active" || runtime.status === "env") {
    let providerLabel: string = runtime.provider;
    try {
      providerLabel = getAIProviderDefinition(runtime.provider as any).label;
    } catch {
      providerLabel = runtime.provider;
    }
    const fallbackNote =
      runtime.fallbackModels.length > 0
        ? ` Model cadangan yang tersedia: ${runtime.fallbackModels.join(", ")}.`
        : "";
    return {
      message: `AI yang sedang digunakan: ${providerLabel} (${runtime.model}).${fallbackNote}`,
      intent: "CHITCHAT",
      verified: true,
      references: [],
    };
  }
  if (runtime.status === "invalid") {
    return {
      message: `Konfigurasi AI tidak dapat dibaca: ${runtime.error}`,
      intent: "CHITCHAT",
      verified: true,
      references: [],
    };
  }
  return {
    message: "Belum ada konfigurasi AI aktif.",
    intent: "CHITCHAT",
    verified: true,
    references: [],
  };
}

function isFactualIntent(intent: Intent): boolean {
  return [
    "OPERATIONAL",
    "USER_DIRECTORY",
    "USER_COUNT",
    "STATS",
    "MY_FINES",
    "MY_LOANS",
    "MY_HISTORY",
    "FINE_RATE",
    "CATALOG",
    "BOOK_PHYSICAL",
    "EBOOK_CATALOG",
    "USER_AUDIT",
  ].includes(intent);
}

export async function processChat(input: ProcessChatInput): Promise<ChatSuccess> {
  const { userId } = input;

  const account = await loadAccount(userId);
  checkRateLimit(userId);

  const invalid = validateChatPayload(input.messages);
  if (invalid) {
    throw new ChatError(invalid, 400);
  }

  const allMessages = input.messages as AIChatMessage[];
  // Gunakan teks asli untuk jawaban (AI menerima teks asli), tapi normalisasi
  // dilakukan secara transparan di detectIntent/detectPersonalIntent.
  const query = allMessages[allMessages.length - 1].content.trim().replace(/\s+/g, " ");
  const hasHistory = allMessages.length > 1;
  const identity: UserIdentity = toUserIdentity(account);

  const greeting = answerGreeting(query, identity);
  if (greeting) return greeting;

  const history = selectHistory(allMessages);
  const deterministicIntent = detectIntent(query, hasHistory);

  // Rujukan lanjutan ke buku spesifik terakhir (berdasarkan ID/referensi hasil
  // sebelumnya pada percakapan ini). Diprioritaskan agar konteks entitas tidak
  // hilang saat resolver topik gagal mengenali lanjutan.
  const focusedBookAnswerEarly = await answerFocusedBookFollowUp(
    query,
    allMessages,
    deterministicIntent
  );
  if (focusedBookAnswerEarly) return focusedBookAnswerEarly;

  // Resolusi konteks HANYA memahami maksud/referensi lanjutan. Fakta tetap
  // diambil ulang dari database oleh handler deterministik.
  const context = resolveConversationContext({
    query,
    messages: allMessages,
    intent: deterministicIntent,
    role: account.role,
  });
  if (context.clarification) {
    return {
      message: context.clarification,
      intent: "CLARIFY",
      verified: true,
      references: [],
    };
  }
  let intent = context.intent;
  let effectiveQuery = context.query;
  let classifierEnriched = false;

  if (isRoleInfoQuery(query)) {
    return answerRoleInfo(query);
  }
  if (isModelInfoQuery(query)) {
    return answerModelInfo(query);
  }

  // NLU hibrida: panggil classifier HANYA bila aturan deterministik tidak yakin.
  // Hasilnya divalidasi backend; kegagalan berarti tetap memakai intent
  // deterministik (fail-safe, bukan menebak). Dijalankan SEBELUM penolakan RBAC
  // agar intent hasil classifier tetap melewati otorisasi yang sama.
  if (
    intent === "CHITCHAT" &&
    !context.resolved &&
    !detectRoleInquiryTarget(query) &&
    (await isAIConfigured())
  ) {
    const classification = await classifyIntent(query, allMessages);
    if (classification) {
      if (classification.intent === "CLARIFY") {
        return {
          message: CLASSIFIER_CLARIFICATION,
          intent: "CLARIFY",
          verified: true,
          references: [],
        };
      }
      intent = classification.intent;
      const hints = buildClassifierQuery(intent, effectiveQuery, classification.parameters);
      if (hints.rejected.length > 0 && hints.applied.length === 0) {
        // Ada parameter relevan yang tidak valid: jangan menebak scope data.
        return {
          message: CLASSIFIER_CLARIFICATION,
          intent: "CLARIFY",
          verified: true,
          references: [],
        };
      }
      if (hints.applied.length > 0) {
        effectiveQuery = hints.query;
        classifierEnriched = true;
      }
    }
  }

  const refusal = answerRefusal(intent, effectiveQuery, account.role);
  if (refusal) return refusal;

  // Tugas/kewajiban/peran/hak akses pengguna sendiri dijawab deterministik dari
  // matriks izin role (access.ts) — bukan oleh model — agar tidak muncul daftar
  // tugas generik yang tidak sesuai DigiLib.
  if (intent === "MY_CAPABILITIES" || intent === "ADMIN_CAPABILITIES") {
    return {
      message: buildRoleCapabilityAnswer(account.role),
      intent,
      verified: true,
      references: [],
    };
  }

  // Pertanyaan tentang tugas/fungsi/hak akses role tertentu (dari query teks).
  // answerRefusal sudah menolak non-admin yang bertanya tentang role lain.
  // Blok ini menangani sisa: Admin bertanya tentang role apa pun, atau pengguna
  // bertanya tentang role-nya sendiri (berbeda penjelasan dengan MY_CAPABILITIES).
  {
    const targetRole = detectRoleInquiryTarget(query);
    if (targetRole) {
      const isSelf = account.role === targetRole;
      return {
        message: buildRoleExplanation(targetRole, isSelf),
        intent: "MY_CAPABILITIES",
        verified: true,
        references: [],
      };
    }
  }

  // Pertanyaan TARIF denda dijawab deterministik dari pengaturan aktif, bukan
  // dari data denda pribadi maupun daftar denda pengguna lain. Dijawab sebelum
  // jalur personal agar ADMIN/PUSTAKAWAN tidak menerima pesan "bukan peminjam".
  if (intent === "FINE_RATE") {
    return answerFineRate(intent, effectiveQuery);
  }

  // Transaksi MILIK SENDIRI pada satu tanggal ("kemarin?", "kapan saya pinjam
  // buku 18 Oktober") dijawab deterministik dari database pengguna, sehingga
  // model tidak pernah mengarang transaksi bertanggal untuk pengguna (Kasus A).
  // Riwayat percakapan hanya dipakai untuk memahami maksud lanjutan.
  const previousUserMessages = allMessages
    .slice(0, -1)
    .filter((m) => m.role === "user")
    .map((m) => m.content);

  // Rujukan lanjutan ke buku spesifik terakhir (ID dari hasil katalog/detail
  // sebelumnya pada percakapan ini). Bila teridentifikasi satu buku, ambil
  // informasi langsung dari database berdasarkan ID — tanpa pencarian umum.
  const focusedBookAnswer = await answerFocusedBookFollowUp(
    effectiveQuery,
    allMessages,
    intent
  );
  if (focusedBookAnswer) return focusedBookAnswer;

  const ownByDate = await answerMyBorrowsByDate(
    effectiveQuery,
    userId,
    account.role,
    hasHistory,
    previousUserMessages
  );
  if (ownByDate) return ownByDate;

  // Pertanyaan keterlambatan GLOBAL ("Buku apa saja yang sedang terlambat?")
  // untuk Pustakawan/Admin adalah data operasional seluruh sistem, bukan
  // "pinjaman saya". Melewati jalur personal agar dijawab dari database oleh
  // `answerOperational`. STUDENT/TEACHER tetap memakai jalur personal.
  const globalOverdueForStaff =
    (account.role === "LIBRARIAN" || account.role === "ADMIN") &&
    isGlobalOverdueQuery(effectiveQuery);

  // Peminjaman aktif tanpa kata ganti orang pertama juga data operasional bagi
  // staf. Tanpa pengalihan ini Pustakawan/Admin menerima pesan "Anda bukan
  // peminjam" padahal yang ditanya adalah transaksi seluruh sistem.
  const activeLoansForStaff =
    (account.role === "LIBRARIAN" || account.role === "ADMIN") &&
    isGlobalActiveLoansQuery(effectiveQuery);

  // Aktivitas membaca MILIK SENDIRI dijawab dari EbookReadingSession. Ini
  // dipisahkan dari peminjaman aktif agar konsepnya tidak tercampur.
  if (isMyReadingActivityQuery(effectiveQuery)) {
    return answerMyReadingActivity(intent, effectiveQuery, userId);
  }

  // Pustakawan/Admin yang bertanya tentang peminjaman/aktivitas ebook tanpa kata
  // ganti orang pertama diarahkan ke data operasional (EbookLoan seluruh
  // sistem), bukan ke pesan "Anda bukan peminjam". Pertanyaan dengan "saya"
  // tetap personal.
  const ebookOverviewForStaff =
    (account.role === "LIBRARIAN" || account.role === "ADMIN") &&
    isEbookBorrowerOrReadingQuery(effectiveQuery) &&
    !/\b(saya|aku|ku|punyaku)\b/.test(` ${normalizeQuery(effectiveQuery)} `);
  const readingActivityForStaff =
    (account.role === "LIBRARIAN" || account.role === "ADMIN") &&
    isGlobalReadingActivityQuery(effectiveQuery);
  // Riwayat/seluruh peminjaman ebook untuk staf adalah data operasional, bukan
  // riwayat pribadi (staf bukan peminjam). Jangan jatuh ke pesan "bukan peminjam".
  const ebookLoanHistoryForStaff =
    (account.role === "LIBRARIAN" || account.role === "ADMIN") &&
    isEbookLoanHistoryQuery(effectiveQuery);

  const staffFineQuery =
    (account.role === "LIBRARIAN" || account.role === "ADMIN") &&
    isFineQuery(effectiveQuery) &&
    !( ` ${normalizeQuery(effectiveQuery)} `.includes(" saya ") || ` ${normalizeQuery(effectiveQuery)} `.includes(" aku ") || ` ${normalizeQuery(effectiveQuery)} `.includes(" ku ") || ` ${normalizeQuery(effectiveQuery)} `.includes(" punyaku ") );
  if (/\bnotifikasi\b/.test(normalizeQuery(effectiveQuery))) {
    return answerMyNotifications(effectiveQuery, userId);
  }

  const personal =
    globalOverdueForStaff ||
    activeLoansForStaff ||
    ebookOverviewForStaff ||
    readingActivityForStaff ||
    ebookLoanHistoryForStaff ||
    staffFineQuery
      ? null
      : await answerPersonal(intent, effectiveQuery, userId, account.role);
  if (personal) return personal;
  if (staffFineQuery) {
    const fineAnswer = await answerFinesOperational(
      intent,
      effectiveQuery,
      account.role,
      userId
    );
    if (fineAnswer) return fineAnswer;
  }

  const operational = await answerOperational(
    intent,
    effectiveQuery,
    account.role,
    userId,
    hasHistory,
    previousUserMessages
  );
  if (operational) return operational;

  // Katalog memakai merge konteks internalnya sendiri. Query hasil pengayaan
  // parameter classifier diteruskan agar filter format/status ikut berlaku.
  const catalog = await answerCatalog(
    intent,
    classifierEnriched ? effectiveQuery : query,
    allMessages,
    account.role
  );
  if (catalog) return catalog;

  // Bila konteks/parameter classifier mengubah maksud, model menerima query
  // gabungan agar parameter lanjutan tidak hilang. Identitas model tetap per
  // request.
  const modelHistory =
    context.resolved || classifierEnriched
      ? [
          ...history.slice(0, -1),
          { role: "user" as const, content: effectiveQuery },
        ]
      : history;

  return answerWithModel(intent, modelHistory, hasHistory, identity, account.role, userId);
}

/** Sapaan personal untuk UI (GET /api/ai/chat). */
export async function getGreeting(userId: string): Promise<string> {
  const account = await loadAccount(userId);
  return buildPersonalGreeting(toUserIdentity(account));
}
