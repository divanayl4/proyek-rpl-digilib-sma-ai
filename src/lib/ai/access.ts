/**
 * Kendali akses AI Chat Assistant.
 *
 * AI Assistant tersedia untuk semua role (Siswa, Guru, Pustakawan, Admin),
 * tetapi dengan HAK AKSES YANG BERBEDA:
 *
 * - STUDENT / TEACHER / STAFF: data pribadi miliknya sendiri + katalog.
 * - LIBRARIAN:  data pribadi + katalog + data operasional (semua transaksi,
 *   keterlambatan, denda, ebook loan).
 * - ADMIN:        semua yang diizinkan Pustakawan + daftar identitas pengguna,
 *   riwayat per pengguna, jumlah/statistik pengguna, dan pengaturan sistem
 *   non-sensitif.
 *
 * Semua role tetap dilarang mengakses password/hash, token sesi, API key,
 * secret, atau kredensial database.
 *
 * Satu sumber kebenaran ini dipakai oleh UI (widget) dan API agar
 * pembatasan tidak pernah berbeda antar lapisan.
 */
export const AI_ASSISTANT_ROLES = [
  "TEACHER",
  "STUDENT",
  "LIBRARIAN",
  "ADMIN",
  "STAFF",
] as const;

export type AIAssistantRole = (typeof AI_ASSISTANT_ROLES)[number];

/** True bila role yang diberikan berhak memakai AI Chat Assistant. */
export function canUseAIAssistant(role: string | null | undefined): boolean {
  return (
    typeof role === "string" &&
    (AI_ASSISTANT_ROLES as readonly string[]).includes(role)
  );
}

/**
 * Kategori tool yang boleh dipakai sebuah role.
 * Dipakai route untuk memilih daftar fungsi yang dikirim ke model.
 */
export type AIToolCategory = "PERSONAL" | "OPERATIONAL" | "ADMINISTRATIVE";

/** Role yang boleh memakai tool kategori OPERATIONAL (data seluruh sistem). */
const OPERATIONAL_ROLES: ReadonlySet<string> = new Set(["LIBRARIAN", "ADMIN"]);

/** Role yang boleh memakai tool kategori ADMINISTRATIVE. */
const ADMINISTRATIVE_ROLES: ReadonlySet<string> = new Set(["ADMIN"]);

/** True bila role boleh memakai tool pada kategori tertentu. */
export function canUseToolCategory(
  role: string | null | undefined,
  category: AIToolCategory
): boolean {
  if (typeof role !== "string") return false;
  if (category === "PERSONAL") return canUseAIAssistant(role);
  if (category === "OPERATIONAL") return OPERATIONAL_ROLES.has(role);
  return ADMINISTRATIVE_ROLES.has(role);
}

/** Label ramah role untuk prompt dan UI. */
export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case "ADMIN":
      return "Administrator";
    case "LIBRARIAN":
      return "Pustakawan";
    case "TEACHER":
      return "Guru";
    case "STUDENT":
      return "Siswa";
    case "STAFF":
      return "Staf";
    default:
      return "Pengguna";
  }
}
