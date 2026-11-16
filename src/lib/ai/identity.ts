/**
 * Personalisasi sapaan AI Assistant berdasarkan akun yang sedang login.
 *
 * Sumber data HANYA satu: baris User milik `session.user.id` (diambil di route).
 * Tidak ada nama/gender yang diambil dari input pengguna atau akun lain, sehingga
 * asisten tidak mungkin menyapa dengan identitas yang dikarang.
 */

export type UserGender = "MALE" | "FEMALE";

export interface UserIdentity {
  name: string;
  role: string;
  gender: string | null;
  /** Kelas siswa (mis. "XI IPA 1"); null untuk peran non-siswa / data kosong. */
  class?: string | null;
}

/** Data mentah User yang diperlukan untuk personalisasi. */
export interface UserIdentitySource {
  name: string;
  role: string;
  gender: string | null;
  class?: string | null;
}

/** Normalisasi nilai gender dari database. */
export function normalizeGender(gender: string | null | undefined): UserGender | null {
  if (!gender) return null;
  const value = gender.trim().toUpperCase();
  if (value === "MALE" || value === "FEMALE") return value;
  return null;
}

export function toUserIdentity(source: UserIdentitySource): UserIdentity {
  const className = source.class?.trim();
  return {
    name: source.name,
    role: source.role,
    gender: normalizeGender(source.gender),
    class: className ? className : null,
  };
}

const HONORIFIC_BY_GENDER: Record<UserGender, string> = {
  MALE: "Pak",
  FEMALE: "Bu",
};

/**
 * Peran yang tidak pernah disapa dengan gelar Pak/Bu.
 * Siswa cukup dipanggil namanya (lihat contoh pada kebutuhan).
 */
const TITLELESS_ROLES = new Set(["STUDENT"]);

/** Nama yang sudah memiliki gelar sendiri, agar tidak menjadi "Pak Pak ...". */
const EXISTING_TITLE =
  /^(pak|bapak|bu|ibu|mr|mrs|ms|dr|drs|dra|prof)\.?\b/i;

/**
 * Sapaan depan ("Pak"/"Bu") berdasarkan peran dan gender.
 * Mengembalikan string kosong bila gender tidak tersedia atau peran tanpa gelar.
 */
export function getHonorific(
  role: string,
  gender: string | null | undefined
): string {
  const normalized = normalizeGender(gender);
  if (!normalized) return "";
  if (TITLELESS_ROLES.has(role)) return "";
  return HONORIFIC_BY_GENDER[normalized];
}

/**
 * Nama yang siap ditampilkan/diucapkan, sudah memperhitungkan gelar.
 * Contoh: teacher + MALE + "Yoga" -> "Pak Yoga"; student + "Arya" -> "Arya";
 * gender tidak tersedia -> nama polos.
 */
export function formatDisplayName(identity: UserIdentity): string {
  const name = identity.name.trim();
  const honorific = getHonorific(identity.role, identity.gender);
  if (!honorific) return name;
  if (EXISTING_TITLE.test(name)) return name;
  return `${honorific} ${name}`;
}

/** Sapaan personal yang pasti dipakai saat pengguna hanya menyapa. */
export function buildPersonalGreeting(identity: UserIdentity): string {
  return `Hai, ${formatDisplayName(identity)}. Ada yang bisa saya bantu?`;
}

/**
 * Sapaan murni: seluruh pesan hanyalah sapaan (boleh diulang/dengan tanda baca),
 * tanpa permintaan lain. Dipakai untuk membalas sapaan secara deterministik agar
 * nama dan gelar dijamin benar dan tidak pernah dikarang model.
 */
const PURE_GREETING =
  /^(?:assalamu[\s'’]?alaikum|salam|hai+|halo+|hei+|hi+|hey+|selamat\s+(?:pagi|siang|sore|malam|datang)|pagi|siang|sore|malam|(?:apa|gimana|bagaimana)\s+kabar|how\s+are\s+you|good\s+(?:morning|afternoon|evening|night))(?:\s+(?:apa|gimana|bagaimana)\s+kabar)?[\s!.,?~-]*$/i;

export function isPureGreeting(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return PURE_GREETING.test(trimmed);
}