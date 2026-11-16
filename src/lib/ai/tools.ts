/**
 * Fungsi (tools) yang bisa dipanggil model AI.
 *
 * Tujuannya agar asisten memahami konteks kalimat — bukan sekadar kata kunci —
 * dan menyusun jawaban dari hasil query database yang AKTUAL, untuk seluruh
 * fitur DigiLib: katalog buku, ketersediaan, ringkasan buku, statistik,
 * peminjaman aktif, riwayat, denda, notifikasi milik pengguna yang login,
 * serta data operasional dan administratif sesuai role.
 *
 * KATEGORI TOOL (dibatasi role — lihat access.ts):
 * - PERSONAL:       Semua role. Data milik pengguna yang login.
 * - OPERATIONAL:    LIBRARIAN, ADMIN. Data seluruh sistem (transaksi, denda,
 *                   keterlambatan, ebook loan).
 * - ADMINISTRATIVE: ADMIN saja. Jumlah/statistik pengguna per role, pengaturan
 *                   non-sensitif, dan riwayat audit pembuatan/penghapusan akun.
 *
 * Keamanan:
 * - Semua fungsi pribadi WAJIB memakai `userId` dari sesi (diisi route).
 * - Hasil fungsi HANYA data database; model tidak pernah menerima data
 *   pengguna lain (kecuali tool OPERATIONAL/ADMINISTRATIVE yang memang
 *   diizinkan untuk role tersebut).
 * - Kegagalan query dikembalikan sebagai { error } agar model menyatakan
 *   data belum dapat diakses, bukan mengklaim kosong.
 * - Tool ADMINISTRATIVE tidak pernah membocorkan password, token, secret,
 *   atau kredensial database.
 */

import { prisma } from "@/lib/prisma";
import { ACTIVE_BORROW_STATUSES, calculateLateDays } from "@/lib/config/library";
import { getEbookAccessState } from "@/lib/config/ebook";
import {
  JAKARTA_TIME_ZONE,
  formatWibDateTime,
  jakartaRelativeRange,
  jakartaTodayRange,
  resolveJakartaDateRange,
  type ResolvedJakartaDate,
} from "@/lib/ai/datetime";
import {
  findBookByReference,
  getCatalogStats,
  listAllCatalogBooks,
  searchCatalogBooks,
  CatalogBook,
} from "./catalog";
import {
  getOperationalStats,
  resolveStatsPeriodInput,
  resolveTransactionFormat,
  type StatsPeriod,
  type TransactionFormat,
} from "./operationalStats";
import { resolveCatalogFormat } from "./catalogFormat";
import {
  getMyReadingActivity,
  isReadingPeriodKey,
  listReadingActivity,
  resolveReadingPeriod,
} from "@/lib/ebook-reading";
import {
  isReadingActivityStatus,
  readingActivityStatusLabel,
  READING_ACTIVITY_CONFIG,
  type ReadingActivityStatus,
} from "@/lib/config/reading";
import { getActiveEbookLoans,
  getActiveLoans,
  getBorrowHistory,
  getEbookHistory,
  getPersonalFines,
  getPendingRequests,
} from "./personal";
import { AIToolDefinition } from "./types";
import { canUseToolCategory, AIToolCategory } from "./access";
import { getUserActiveLoans, getUserHistoryTotals } from "@/lib/transactionStats";

/** Batas baris agar payload tool tetap ringan. */
const TOOL_ROW_LIMIT = 12;

/** Batas baris riwayat audit akun (khusus ADMIN). */
const AUDIT_ROW_LIMIT = 20;

/**
 * Key Setting yang BOLEH dibaca AI Admin. Daftar ini eksplisit — key lain
 * (mis. secret, token, kredensial) tidak pernah boleh dikirim ke model.
 */
const ALLOWED_SETTING_KEYS = new Set(["finePerDayIDR"]);

/** Role pengguna yang sah, dipakai filter direktori Admin. */
const VALID_USER_ROLES = new Set([
  "ADMIN",
  "LIBRARIAN",
  "TEACHER",
  "STUDENT",
  "STAFF",
]);

/**
 * Kolom identitas pengguna yang aman untuk ditampilkan ke Administrator.
 * `passwordHash` TIDAK PERNAH termasuk — sama seperti endpoint /api/admin/users.
 */
const ADMIN_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  identityNumber: true,
  class: true,
  createdAt: true,
} as const;

function bookPayload(book: CatalogBook) {
  return {
    title: book.title,
    author: book.author,
    format: book.format,
    stock: book.stock,
    available: book.available,
    category: book.category,
    grade: book.grade,
    subject: book.subject,
    major: book.major,
  };
}

/** Label status fisik yang mengikuti tanggal/status transaksi apa adanya. */
function borrowStatusLabel(item: {
  status: string;
  returnDate: Date | null;
  dueDate: Date;
  overdue: boolean;
}): string {
  if (item.returnDate || item.status === "RETURNED") return "sudah dikembalikan";
  if (
    item.status === "OVERDUE" ||
    item.overdue ||
    item.dueDate.getTime() < Date.now()
  ) {
    return "terlambat (belum dikembalikan)";
  }
  if (item.status === "BORROWED") return "sedang dipinjam";
  if (item.status === "REQUESTED") return "menunggu persetujuan";
  if (item.status === "CANCELLED") return "dibatalkan";
  if (item.status === "REJECTED") return "ditolak";
  return item.status.toLowerCase();
}

/** Label status ebook; ACTIVE berarti masa akses berlaku, bukan sedang dibaca. */
function ebookStatusLabel(item: {
  status: string;
  returnDate: Date | null;
  overdue: boolean;
}): string {
  if (item.returnDate || item.status === "RETURNED") return "sudah dikembalikan";
  if (item.status === "EXPIRED" || item.overdue) return "kedaluwarsa";
  if (item.status === "ACTIVE") return "masa akses aktif";
  return item.status.toLowerCase();
}

/** Ringkas item peminjaman fisik untuk payload tool (tanggal dalam WIB). */
function borrowPayload(item: {
  id?: string;
  bookId?: string;
  title: string;
  author: string;
  status: string;
  borrowDate: Date;
  dueDate: Date;
  returnDate: Date | null;
  overdue: boolean;
  daysLate?: number;
}) {
  const lateDays = Math.max(0, item.daysLate ?? 0);
  return {
    transactionId: item.id ?? null,
    bookId: item.bookId ?? null,
    media: "PHYSICAL",
    title: item.title,
    author: item.author,
    status: item.status,
    statusLabel: borrowStatusLabel(item),
    borrowDate: formatWibDateTime(item.borrowDate),
    dueDate: formatWibDateTime(item.dueDate),
    returnDate: item.returnDate ? formatWibDateTime(item.returnDate) : null,
    overdue: item.overdue,
    daysLate: lateDays,
    timeZone: JAKARTA_TIME_ZONE,
  };
}

/** Ringkas item EbookLoan untuk payload tool (tanggal dalam WIB). */
function ebookLoanPayload(item: {
  id?: string;
  bookId?: string;
  title: string;
  author: string;
  status: string;
  borrowDate: Date;
  dueDate: Date;
  returnDate: Date | null;
  overdue: boolean;
  daysRemaining: number;
}) {
  return {
    transactionId: item.id ?? null,
    bookId: item.bookId ?? null,
    media: "EBOOK",
    title: item.title,
    author: item.author,
    status: item.status,
    statusLabel: ebookStatusLabel(item),
    borrowDate: formatWibDateTime(item.borrowDate),
    dueDate: formatWibDateTime(item.dueDate),
    returnDate: item.returnDate ? formatWibDateTime(item.returnDate) : null,
    overdue: item.overdue,
    daysRemaining: item.daysRemaining,
    timeZone: JAKARTA_TIME_ZONE,
  };
}

/** Ringkas identitas pengguna untuk tool ADMIN. Tidak pernah memuat passwordHash. */
function adminUserPayload(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  identityNumber: string | null;
  class: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    identityNumber: user.identityNumber,
    class: user.class,
    createdAt: formatWibDateTime(user.createdAt),
  };
}

/** Ringkas sesi aktivitas membaca untuk payload tool (tanggal dalam WIB). */
function readingActivityPayload(item: {
  user?: { name: string; role: string };
  book: { title: string; author: string; pageCount: number | null };
  loan: { accessState: string } | null;
  firstOpenedAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
  status: string;
  activityCount: number;
  lastPage: number | null;
  progressPercent: number | null;
  progressAvailable: boolean;
}) {
  return {
    ...(item.user ? { user: item.user.name, role: item.user.role } : {}),
    title: item.book.title,
    author: item.book.author,
    firstOpenedAt: formatWibDateTime(item.firstOpenedAt),
    lastActivityAt: formatWibDateTime(item.lastActivityAt),
    endedAt: item.endedAt ? formatWibDateTime(item.endedAt) : null,
    status: item.status,
    statusLabel: readingActivityStatusLabel(item.status as ReadingActivityStatus),
    activityCount: item.activityCount,
    loanAccessState: item.loan?.accessState ?? "NO_LOAN",
    pageCount: item.book.pageCount,
    lastPage: item.lastPage,
    progressPercent: item.progressPercent,
    progressAvailable: item.progressAvailable,
    timeZone: JAKARTA_TIME_ZONE,
  };
}

function resolveToolReadingPeriod(input: unknown): {
  start?: Date;
  end?: Date;
  label: string;
} {
  const raw = typeof input === "string" ? input.trim() : "";
  if (isReadingPeriodKey(raw)) return resolveReadingPeriod(raw);
  const parsed = resolveStatsPeriodInput(raw);
  if (parsed) {
    return { start: parsed.start, end: parsed.end, label: parsed.label };
  }
  return { label: "seluruh periode" };
}

/**
 * Ambil email & role AKUN TARGET dari teks `details` AuditLog.
 *
 * Skema `AuditLog` tidak menyimpan relasi ke akun target; identitas target hanya
 * tersedia bila penulis audit menyertakannya pada `details` (format internal
 * "…: email (ROLE)"). Bila tidak ada, hasilnya null — jangan menebak.
 */
function extractAuditTarget(details: string | null): {
  email: string | null;
  role: string | null;
} {
  if (!details) return { email: null, role: null };
  const withRole = /([\w.+-]+@[\w.-]+)\s*\(([A-Z_]+)\)/.exec(details);
  if (withRole) return { email: withRole[1], role: withRole[2] };
  const emailOnly = /([\w.+-]+@[\w.-]+)/.exec(details);
  return { email: emailOnly ? emailOnly[1] : null, role: null };
}

/**
 * Rentang satu hari Asia/Jakarta dari argumen tool `date`:
 * "today"/"hari ini", "yesterday"/"kemarin", atau tanggal eksplisit
 * (YYYY-MM-DD / "18 Oktober" / "18/10/2026"). Mengembalikan null bila tidak
 * dapat dipahami — handler mengembalikan error agar model tidak menebak.
 */
function resolveToolDateRange(input: string): ResolvedJakartaDate | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === "today" || value === "hari ini") return jakartaTodayRange();
  if (value === "yesterday" || value === "kemarin") return jakartaRelativeRange(-1);
  return resolveJakartaDateRange(value);
}

// ---------------------------------------------------------------------------
// Bantuan jumlah pengguna (ADMIN). Filter OPSIONAL; tanpa filter perilakunya
// tetap sama: menghitung SELURUH akun (termasuk nonaktif), sesuai halaman
// Pengguna dan dashboard Admin.
// ---------------------------------------------------------------------------

const USER_ROLES = ["ADMIN", "LIBRARIAN", "TEACHER", "STUDENT", "STAFF"] as const;

const USER_ROLE_ALIASES: Record<string, (typeof USER_ROLES)[number]> = {
  ADMIN: "ADMIN",
  ADMINISTRATOR: "ADMIN",
  LIBRARIAN: "LIBRARIAN",
  PUSTAKAWAN: "LIBRARIAN",
  TEACHER: "TEACHER",
  GURU: "TEACHER",
  STUDENT: "STUDENT",
  SISWA: "STUDENT",
  MURID: "STUDENT",
  STAFF: "STAFF",
  STAF: "STAFF",
};

function normalizeUserRole(value: unknown): (typeof USER_ROLES)[number] | null {
  if (typeof value !== "string") return null;
  return USER_ROLE_ALIASES[value.trim().toUpperCase()] ?? null;
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "ya", "aktif", "active"].includes(normalized)) return true;
  if (["false", "0", "tidak", "nonaktif", "inactive"].includes(normalized)) return false;
  return null;
}

function normalizeUserGender(value: unknown): "MALE" | "FEMALE" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["male", "m", "laki-laki", "laki laki", "pria", "putra"].includes(normalized)) {
    return "MALE";
  }
  if (["female", "f", "perempuan", "wanita", "putri"].includes(normalized)) {
    return "FEMALE";
  }
  return null;
}

/** Normalisasi nilai kelas agar cocok dengan data `User.class` (mis. "XII IPA 1"). */
function normalizeUserClass(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (!normalized) return null;

  const tokens = normalized.split(" ");
  const romanByNumber: Record<string, string> = { "10": "X", "11": "XI", "12": "XII" };
  tokens[0] = romanByNumber[tokens[0]] ?? tokens[0];
  return tokens.join(" ");
}

function userCountFilters(args: Record<string, unknown>): {
  role: (typeof USER_ROLES)[number] | null;
  isActive: boolean | null;
  period: StatsPeriod | null;
  gender: "MALE" | "FEMALE" | null;
  classValue: string | null;
} {
  const periodInput = String(args.period ?? "").trim();
  return {
    role: normalizeUserRole(args.role),
    isActive: parseOptionalBoolean(args.isActive),
    period: periodInput ? resolveStatsPeriodInput(periodInput) : null,
    gender: normalizeUserGender(args.gender),
    classValue: normalizeUserClass(args.class),
  };
}

function userWhere(
  role: (typeof USER_ROLES)[number],
  isActive: boolean | null,
  period: StatsPeriod | null,
  gender: "MALE" | "FEMALE" | null,
  classValue: string | null
): Record<string, unknown> {
  // Kelas satu/tanpa jurusan (mis. "XII" atau "XII IPA") diperlakukan sebagai
  // awalan; kelas lengkap ("XII IPA 1") dicocokkan persis.
  const classFilter =
    classValue !== null
      ? classValue.split(" ").length <= 2
        ? { class: { startsWith: classValue } }
        : { class: classValue }
      : {};

  return {
    role,
    ...(isActive !== null ? { isActive } : {}),
    ...(gender !== null ? { gender } : {}),
    ...classFilter,
    ...(period ? { createdAt: { gte: period.start, lt: period.end } } : {}),
  };
}

/**
 * Hitung pengguna per role dengan filter opsional. Total SELALU penjumlahan
 * per-role (bukan angka terpisah) agar tidak ada penghitungan ganda.
 */
async function countUsers(args: Record<string, unknown>) {
  const { role, isActive, period, gender, classValue } = userCountFilters(args);
  const hasFilters =
    role !== null ||
    isActive !== null ||
    period !== null ||
    gender !== null ||
    classValue !== null;

  if (role) {
    const totalUsers = await prisma.user.count({
      where: userWhere(role, isActive, period, gender, classValue),
    });
    return {
      totalUsers,
      byRole: { [role]: totalUsers },
      ...(hasFilters
        ? {
            filters: {
              role,
              isActive,
              period: period ? { key: period.key, label: period.label } : null,
              gender,
              class: classValue,
            },
          }
        : {}),
    };
  }

  const counts = await Promise.all(
    USER_ROLES.map((item) =>
      prisma.user.count({
        where: userWhere(item, isActive, period, gender, classValue),
      })
    )
  );
  const byRole: Record<string, number> = {};
  USER_ROLES.forEach((item, index) => {
    byRole[item] = counts[index];
  });

  return {
    totalUsers: counts.reduce((sum, count) => sum + count, 0),
    byRole,
    ...(hasFilters
      ? {
          filters: {
            role: null,
            isActive,
            period: period ? { key: period.key, label: period.label } : null,
            gender,
            class: classValue,
          },
        }
      : {}),
  };
}

/**
 * Rincian jumlah transaksi per status. Dibungkus guard agar kegagalan
 * groupBy (mis. pada lingkungan uji) tidak menggagalkan total utama.
 */
async function countBorrowStatuses(
  where: Record<string, unknown>
): Promise<Record<string, number>> {
  try {
    const groups = await prisma.borrowRecord.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const group of groups as Array<{ status: string; _count?: { _all?: number } }>) {
      const value = group._count?._all;
      if (typeof value === "number" && value >= 0) counts[group.status] = value;
    }
    return counts;
  } catch {
    return {};
  }
}

/**
 * Jumlah total ebook loan yang cocok. `prisma.ebookLoan.count` tidak selalu ada
 * pada mock lama; bila tidak tersedia, kembalikan jumlah baris yang ditampilkan
 * agar nilai tidak menjadi 0 yang menyesatkan.
 */
async function countEbookLoansSafe(
  where: Record<string, unknown>,
  shown: number
): Promise<number> {
  const client = prisma.ebookLoan as unknown as {
    count?: (args: { where: Record<string, unknown> }) => Promise<number>;
  };
  if (typeof client.count !== "function") return shown;
  const total = await client.count({ where });
  return typeof total === "number" && total >= shown ? total : shown;
}

/**
 * Terjemahkan parameter `format` dari tool ke cakupan sumber data.
 * Default: "PHYSICAL" (buku fisik) — sesuai aturan produk, "buku" tanpa
 * penanda digital berarti buku fisik.
 */
function toolLoanScope(args: Record<string, unknown>): "PHYSICAL" | "EBOOK" | "ALL" {
  const raw = String(args.format ?? "").trim().toUpperCase();
  if (raw === "EBOOK") return "EBOOK";
  if (raw === "ALL") return "ALL";
  return "PHYSICAL";
}

const TOOL_HANDLERS: Record<
  string,
  (args: Record<string, unknown>, userId: string) => Promise<unknown>
> = {
  // ==================== PERSONAL (semua role) ====================

  /** Cari buku di katalog berdasarkan kata kunci. */
  search_books: async (args) => {
    const query = String(args.query ?? "").trim();
    // Format wajib deterministik: query adalah acuan utama, argumen model
    // hanya dipakai bila query tidak menyebut format. Default PHYSICAL.
    const format = resolveCatalogFormat(query, args.format);
    if (!query) return { count: 0, books: [], format, note: "Kata kunci kosong." };
    const books = await searchCatalogBooks(query, 8, format);
    return { count: books.length, format, books: books.map(bookPayload) };
  },

  /** Daftar buku yang tersedia dipinjam sekarang. */
  list_available_books: async (args) => {
    const limit = Math.min(TOOL_ROW_LIMIT, Math.max(1, Number(args.limit) || 8));
    // Tool ini tidak punya query bebas, jadi default-nya PHYSICAL. Model harus
    // mengirim "EBOOK" untuk koleksi digital; "ALL" hanya untuk permintaan
    // eksplisit kedua format.
    const format = resolveCatalogFormat("", args.format);
    const books = await listAllCatalogBooks("AVAILABLE", limit, format);
    return { count: books.length, format, books: books.map(bookPayload) };
  },

  /** Metadata satu buku berdasarkan penyebutan judul/penulis. */
  book_summary: async (args) => {
    const query = String(args.query ?? "");
    const format = resolveCatalogFormat(query, args.format);
    const book = await findBookByReference(query, format);
    if (!book) return { found: false, format };
    return { found: true, format, book: bookPayload(book) };
  },

  /** Statistik katalog; angka fisik dan ebook dipisahkan. */
  catalog_stats: async (args) => {
    const stats = await getCatalogStats();
    const format = resolveCatalogFormat("", args.format);
    return {
      ...stats,
      format,
      definitions: {
        physicalTitles:
          "Jumlah judul buku fisik (format PHYSICAL) — gunakan ini untuk pertanyaan 'berapa buku'.",
        physicalCopies: "Total eksemplar buku fisik.",
        physicalAvailable: "Eksemplar buku fisik yang bisa dipinjam sekarang.",
        totalEbooks: "Jumlah judul ebook (format EBOOK), bukan buku fisik.",
        activeLoans: "Peminjaman berstatus BORROWED/OVERDUE saat ini.",
        totalBorrows:
          "Transaksi yang benar-benar dipinjam: aktif + selesai (RETURNED). Tidak termasuk pengajuan (REQUESTED), ditolak (REJECTED), atau dibatalkan (CANCELLED). Untuk total semua status transaksi, gunakan get_transaction_stats.",
      },
    };
  },

  /**
   * Peminjaman aktif milik pengguna (fisik, ebook, pengajuan).
   *
   * Parameter `format` membatasi sumber data yang dibaca:
   * - "PHYSICAL" (default) → hanya BorrowRecord (buku fisik)
   * - "EBOOK"              → hanya EbookLoan
   * - "ALL"                → keduanya, tetap dipisahkan pada payload
   */
  get_my_loans: async (args, userId) => {
    const scope = toolLoanScope(args);
    const [active, pending, activeEbooks] = await Promise.all([
      scope === "EBOOK" ? Promise.resolve([]) : getActiveLoans(userId),
      scope === "EBOOK" ? Promise.resolve([]) : getPendingRequests(userId),
      scope === "PHYSICAL" ? Promise.resolve([]) : getActiveEbookLoans(userId),
    ]);
    return {
      scope,
      activeBorrows: active.map(borrowPayload),
      pendingRequests: pending.map(borrowPayload),
      activeEbooks: activeEbooks.map((e) => ebookLoanPayload(e)),
    };
  },

  /**
   * Riwayat peminjaman milik pengguna (fisik + ebook).
   *
   * Parameter `format` membatasi sumber data yang dibaca (lihat get_my_loans).
   */
  get_my_history: async (args, userId) => {
    const scope = toolLoanScope(args);
    const [history, ebookHistory] = await Promise.all([
      scope === "EBOOK" ? Promise.resolve([]) : getBorrowHistory(userId),
      scope === "PHYSICAL" ? Promise.resolve([]) : getEbookHistory(userId),
    ]);
    return {
      scope,
      borrows: history.map(borrowPayload),
      ebooks: ebookHistory.map((e) => ebookLoanPayload(e)),
    };
  },

  /**
   * Aktivitas membaca ebook milik pengguna sendiri. Hanya sesi yang benar-benar
   * tercatat; peminjaman tidak diubah menjadi aktivitas.
   */
  get_my_reading_activity: async (args, userId) => {
    const period = resolveToolReadingPeriod(args.period);
    const rows = await getMyReadingActivity({
      userId,
      search: String(args.search ?? "").trim() || undefined,
      start: period.start,
      end: period.end,
      limit: TOOL_ROW_LIMIT,
    });
    return {
      period: period.label,
      count: rows.length,
      pageTrackingSupported: READING_ACTIVITY_CONFIG.pageTrackingSupported,
      sessions: rows.map((row) => readingActivityPayload(row)),
      note:
        "Membuka ebook, aktivitas terbaru, dan peminjaman adalah konsep berbeda. " +
        "Nomor halaman/progres hanya diisi bila viewer benar-benar melaporkannya.",
    };
  },

  /** Denda milik pengguna beserta status pelunasannya. */
  get_my_fines: async (_args, userId) => {
    const fines = await getPersonalFines(userId);
    const totalOutstanding = fines.reduce(
      (sum, fine) => sum + (fine.status === "PAID" ? 0 : fine.outstanding),
      0
    );
    return {
      totalOutstanding,
      fines: fines.map((fine) => ({
        title: fine.title,
        author: fine.author,
        amount: fine.amount,
        lateAmount: fine.lateAmount,
        damageAmount: fine.damageAmount,
        daysLate: fine.daysLate,
        paid: fine.paid,
        outstanding: fine.outstanding,
        status: fine.status,
      })),
    };
  },

  /** Notifikasi terbaru milik pengguna. */
  get_my_notifications: async (_args, userId) => {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return {
      count: notifications.length,
      notifications: notifications.map((n) => ({
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.isRead,
        createdAt: formatWibDateTime(n.createdAt),
      })),
      timeZone: JAKARTA_TIME_ZONE,
    };
  },

  /** Profil pengguna yang sedang login. */
  get_my_profile: async (_args, userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        role: true,
        class: true,
        identityNumber: true,
        email: true,
      },
    });
    if (!user) return { error: "Profil tidak ditemukan." };
    return { profile: user };
  },

  // ==================== OPERATIONAL (LIBRARIAN, ADMIN) ====================

  /** Semua transaksi peminjaman (dengan filter status opsional). */
  get_all_borrows: async (args) => {
    const where: Record<string, unknown> = {};
    const VALID_STATUSES = ["REQUESTED", "BORROWED", "OVERDUE", "RETURNED", "CANCELLED", "REJECTED"];
    const status = String(args.status ?? "").trim().toUpperCase();
    // Status tak dikenal diabaikan (semua transaksi) agar model tidak
    // mengulang panggilan dengan filter yang selalu menghasilkan kosong.
    const appliedStatus = status && VALID_STATUSES.includes(status) ? status : null;
    if (appliedStatus) where.status = appliedStatus;

    const [borrows, totalMatching, statusGroups] = await Promise.all([
      prisma.borrowRecord.findMany({
        where,
        include: {
          book: { select: { id: true, title: true, author: true, archivedAt: true } },
          user: { select: { name: true, role: true, class: true } },
        },
        orderBy: { borrowDate: "desc" },
        take: TOOL_ROW_LIMIT,
      }),
      prisma.borrowRecord.count({ where }),
      countBorrowStatuses(where),
    ]);

    // `count` = jumlah SEBENARNYA yang cocok (bisa lebih besar dari daftar),
    // bukan panjang daftar yang dibatasi. `shown` adalah panjang daftar.
    const total =
      typeof totalMatching === "number" && totalMatching >= borrows.length
        ? totalMatching
        : borrows.length;

    const now = new Date();

    return {
      count: total,
      total,
      shown: borrows.length,
      statusCounts: statusGroups,
      borrows: borrows.map((b) => {
        const overdue =
          b.status === "OVERDUE" || (!b.returnDate && b.dueDate.getTime() < now.getTime());
        const payload = borrowPayload({
          id: b.id,
          bookId: b.bookId,
          title: b.book.title,
          author: b.book.author,
          status: b.status,
          borrowDate: b.borrowDate,
          dueDate: b.dueDate,
          returnDate: b.returnDate,
          overdue,
          daysLate: calculateLateDays(b.dueDate, b.returnDate ?? now),
        });
        return {
          ...payload,
          userName: (b.user as { name: string }).name,
          userRole: (b.user as { role: string }).role,
          userClass: (b.user as { class?: string | null }).class ?? null,
          archived: Boolean((b.book as { archivedAt?: Date | null }).archivedAt),
        };
      }),
      timeZone: JAKARTA_TIME_ZONE,
      // Filter yang benar-benar dipakai. Bila count 0 dan filter diset,
      // panggil lagi TANPA status untuk melihat seluruh transaksi terbaru.
      appliedStatus,
    };
  },

  /** Buku yang sedang terlambat (OVERDUE atau BORROWED dengan dueDate lewat). */
  get_overdue_borrows: async () => {
    const now = new Date();
    const overdue = await prisma.borrowRecord.findMany({
      where: {
        status: { in: ["OVERDUE", "BORROWED"] },
        dueDate: { lt: now },
      },
      include: {
        book: { select: { id: true, title: true, author: true, archivedAt: true } },
        user: { select: { name: true, role: true, class: true } },
      },
      orderBy: { dueDate: "asc" },
      take: TOOL_ROW_LIMIT,
    });

    // Jumlah total baris yang cocok (bisa melebihi jumlah yang ditampilkan).
    // Dibungkus guard agar bila query hitung gagal/kosong (mis. pada lingkungan
    // uji) angka tidak menyesatkan: jatuh kembali ke jumlah yang benar-benar
    // ditampilkan.
    const totalMatching = await prisma.borrowRecord.count({
      where: {
        status: { in: ["OVERDUE", "BORROWED"] },
        dueDate: { lt: now },
      },
    });
    const total =
      typeof totalMatching === "number" && totalMatching >= overdue.length
        ? totalMatching
        : overdue.length;

    return {
      count: overdue.length,
      total,
      shown: overdue.length,
      overdue: overdue.map((b) => ({
        transactionId: b.id,
        bookId: b.book.id,
        media: "PHYSICAL",
        title: b.book.title,
        author: b.book.author,
        status: b.status,
        statusLabel: "terlambat (belum dikembalikan)",
        dueDate: formatWibDateTime(b.dueDate),
        borrowDate: formatWibDateTime(b.borrowDate),
        daysLate: calculateLateDays(b.dueDate, now),
        userName: (b.user as { name: string }).name,
        userRole: (b.user as { role?: string }).role ?? null,
        userClass: (b.user as { class?: string | null }).class ?? null,
        // Buku arsip TIDAK dihilangkan dari hasil; ditandai lewat flag ini.
        archived: Boolean((b.book as { archivedAt?: Date | null }).archivedAt),
      })),
      timeZone: JAKARTA_TIME_ZONE,
    };
  },

  /**
   * Peminjaman AKTIF (belum dikembalikan) untuk seluruh sistem.
   *
   * Sumber data terpisah menurut format (default buku fisik):
   * - PHYSICAL: BorrowRecord berstatus BORROWED/OVERDUE.
   * - EBOOK   : EbookLoan dengan returnedAt null dan expiresAt masih berlaku.
   * - ALL     : keduanya, tetap dipisahkan pada payload.
   *
   * `total` adalah jumlah sebenarnya; `shown` adalah panjang daftar yang
   * dibatasi TOOL_ROW_LIMIT. Pengajuan REQUESTED, transaksi RETURNED, dan ebook
   * yang masa aksesnya habis TIDAK dihitung sebagai peminjaman aktif.
   */
  get_active_loans: async (args) => {
    const now = new Date();
    const format = resolveTransactionFormat("", args.format);
    const includePhysical = format !== "EBOOK";
    const includeEbook = format !== "PHYSICAL";
    // "Paling lama" = peminjaman paling awal (borrowDate/borrowedAt), bukan
    // jatuh tempo terdekat. Diurutkan di database agar tidak bergantung pada
    // teks tanggal yang sudah diformat.
    const earliestFirst =
      String(args.order ?? "").trim().toUpperCase() === "EARLIEST";
    const physicalOrder = earliestFirst
      ? { borrowDate: "asc" as const }
      : { dueDate: "asc" as const };
    const ebookOrder = earliestFirst
      ? { borrowedAt: "asc" as const }
      : { expiresAt: "asc" as const };

    const physicalWhere = { status: { in: ACTIVE_BORROW_STATUSES } };
    const ebookWhere = { returnedAt: null, expiresAt: { gt: now } };

    const [borrows, borrowCount, loans, ebookCount] = await Promise.all([
      includePhysical
        ? prisma.borrowRecord.findMany({
            where: physicalWhere,
            include: {
              book: { select: { id: true, title: true, author: true, archivedAt: true } },
              user: { select: { name: true, role: true, class: true } },
            },
            orderBy: physicalOrder,
            take: TOOL_ROW_LIMIT,
          })
        : Promise.resolve([]),
      includePhysical ? prisma.borrowRecord.count({ where: physicalWhere }) : Promise.resolve(0),
      includeEbook
        ? prisma.ebookLoan.findMany({
            where: ebookWhere,
            include: {
              book: { select: { id: true, title: true, author: true } },
              user: { select: { name: true, role: true } },
            },
            orderBy: ebookOrder,
            take: TOOL_ROW_LIMIT,
          })
        : Promise.resolve([]),
      includeEbook ? countEbookLoansSafe(ebookWhere, 0) : Promise.resolve(0),
    ]);

    const physicalTotal =
      typeof borrowCount === "number" && borrowCount >= borrows.length
        ? borrowCount
        : borrows.length;
    const ebookTotal =
      typeof ebookCount === "number" && ebookCount >= loans.length ? ebookCount : loans.length;

    const activeBorrows = borrows.map((b) => {
      const overdue = b.dueDate.getTime() < now.getTime() || b.status === "OVERDUE";
      const payload = borrowPayload({
        id: b.id,
        bookId: b.bookId,
        title: b.book.title,
        author: b.book.author,
        status: b.status,
        borrowDate: b.borrowDate,
        dueDate: b.dueDate,
        returnDate: b.returnDate,
        overdue,
        daysLate: calculateLateDays(b.dueDate, now),
      });
      return {
        ...payload,
        userName: (b.user as { name: string }).name,
        userRole: (b.user as { role: string }).role,
        userClass: (b.user as { class?: string | null }).class ?? null,
        archived: Boolean((b.book as { archivedAt?: Date | null }).archivedAt),
      };
    });

    const activeEbooks = loans.map((l) => {
      const daysRemaining = Math.max(
        0,
        Math.ceil((l.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );
      const payload = ebookLoanPayload({
        id: l.id,
        bookId: l.bookId,
        title: l.book.title,
        author: l.book.author,
        status: "ACTIVE",
        borrowDate: l.borrowedAt,
        dueDate: l.expiresAt,
        returnDate: l.returnedAt,
        overdue: false,
        daysRemaining,
      });
      return {
        ...payload,
        userName: (l.user as { name: string }).name,
        userRole: (l.user as { role: string }).role,
      };
    });

    return {
      format,
      total: physicalTotal + ebookTotal,
      shown: activeBorrows.length + activeEbooks.length,
      activeCounts: { physical: physicalTotal, ebook: ebookTotal },
      activeBorrows,
      activeEbooks,
      timeZone: JAKARTA_TIME_ZONE,
      note:
        "Peminjaman aktif = sudah diserahkan dan belum dikembalikan. " +
        "Pengajuan REQUESTED, transaksi RETURNED, dan ebook kedaluwarsa tidak dihitung. " +
        "Status ebook ACTIVE berarti masa akses berlaku, bukan bukti sedang membaca.",
    };
  },

  /**
   * Denda yang tercatat di sistem. `type` memisahkan jenis denda agar denda
   * kerusakan TIDAK pernah dianggap denda keterlambatan:
   * - "LATE": hanya baris dengan lateFineAmount > 0 (keterlambatan)
   * - "DAMAGE": hanya baris dengan damageFineAmount > 0 (kerusakan)
   * - "ALL": seluruh baris denda
   * `count` dan `totalOutstanding` dihitung dari SELURUH baris yang cocok
   * (bukan hanya yang ditampilkan), sehingga angka tidak menyesatkan.
   */
  get_fines_overview: async (args) => {
    const requested = String(args.type ?? "ALL").trim().toUpperCase();
    const type = requested === "LATE" || requested === "DAMAGE" ? requested : "ALL";

    const where: Record<string, unknown> = { fineAmount: { gt: 0 } };
    if (type === "LATE") where.lateFineAmount = { gt: 0 };
    else if (type === "DAMAGE") where.damageFineAmount = { gt: 0 };

    const outstandingOf = (amount: number, payments: { amount: number }[]) =>
      Math.max(0, amount - payments.reduce((sum, p) => sum + p.amount, 0));

    const [count, allAmounts, fines] = await Promise.all([
      prisma.borrowRecord.count({ where }),
      prisma.borrowRecord.findMany({
        where,
        select: {
          userId: true,
          fineAmount: true,
          finePayments: { select: { amount: true } },
        },
      }),
      prisma.borrowRecord.findMany({
        where,
        include: {
          book: { select: { title: true, author: true } },
          user: { select: { name: true, role: true } },
          finePayments: { select: { amount: true } },
        },
        orderBy: { dueDate: "desc" },
        take: TOOL_ROW_LIMIT,
      }),
    ]);

    const totalOutstanding = allAmounts.reduce(
      (sum, f) => sum + outstandingOf(f.fineAmount, f.finePayments),
      0
    );
    const totalAssessed = allAmounts.reduce((sum, f) => sum + (f.fineAmount ?? 0), 0);
    const totalPaid = allAmounts.reduce(
      (sum, f) => sum + f.finePayments.reduce((p, x) => p + x.amount, 0),
      0
    );
    const userCount = new Set(
      allAmounts.map((f) => f.userId).filter((id): id is string => typeof id === "string")
    ).size;

    return {
      type,
      count,
      totalOutstanding,
      totalAssessed,
      totalPaid,
      userCount,
      fines: fines.map((f) => {
        const paid = f.finePayments.reduce((s, p) => s + p.amount, 0);
        const outstanding = Math.max(0, f.fineAmount - paid);
        const status = paid <= 0 ? "UNPAID" : outstanding <= 0 ? "PAID" : "PARTIAL";
        return {
          bookId: f.bookId,
          title: f.book.title,
          author: f.book.author,
          userName: (f.user as { name: string }).name,
          userRole: (f.user as { role: string }).role,
          amount: f.fineAmount,
          lateAmount: f.lateFineAmount,
          damageAmount: f.damageFineAmount,
          daysLate: f.returnDate ? calculateLateDays(f.dueDate, f.returnDate) : 0,
          paid,
          outstanding,
          status,
        };
      }),
    };
  },

  /** Semua aktifitas peminjaman ebook di sistem. */
  get_all_ebook_loans: async (args) => {
    const now = new Date();
    const where: Record<string, unknown> = {};
    // Status ebook adalah TURUNAN timestamp (lihat getEbookAccessState), bukan
    // kolom status yang baru disinkronkan secara lazy. Filter status karena itu
    // diterjemahkan ke kondisi timestamp agar loan yang kolomnya masih ACTIVE
    // tetapi masa aksesnya sudah berakhir TIDAK ikut terhitung sebagai aktif.
    const requested = String(args.status ?? "").trim().toUpperCase();
    if (requested === "ACTIVE") {
      where.returnedAt = null;
      where.expiresAt = { gt: now };
    } else if (requested === "EXPIRED") {
      where.returnedAt = null;
      where.expiresAt = { lte: now };
    } else if (requested === "RETURNED") {
      where.returnedAt = { not: null };
    }

    const [loans, totalMatching] = await Promise.all([
      prisma.ebookLoan.findMany({
        where,
        include: {
          book: { select: { title: true, author: true } },
          user: { select: { name: true, role: true } },
        },
        orderBy: { borrowedAt: "desc" },
        take: TOOL_ROW_LIMIT,
      }),
      countEbookLoansSafe(where, 0),
    ]);

    const total =
      typeof totalMatching === "number" && totalMatching >= loans.length
        ? totalMatching
        : loans.length;

    return {
      count: total,
      total,
      shown: loans.length,
      loans: loans.map((l) => {
        const status = getEbookAccessState(l, now);
        return {
          transactionId: l.id,
          bookId: l.bookId,
          media: "EBOOK",
          title: l.book.title,
          author: l.book.author,
          status,
          statusLabel: ebookStatusLabel({
            status,
            returnDate: l.returnedAt,
            overdue: status === "EXPIRED",
          }),
          borrowedAt: formatWibDateTime(l.borrowedAt),
          expiresAt: formatWibDateTime(l.expiresAt),
          returnedAt: l.returnedAt ? formatWibDateTime(l.returnedAt) : null,
          userName: (l.user as { name: string }).name,
          userRole: (l.user as { role: string }).role,
        };
      }),
      timeZone: JAKARTA_TIME_ZONE,
    };
  },

  /**
   * Transaksi peminjaman pada satu TANGGAL (zona Asia/Jakarta). Menjawab
   * "siapa yang meminjam buku hari ini/kemarin/pada tanggal X" dari transaksi
   * aktual pada rentang hari tersebut. Buku fisik (BorrowRecord, status
   * dipinjam/terlambat/dikembalikan) dan ebook (EbookLoan) digabung; setiap
   * baris membawa jam WIB. Pengajuan yang belum disetujui maupun transaksi
   * yang ditolak/dibatalkan sengaja TIDAK dihitung sebagai peminjaman.
   */
  get_borrows_by_date: async (args) => {
    const raw = String(args.date ?? "").trim();
    if (!raw) {
      return {
        error:
          "Parameter date wajib diisi (today, yesterday, atau tanggal seperti 2026-10-18).",
      };
    }
    const range = resolveToolDateRange(raw);
    if (!range) {
      return { error: `Tanggal "${raw}" tidak dapat dipahami. Gunakan today, yesterday, atau 2026-10-18.` };
    }

    const [borrows, loans, borrowTotal, ebookTotal] = await Promise.all([
      prisma.borrowRecord.findMany({
        where: {
          status: { in: ["BORROWED", "OVERDUE", "RETURNED"] },
          borrowDate: { gte: range.start, lt: range.end },
        },
        include: {
          book: { select: { title: true, author: true, archivedAt: true } },
          user: { select: { name: true, role: true, class: true } },
        },
        orderBy: { borrowDate: "asc" },
        take: TOOL_ROW_LIMIT,
      }),
      prisma.ebookLoan.findMany({
        where: { borrowedAt: { gte: range.start, lt: range.end } },
        include: {
          book: { select: { title: true, author: true, archivedAt: true } },
          user: { select: { name: true, role: true } },
        },
        orderBy: { borrowedAt: "asc" },
        take: TOOL_ROW_LIMIT,
      }),
      prisma.borrowRecord.count({
        where: {
          status: { in: ["BORROWED", "OVERDUE", "RETURNED"] },
          borrowDate: { gte: range.start, lt: range.end },
        },
      }),
      countEbookLoansSafe({ borrowedAt: { gte: range.start, lt: range.end } }, 0),
    ]);

    const now = new Date();
    // Jumlah fisik memakai count database; ebook memakai count bila tersedia,
    // jika tidak jumlah baris yang ditampilkan. `shown` adalah panjang daftar.
    const physicalTotal =
      typeof borrowTotal === "number" && borrowTotal >= borrows.length
        ? borrowTotal
        : borrows.length;
    const ebookCount =
      typeof ebookTotal === "number" && ebookTotal >= loans.length ? ebookTotal : loans.length;
    const total = physicalTotal + ebookCount;

    return {
      date: range.key,
      label: range.label,
      timeZone: JAKARTA_TIME_ZONE,
      count: total,
      total,
      shown: borrows.length + loans.length,
      borrows: borrows.map((b) => ({
        title: b.book.title,
        author: b.book.author,
        status: b.status,
        borrowDate: formatWibDateTime(b.borrowDate),
        userName: (b.user as { name: string }).name,
        userRole: (b.user as { role: string }).role,
        archived: Boolean(b.book.archivedAt),
      })),
      ebookLoans: loans.map((l) => ({
        title: l.book.title,
        author: l.book.author,
        // Status diturunkan dari timestamp, bukan kolom status yang lazy.
        status: getEbookAccessState(l, now),
        borrowedAt: formatWibDateTime(l.borrowedAt),
        userName: (l.user as { name: string }).name,
        userRole: (l.user as { role: string }).role,
        archived: Boolean(l.book.archivedAt),
      })),
    };
  },

  /**
   * Statistik transaksi operasional (jumlah per status, keterlambatan,
   * pengembalian, pengajuan, denda) dengan sumber data terpisah menurut format.
   */
  get_transaction_stats: async (args) => {
    const rawPeriod = String(args.period ?? args.date ?? "").trim();
    const period = rawPeriod ? resolveStatsPeriodInput(rawPeriod) : null;
    if (rawPeriod && !period) {
      return {
        error:
          `Periode "${rawPeriod}" tidak dapat dipahami. Gunakan today, yesterday, ` +
          `this_month, last_month, this_year, YYYY-MM, atau tanggal seperti 2026-10-18.`,
      };
    }

    // Parameter kosong TIDAK boleh menjadi query gabungan. Default produk
    // adalah buku fisik; EBOOK hanya bila diminta eksplisit.
    const format: TransactionFormat = resolveTransactionFormat("", args.format);
    const stats = await getOperationalStats(period, new Date(), format);

    const payload: Record<string, unknown> = {
      format,
      period: stats.period,
      timeZone: JAKARTA_TIME_ZONE,
    };

    if (stats.physical) {
      // Field datar lama dipertahankan agar konsumen yang sudah ada tetap
      // membaca angka buku fisik. Field `physical` adalah sumber yang jelas.
      Object.assign(payload, {
        physical: stats.physical,
        totalBorrows: stats.physical.totalBorrows,
        statusCounts: stats.physical.statusCounts,
        activeBorrows: stats.physical.activeBorrows,
        pendingRequests: stats.physical.pendingRequests,
        overdueBorrows: stats.physical.overdueBorrows,
        returns: stats.physical.returns,
        rejectedBorrows: stats.physical.rejectedBorrows,
        cancelledBorrows: stats.physical.cancelledBorrows,
        fines: stats.physical.fines,
      });
    }

    if (stats.ebook) {
      payload.ebook = stats.ebook;
      // Nama lama untuk total ebook; tetap terpisah dari totalBorrows fisik.
      payload.ebookLoans = stats.ebook.totalLoans;
    }

    if (stats.physical && stats.ebook) {
      payload.totalTransactions = stats.physical.totalBorrows + stats.ebook.totalLoans;
    }

    payload.note =
      format === "PHYSICAL"
        ? "Angka hanya transaksi buku fisik (BorrowRecord); ebook tidak dihitung."
        : format === "EBOOK"
          ? "Angka hanya transaksi ebook (EbookLoan), tidak termasuk buku fisik. " +
            "Status ebook: ACTIVE/EXPIRED/RETURNED; EXPIRED berarti masa akses habis, bukan keterlambatan."
          : "totalBorrows dan statusCounts hanya buku fisik; angka ebook ada di `ebook`. " +
            "Total transaksi kedua format = totalBorrows + ebook.totalLoans. " +
            "Jangan menjumlahkan status yang definisinya berbeda (mis. OVERDUE fisik vs EXPIRED ebook).";

    return payload;
  },

  // ==================== ADMINISTRATIVE (ADMIN saja) ====================

  /**
   * Jumlah pengguna terdaftar per role (agregat). TIDAK mengembalikan identitas,
   * nama, email, atau daftar pengguna. Total dihitung dari penjumlahan per-role
   * agar tidak ada penghitungan ganda. Khusus ADMIN.
   */
  get_user_count: async (args) => countUsers(args),

  /** Statistik jumlah pengguna per role. */
  get_user_stats: async (args) => countUsers(args),

  /**
   * Aktivitas membaca ebook GLOBAL (khusus ADMIN). Tool ini sengaja berada di
   * kategori ADMINISTRATIVE agar Pustakawan tidak otomatis memperoleh akses
   * pemantauan global baru.
   */
  get_ebook_reading_activity: async (args) => {
    const period = resolveToolReadingPeriod(args.period);
    const rawStatus = String(args.status ?? "").toUpperCase();
    const status = isReadingActivityStatus(rawStatus) ? rawStatus : null;
    const search = String(args.search ?? "").trim().slice(0, 100);
    const result = await listReadingActivity({
      filters: {
        search: search || undefined,
        status,
        start: period.start,
        end: period.end,
        periodLabel: period.label,
      },
      pageSize: TOOL_ROW_LIMIT,
    });
    return {
      period: result.periodLabel,
      totalSessions: result.summary.totalSessions,
      uniqueUsers: result.summary.uniqueUsers,
      uniqueBooks: result.summary.uniqueBooks,
      activeSessions: result.summary.activeSessions,
      openedSessions: result.summary.openedSessions,
      inactiveSessions: result.summary.inactiveSessions,
      totalMatching: result.total,
      pageTrackingSupported: result.pageTrackingSupported,
      sessions: result.rows.map((row) => readingActivityPayload(row)),
      note:
        "Jumlah sesi, pengguna unik, dan ebook unik dihitung terpisah. " +
        "Status aktivitas terbaru bukan bukti membaca terus-menerus; " +
        "peminjaman aktif bukan aktivitas membaca.",
    };
  },

  /** Pengaturan sistem non-sensitif (hanya key yang diizinkan). */
  get_system_settings: async () => {
    const allowed = Array.from(ALLOWED_SETTING_KEYS);
    const settings = await prisma.setting.findMany({
      where: { key: { in: allowed } },
      select: { key: true, value: true },
    });
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    return { settings: result };
  },

  /**
   * Direktori identitas pengguna (khusus ADMIN). Mengembalikan kolom yang sama
   * dengan halaman Pengguna/dashboard Admin: nama, email, role, status, NIS/NIP,
   * kelas, dan waktu pendaftaran. `passwordHash` tidak pernah dipilih.
   */
  get_user_directory: async (args) => {
    const where: Record<string, unknown> = {};

    const role = String(args.role ?? "").trim().toUpperCase();
    if (VALID_USER_ROLES.has(role)) where.role = role;

    if (typeof args.isActive === "boolean") where.isActive = args.isActive;

    const classValue = String(args.class ?? "").trim();
    if (classValue) {
      where.class =
        args.classExact === true ? classValue : { startsWith: classValue };
    }

    const search = String(args.search ?? "").trim();
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { identityNumber: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: ADMIN_USER_SELECT,
        orderBy: { createdAt: "desc" },
        take: TOOL_ROW_LIMIT,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      total,
      shown: users.length,
      users: users.map(adminUserPayload),
      note:
        total > users.length
          ? `Daftar dibatasi ${users.length} baris dari total ${total} pengguna. Sebutkan totalnya dan nyatakan daftar hanya sebagian.`
          : "Daftar memuat seluruh pengguna yang cocok.",
      timeZone: JAKARTA_TIME_ZONE,
    };
  },

  /**
   * Riwayat lengkap satu pengguna (khusus ADMIN): identitas, total transaksi
   * buku fisik + ebook (definisi yang sama dengan dasbor), peminjaman aktif,
   * riwayat terbaru, dan ringkasan denda. Tidak pernah memuat password/token.
   *
   * Pencarian dilakukan lewat nama, email, atau NIS/NIP. Bila lebih dari satu
   * pengguna cocok, hasilnya ambigu dan model harus meminta klarifikasi —
   * bukan menebak salah satu.
   */
  get_user_borrows: async (args) => {
    const search = String(args.search ?? "").trim();
    if (!search) {
      return {
        error:
          "Sebutkan nama, email, atau NIS/NIP pengguna yang riwayatnya ingin dilihat.",
      };
    }

    const matches = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
          { identityNumber: { contains: search } },
        ],
      },
      select: ADMIN_USER_SELECT,
      orderBy: { createdAt: "desc" },
      take: 6,
    });

    if (matches.length === 0) return { found: false, search };
    if (matches.length > 1) {
      return {
        found: false,
        ambiguous: true,
        search,
        matches: matches.map(adminUserPayload),
        note: "Lebih dari satu pengguna cocok. Minta pengguna menyebutkan nama lengkap, email, atau NIS/NIP.",
      };
    }

    const user = matches[0];
    const now = new Date();
    const [totals, active, borrows, ebookLoans, fines] = await Promise.all([
      getUserHistoryTotals(user.id),
      getUserActiveLoans(user.id, now),
      prisma.borrowRecord.findMany({
        where: { userId: user.id },
        include: {
          book: { select: { title: true, author: true } },
        },
        orderBy: { borrowDate: "desc" },
        take: 20,
      }),
      prisma.ebookLoan.findMany({
        where: { userId: user.id },
        include: {
          book: { select: { title: true, author: true } },
        },
        orderBy: { borrowedAt: "desc" },
        take: 20,
      }),
      prisma.borrowRecord.findMany({
        where: { userId: user.id, fineAmount: { gt: 0 } },
        include: {
          book: { select: { title: true, author: true } },
          finePayments: { select: { amount: true } },
        },
        orderBy: { dueDate: "desc" },
        take: TOOL_ROW_LIMIT,
      }),
    ]);

    const fineOutstanding = fines.reduce((sum, row) => {
      const paid = row.finePayments.reduce((total, payment) => total + payment.amount, 0);
      return sum + Math.max(0, row.fineAmount - paid);
    }, 0);

    return {
      found: true,
      user: adminUserPayload(user),
      totals,
      active,
      borrows: borrows.map((row) => {
        const overdue =
          row.status === "OVERDUE" ||
          (!row.returnDate && row.dueDate.getTime() < now.getTime());
        return borrowPayload({
          id: row.id,
          bookId: row.bookId,
          title: row.book.title,
          author: row.book.author,
          status: row.status,
          borrowDate: row.borrowDate,
          dueDate: row.dueDate,
          returnDate: row.returnDate,
          overdue,
          daysLate: calculateLateDays(row.dueDate, row.returnDate ?? now),
        });
      }),
      ebookLoans: ebookLoans.map((row) => {
        const status = getEbookAccessState(row, now);
        return ebookLoanPayload({
          id: row.id,
          bookId: row.bookId,
          title: row.book.title,
          author: row.book.author,
          status,
          borrowDate: row.borrowedAt,
          dueDate: row.expiresAt,
          returnDate: row.returnedAt,
          overdue: status === "EXPIRED",
          daysRemaining:
            status === "ACTIVE"
              ? Math.max(
                  0,
                  Math.ceil(
                    (row.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
                  )
                )
              : 0,
        });
      }),
      fines: {
        count: fines.length,
        outstanding: fineOutstanding,
        records: fines.map((row) => {
          const paid = row.finePayments.reduce((sum, payment) => sum + payment.amount, 0);
          const outstanding = Math.max(0, row.fineAmount - paid);
          return {
            title: row.book.title,
            author: row.book.author,
            amount: row.fineAmount,
            lateAmount: row.lateFineAmount,
            damageAmount: row.damageFineAmount,
            paid,
            outstanding,
            status: paid <= 0 ? "UNPAID" : outstanding <= 0 ? "PAID" : "PARTIAL",
          };
        }),
      },
      timeZone: JAKARTA_TIME_ZONE,
      note:
        "totals memakai definisi dasbor: seluruh baris BorrowRecord + seluruh baris EbookLoan. " +
        "active memakai definisi peminjaman aktif yang sama dengan dasbor.",
    };
  },

  /**
   * Riwayat AUDIT pembuatan & penghapusan akun pengguna (khusus ADMIN).
   *
   * Membaca AuditLog aktual (bukan ingatan model). Memisahkan PELAKU (actor =
   * `user` relasi) dari AKUN TARGET (dibaca dari `details`), membedakan waktu
   * PEMBUATAN AKUN (`User.createdAt`, bila akun masih ada) dari waktu PENCATATAN
   * AUDIT (`AuditLog.createdAt`), dan memakai zona Asia/Jakarta. Tidak pernah
   * memuat password, token, atau kredensial.
   */
  get_user_audit_history: async (args) => {
    const typeRaw = String(args.type ?? "ALL").trim().toUpperCase();
    const actions =
      typeRaw === "CREATE"
        ? ["CREATE_USER", "REGISTER_STUDENT"]
        : typeRaw === "DELETE"
          ? ["USER_DELETED"]
          : ["CREATE_USER", "REGISTER_STUDENT", "USER_DELETED"];

    const where: Record<string, unknown> = { action: { in: actions } };

    const dateInput = String(args.date ?? "").trim();
    let range: { start: Date; end: Date } | null = null;
    if (dateInput) {
      const period = resolveStatsPeriodInput(dateInput);
      if (!period) {
        return {
          error:
            "Tanggal tidak dapat dipahami. Sebutkan tanggal lengkap, misalnya '18 Oktober 2026'.",
        };
      }
      range = { start: period.start, end: period.end };
      where.createdAt = { gte: range.start, lt: range.end };
    }

    const search = String(args.search ?? "").trim();
    if (search) {
      where.OR = [
        { details: { contains: search } },
        { user: { name: { contains: search } } },
        { user: { email: { contains: search } } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, role: true } } },
        orderBy: { createdAt: "desc" },
        take: AUDIT_ROW_LIMIT,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Identitas target dibaca dari akun (bila masih ada) agar EMAIL tidak perlu
    // pernah dikirim ke model. Akun yang sudah dihapus hanya menyisakan role dari
    // teks audit; namanya tidak ditebak.
    const targetEmails = logs
      .map((l) => extractAuditTarget(l.details).email)
      .filter((e): e is string => Boolean(e));
    const accounts = targetEmails.length
      ? await prisma.user.findMany({
          where: { email: { in: targetEmails } },
          select: { email: true, name: true, role: true, createdAt: true },
        })
      : [];
    const accountByEmail = new Map(
      accounts.map((a) => [
        a.email.toLowerCase(),
        {
          name: a.name,
          role: a.role,
          createdAt: formatWibDateTime(a.createdAt),
        },
      ])
    );

    const syntheticEvents: Array<{
      action: string;
      at: string;
      actorName: string | null;
      actorRole: string | null;
      targetName: string | null;
      targetRole: string | null;
      accountCreatedAt: string | null;
      synthetic?: boolean;
    }> = [];

    if ((typeRaw === "CREATE" || typeRaw === "ALL") && range) {
      const findUsers =
        typeof prisma.user?.findMany === "function" ? prisma.user.findMany.bind(prisma.user) : null;
      const users = findUsers
        ? (((await findUsers({
            where: { createdAt: { gte: range.start, lt: range.end } },
            select: { name: true, email: true, role: true, createdAt: true },
          })) as Array<{ name: string; email: string; role: string; createdAt: Date }>) ?? [])
        : [];
      const auditEmails = new Set(
        logs
          .map((l) => extractAuditTarget(l.details).email)
          .filter((e): e is string => Boolean(e))
          .map((e) => e.toLowerCase())
      );
      for (const user of users) {
        if (auditEmails.has(user.email.toLowerCase())) continue;
        if (search) {
          const haystack = `${user.name} ${user.email}`.toLowerCase();
          if (!haystack.includes(search.toLowerCase())) continue;
        }
        syntheticEvents.push({
          action: "CREATE_USER",
          at: formatWibDateTime(user.createdAt),
          actorName: null,
          actorRole: null,
          targetName: user.name,
          targetRole: user.role,
          accountCreatedAt: formatWibDateTime(user.createdAt),
          synthetic: true,
        });
      }
    }

    const mergedEvents = [
      ...logs.map((l) => {
        const target = extractAuditTarget(l.details);
        const account = target.email
          ? (accountByEmail.get(target.email.toLowerCase()) ?? null)
          : null;
        return {
          action: l.action,
          at: formatWibDateTime(l.createdAt),
          actorName: l.user?.name ?? null,
          actorRole: l.user?.role ?? null,
          // Email target TIDAK pernah dimasukkan ke payload yang dikirim ke model.
          targetName: account?.name ?? null,
          targetRole: account?.role ?? target.role,
          accountCreatedAt: account?.createdAt ?? null,
          synthetic: false,
        };
      }),
      ...syntheticEvents,
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    return {
      count: mergedEvents.length,
      total: total + syntheticEvents.length,
      events: mergedEvents.slice(0, AUDIT_ROW_LIMIT),
      timeZone: JAKARTA_TIME_ZONE,
    };
  },
};

// ---------------------------------------------------------------------------
// Definisi tools yang dikirim ke provider, dikelompokkan per kategori.
// ---------------------------------------------------------------------------

type ToolDef = AIToolDefinition & { category: "PERSONAL" | "OPERATIONAL" | "ADMINISTRATIVE" };

function tool(
  category: ToolDef["category"],
  def: AIToolDefinition
): ToolDef {
  return { ...def, category };
}

export const ALL_TOOLS: ToolDef[] = [
  // ==================== PERSONAL ====================
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "search_books",
      description:
        "Cari judul BUKU FISIK atau EBOOK di katalog DigiLib berdasarkan kata kunci (judul, penulis, mata pelajaran, jurusan, atau tingkat kelas). Default dan arti kata 'buku' tanpa penanda digital adalah PHYSICAL. Gunakan 'EBOOK' hanya bila pengguna menyebut ebook/e-book/buku digital. Bila pengguna meminta kedua format, panggil tool ini dua kali (PHYSICAL lalu EBOOK) — jangan mencampur satu hasil.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Kata kunci pencarian, mis. 'fisika', 'jaringan komputer', 'cerpen'.",
          },
          format: {
            type: "string",
            enum: ["PHYSICAL", "EBOOK"],
            description: "Format yang dicari: 'PHYSICAL' untuk buku fisik (default), 'EBOOK' untuk ebook/buku digital. Jangan pakai ALL di sini.",
          },
        },
        required: ["query"],
      },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "list_available_books",
      description:
        "Daftar koleksi yang tersedia sekarang. Default PHYSICAL (buku fisik). Gunakan 'EBOOK' hanya bila pengguna menanyakan ebook/buku digital. Bila pengguna meminta kedua format, panggil dua kali dan tampilkan dua bagian terpisah.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: `Jumlah maksimum buku (default 8, maks ${TOOL_ROW_LIMIT}).` },
          format: {
            type: "string",
            enum: ["PHYSICAL", "EBOOK"],
            description: "Format koleksi: 'PHYSICAL' untuk buku fisik (default), 'EBOOK' untuk ebook. Jangan pakai ALL di sini.",
          },
        },
      },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "book_summary",
      description:
        "Metadata satu buku (judul, penulis, format, stok, ketersediaan) berdasarkan penyebutan judul/penulis. Default PHYSICAL untuk kata 'buku'; gunakan 'EBOOK' bila pengguna menyebut ebook/buku digital. Jangan menampilkan ebook sebagai pengganti buku fisik yang tidak ditemukan.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Potongan judul atau penulis buku." },
          format: {
            type: "string",
            enum: ["PHYSICAL", "EBOOK"],
            description: "Format buku: 'PHYSICAL' untuk buku fisik (default), 'EBOOK' untuk ebook.",
          },
        },
        required: ["query"],
      },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "catalog_stats",
      description:
        "Statistik katalog. Untuk pertanyaan 'berapa buku di perpustakaan', gunakan physicalTitles/physicalCopies (buku fisik), bukan totalTitles yang mencakup ebook. totalEbooks khusus ebook. `totalBorrows` HANYA transaksi aktif + selesai (tanpa pengajuan/ditolak/dibatalkan); jangan menyamakannya dengan total semua status transaksi.",
      parameters: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["PHYSICAL", "EBOOK", "ALL"],
            description: "Cakupan angka yang ditanyakan: PHYSICAL (default), EBOOK, atau ALL untuk keduanya.",
          },
        },
      },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "get_my_loans",
      description:
        "Peminjaman milik pengguna yang sedang login: buku fisik yang sedang dipinjam (beserta tanggal jatuh tempo), ebook dengan masa akses aktif (beserta sisa masa akses), dan pengajuan yang menunggu persetujuan. Gunakan parameter format untuk memilih sumber data: 'PHYSICAL' bila pengguna menanyakan buku (default), 'EBOOK' bila menanyakan ebook, 'ALL' bila menanyakan semua. Status ebook aktif berarti masa akses masih berlaku, BUKAN bukti pengguna sedang membaca.",
      parameters: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["PHYSICAL", "EBOOK", "ALL"],
            description: "Format peminjaman yang ditanyakan: 'PHYSICAL' untuk buku fisik (default bila pengguna menyebut 'buku'), 'EBOOK' untuk ebook, 'ALL' untuk keduanya.",
          },
        },
      },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "get_my_history",
      description:
        "Riwayat peminjaman milik pengguna yang sedang login: buku fisik yang pernah dipinjam/dikembalikan dan riwayat peminjaman ebook. Gunakan parameter format untuk memilih sumber data: 'PHYSICAL' bila pengguna menanyakan buku (default), 'EBOOK' bila menanyakan ebook, 'ALL' bila menanyakan semua.",
      parameters: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["PHYSICAL", "EBOOK", "ALL"],
            description: "Format riwayat yang ditanyakan: 'PHYSICAL' untuk buku fisik (default bila pengguna menyebut 'buku'), 'EBOOK' untuk ebook, 'ALL' untuk keduanya.",
          },
        },
      },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "get_my_reading_activity",
      description:
        "Aktivitas membaca ebook milik pengguna yang sedang login: ebook yang terakhir dibuka/dibaca, waktu pembukaan, aktivitas terakhir, status sesi, dan halaman/progres bila benar-benar dilaporkan. JANGAN menyamakan ini dengan peminjaman aktif. Native PDF viewer tidak melaporkan halaman, jadi jangan mengarang progres.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Judul/penulis ebook yang dicari (opsional).",
          },
          period: {
            type: "string",
            description:
              "Periode opsional: today, 7d, 30d, this_month, last_month, this_year, all, YYYY-MM, atau tanggal/bulan yang dipahami.",
          },
        },
      },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "get_my_fines",
      description:
        "Denda milik pengguna yang sedang login: jumlah, penyebab (keterlambatan/kerusakan), sisa yang belum dibayar, dan status lunas/belum.",
      parameters: { type: "object", properties: {} },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "get_my_notifications",
      description:
        "Notifikasi terbaru milik pengguna yang sedang login (pengingat jatuh tempo, peringatan terlambat, pengumuman).",
      parameters: { type: "object", properties: {} },
    },
  }),
  tool("PERSONAL", {
    type: "function",
    function: {
      name: "get_my_profile",
      description:
        "Profil pengguna yang sedang login: nama, role, kelas, dan identitas. Dipakai untuk 'siapa nama saya?' atau 'profil saya apa?'.",
      parameters: { type: "object", properties: {} },
    },
  }),

  // ==================== OPERATIONAL ====================
  tool("OPERATIONAL", {
    type: "function",
    function: {
      name: "get_all_borrows",
      description:
        "Semua transaksi peminjaman di sistem (semua pengguna), terurut dari yang terbaru. Dipakai Pustakawan/Admin untuk melihat seluruh transaksi atau memeriksa aktivitas peminjaman. Kosongkan status untuk transaksi terbaru dari SEMUA status; isi hanya bila pengguna menyebut status tertentu.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Filter status (opsional): REQUESTED, BORROWED, OVERDUE, RETURNED, CANCELLED, REJECTED. Kosongkan bila tidak disebut.",
          },
        },
      },
    },
  }),
  tool("OPERATIONAL", {
    type: "function",
    function: {
      name: "get_overdue_borrows",
      description:
        "Semua buku yang sedang terlambat (overdue) di sistem. Dipakai Pustakawan/Admin untuk melihat buku yang melewati batas pengembalian.",
      parameters: { type: "object", properties: {} },
    },
  }),
  tool("OPERATIONAL", {
    type: "function",
    function: {
      name: "get_active_loans",
      description:
        "Peminjaman AKTIF di sistem (semua pengguna): transaksi yang sudah diserahkan dan BELUM dikembalikan. WAJIB dipakai untuk pertanyaan seperti 'buku apa saja yang sedang dipinjam', 'peminjaman yang belum dikembalikan', 'pinjaman aktif', atau 'siapa yang masih meminjam'. JANGAN memakai katalog (search_books/list_available_books) untuk pertanyaan transaksi ini. Format default 'PHYSICAL' (buku fisik); 'EBOOK' hanya bila pengguna menyebut ebook; 'ALL' bila meminta semua format. Hasil memuat status, tanggal pinjam/jatuh tempo, hari keterlambatan, dan peminjam.",
      parameters: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["PHYSICAL", "EBOOK", "ALL"],
            description:
              "Sumber transaksi: 'PHYSICAL' untuk buku fisik (default), 'EBOOK' untuk ebook, 'ALL' hanya bila pengguna meminta kedua format.",
          },
        },
      },
    },
  }),
  tool("OPERATIONAL", {
    type: "function",
    function: {
      name: "get_fines_overview",
      description:
        "Denda yang tercatat di sistem beserta sisa yang belum dibayar. Isi `type` sesuai jenis denda yang ditanyakan: 'LATE' untuk denda keterlambatan, 'DAMAGE' untuk denda kerusakan, 'ALL' untuk seluruh denda. JANGAN mencampur denda kerusakan dengan denda keterlambatan.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "Jenis denda: LATE (keterlambatan), DAMAGE (kerusakan), atau ALL (semua). Default ALL.",
          },
        },
      },
    },
  }),
  tool("OPERATIONAL", {
    type: "function",
    function: {
      name: "get_all_ebook_loans",
      description:
        "Semua transaksi peminjaman/masa akses ebook di sistem (semua pengguna). Dipakai Pustakawan/Admin untuk memantau ebook yang dipinjamkan. Status ACTIVE hanya berarti masa akses masih berlaku, BUKAN bukti pengguna sedang membaca. Untuk aktivitas membaca yang tercatat, gunakan tool aktivitas membaca; jangan menyimpulkan dari loan.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter status: ACTIVE, EXPIRED, RETURNED." },
        },
      },
    },
  }),

  tool("OPERATIONAL", {
    type: "function",
    function: {
      name: "get_transaction_stats",
      description:
        "Statistik transaksi operasional dari database. Sumber data dipisah: `format='PHYSICAL'` hanya BorrowRecord (buku fisik, default), `format='EBOOK'` hanya EbookLoan, dan `format='ALL'` keduanya (hanya bila pengguna meminta semua format secara eksplisit). Jangan memakai ALL untuk pertanyaan 'total transaksi ebook'. Hasil EBOOK tidak memuat totalBorrows fisik; total ebook ada di `ebook.totalLoans`. Status ebook ACTIVE/EXPIRED/RETURNED berbeda dari status fisik REQUESTED/BORROWED/OVERDUE/RETURNED/CANCELLED/REJECTED. Angka `total` adalah jumlah sebenarnya, bukan panjang daftar.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description:
              "Periode opsional: today, yesterday, this_month, last_month, this_year, last_year, '2026-10', 'Oktober 2026', '2026', atau tanggal 2026-10-18. Kosongkan untuk seluruh waktu.",
          },
          format: {
            type: "string",
            enum: ["PHYSICAL", "EBOOK", "ALL"],
            description:
              "Sumber transaksi: 'PHYSICAL' untuk buku fisik/BorrowRecord (default), 'EBOOK' untuk ebook/EbookLoan, 'ALL' hanya untuk permintaan eksplisit kedua format.",
          },
        },
      },
    },
  }),

  tool("OPERATIONAL", {
    type: "function",
    function: {
      name: "get_borrows_by_date",
      description:
        "Transaksi peminjaman (buku fisik dan ebook) pada satu TANGGAL tertentu menurut zona waktu Asia/Jakarta. WAJIB dipakai untuk pertanyaan seperti 'siapa yang meminjam buku hari ini/kemarin', 'siapa yang meminjam pada tanggal 18 Oktober', atau 'tampilkan peminjaman 2026-10-15'. Semua jam pada hasil sudah WIB. Pengajuan yang belum disetujui dan transaksi yang ditolak/dibatalkan tidak dihitung.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "Tanggal yang diminta: 'today' (hari ini), 'yesterday' (kemarin), atau tanggal eksplisit seperti '18 Oktober 2026' / '2026-10-18'.",
          },
        },
        required: ["date"],
      },
    },
  }),

  // ==================== ADMINISTRATIVE ====================
  tool("ADMINISTRATIVE", {
    type: "function",
    function: {
      name: "get_user_count",
      description:
        "Jumlah pengguna terdaftar di DigiLib per role (Admin, Pustakawan, Guru, Siswa, Staf) beserta totalnya. Angka agregat saja, tanpa identitas/nama/email. Khusus Admin. Filter `role`, `period`, `isActive`, `class`, dan `gender` bersifat opsional; tanpa filter, hitungan mencakup SELURUH akun seperti halaman Pengguna/dashboard Admin.",
      parameters: {
        type: "object",
        properties: {
          role: {
            type: "string",
            description: "Filter role opsional: ADMIN, LIBRARIAN, TEACHER, STUDENT, STAFF (atau Admin/Pustakawan/Guru/Siswa/Staf).",
          },
          period: {
            type: "string",
            description: "Periode pembuatan akun opsional: this_month, last_month, this_year, YYYY-MM, atau bulan/tahun tertentu.",
          },
          isActive: {
            type: "boolean",
            description: "Filter status akun opsional: true (aktif) atau false (nonaktif).",
          },
          class: {
            type: "string",
            description:
              "Filter kelas opsional sesuai data pengguna, mis. 'XII IPA 1'. Nilai satu/tanpa jurusan seperti 'XII' atau 'XII IPA' cocok sebagai awalan.",
          },
          gender: {
            type: "string",
            description: "Filter gender opsional: MALE/laki-laki/pria atau FEMALE/perempuan/wanita.",
          },
        },
      },
    },
  }),
  tool("ADMINISTRATIVE", {
    type: "function",
    function: {
      name: "get_user_stats",
      description:
        "Statistik jumlah pengguna per role (Admin, Pustakawan, Guru, Siswa, Staf). Dipakai Admin untuk melihat demografi pengguna sistem. Filter opsional `class` dan `gender` hanya menjawab kelompok yang diminta; jangan menjawab total umum bila filter tidak dapat diterapkan.",
      parameters: {
        type: "object",
        properties: {
          class: {
            type: "string",
            description:
              "Filter kelas opsional sesuai data pengguna, mis. 'XII IPA 1'.",
          },
          gender: {
            type: "string",
            description: "Filter gender opsional: MALE/laki-laki/pria atau FEMALE/perempuan/wanita.",
          },
          isActive: {
            type: "boolean",
            description: "Filter status akun opsional: true (aktif) atau false (nonaktif).",
          },
        },
      },
    },
  }),
  tool("ADMINISTRATIVE", {
    type: "function",
    function: {
      name: "get_ebook_reading_activity",
      description:
        "Aktivitas membaca ebook GLOBAL (khusus ADMIN): sesi yang benar-benar tercatat, pengguna unik, ebook unik, status aktivitas, dan halaman/progres bila tersedia. Jangan memakai data peminjaman sebagai bukti aktivitas membaca. Jangan mengarang halaman/progres.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description:
              "Filter status opsional: ACTIVE (aktivitas dalam 30 menit terakhir), OPENED (baru dibuka), INACTIVE.",
          },
          period: {
            type: "string",
            description:
              "Periode opsional: today, 7d, 30d, this_month, last_month, this_year, all, YYYY-MM, atau bulan/tahun tertentu.",
          },
          search: {
            type: "string",
            description: "Nama pengguna/kelas/NIS atau judul/penulis ebook (opsional).",
          },
        },
      },
    },
  }),
  tool("ADMINISTRATIVE", {
    type: "function",
    function: {
      name: "get_user_directory",
      description:
        "Daftar identitas pengguna DigiLib (khusus ADMIN): nama, email, role, status akun, NIS/NIP, kelas, dan waktu pendaftaran. Dipakai untuk 'tampilkan daftar seluruh siswa/guru/pengguna'. Filter role, isActive, class, dan search bersifat opsional. JANGAN pernah menampilkan password/hash/token.",
      parameters: {
        type: "object",
        properties: {
          role: {
            type: "string",
            description: "Filter role opsional: ADMIN, LIBRARIAN, TEACHER, STUDENT, STAFF.",
          },
          isActive: {
            type: "boolean",
            description: "Filter status akun opsional: true (aktif) atau false (nonaktif).",
          },
          class: {
            type: "string",
            description: "Filter kelas opsional, mis. 'XII IPA 1'.",
          },
          classExact: {
            type: "boolean",
            description:
              "true bila kelas harus sama persis; false/absen berarti cocok sebagai awalan.",
          },
          search: {
            type: "string",
            description: "Cari berdasarkan nama, email, atau NIS/NIP (opsional).",
          },
        },
      },
    },
  }),
  tool("ADMINISTRATIVE", {
    type: "function",
    function: {
      name: "get_user_borrows",
      description:
        "Riwayat lengkap SATU pengguna (khusus ADMIN) berdasarkan nama, email, atau NIS/NIP: identitas, total transaksi buku fisik + ebook, peminjaman aktif, riwayat terbaru, dan denda. Bila lebih dari satu pengguna cocok, hasilnya ambiguous dan harus diklarifikasi. JANGAN pernah menampilkan password/hash/token.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Nama lengkap/sebagian, email, atau NIS/NIP pengguna target.",
          },
        },
        required: ["search"],
      },
    },
  }),
  tool("ADMINISTRATIVE", {
    type: "function",
    function: {
      name: "get_system_settings",
      description:
        "Pengaturan sistem non-sensitif (mis. tarif denda per hari). JANGAN pernah menampilkan password, token, secret, atau kredensial.",
      parameters: { type: "object", properties: {} },
    },
  }),
  tool("ADMINISTRATIVE", {
    type: "function",
    function: {
      name: "get_user_audit_history",
      description:
        "Riwayat AUDIT pembuatan dan penghapusan akun pengguna (khusus ADMIN). Menyertakan pelaku aksi, akun target, waktu aksi, dan waktu pembuatan akun bila akun masih ada. Dipakai untuk 'siapa pengguna yang dihapus hari ini', 'akun apa saja yang dibuat hari ini', atau 'kapan akun X dibuat'. TIDAK menyediakan password/token/kredensial.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "CREATE (pembuatan), DELETE (penghapusan), atau ALL (keduanya). Default ALL.",
          },
          date: {
            type: "string",
            description:
              "Tanggal: 'hari ini'/'today', 'kemarin'/'yesterday', atau tanggal eksplisit ('18 Oktober 2026' / '2026-10-18'). Kosongkan untuk riwayat terbaru.",
          },
          search: {
            type: "string",
            description: "Nama atau email akun target yang dicari (opsional).",
          },
        },
      },
    },
  }),
];

const TOOL_CATEGORY_MAP = new Map<string, AIToolCategory>(
  ALL_TOOLS.map((t) => [t.function.name, t.category])
);

/**
 * Memilih tools yang boleh dipakai sebuah role.
 * - PERSONAL: semua role.
 * - OPERATIONAL: LIBRARIAN, ADMIN.
 * - ADMINISTRATIVE: ADMIN.
 */
export function toolsForRole(role: string): AIToolDefinition[] {
  return ALL_TOOLS.filter((t) => canUseToolCategory(role, t.category));
}

/**
 * Eksekusi tool atas nama pengguna yang sedang login. Memeriksa otorisasi
 * role pengguna di backend sebelum menjalankan handler. Tidak pernah melempar
 * error: kegagalan otorisasi atau query dikembalikan sebagai { error } agar model
 * menyampaikan status dengan aman tanpa membocorkan data.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
  role: string
): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  const category = TOOL_CATEGORY_MAP.get(name);

  if (!handler || !category) {
    return JSON.stringify({ error: `Fungsi "${name}" tidak tersedia.` });
  }

  if (!canUseToolCategory(role, category)) {
    return JSON.stringify({
      error: "Akses ditolak: role Anda tidak memiliki wewenang untuk fungsi ini.",
    });
  }

  try {
    const result = await handler(args, userId);
    return JSON.stringify(result);
  } catch (error) {
    console.error(`[AI] Tool ${name} gagal untuk user ${userId}.`, error);
    return JSON.stringify({
      error: "Pengambilan data gagal. Silakan coba lagi.",
    });
  }
}
