/**
 * Jawaban deterministik untuk pertanyaan TARIF denda.
 *
 * Nominal TIDAK pernah ditulis di kode jawaban maupun diambil dari teks model:
 * seluruh angka dibaca dari pengaturan aktif (`Setting`) melalui accessor runtime
 * di `src/lib/config/settings.ts`, dengan fallback ke `LIBRARY_CONFIG`.
 *
 * Denda yang sudah tercatat pada BorrowRecord adalah snapshot saat buku
 * dikembalikan. Perubahan tarif hanya berlaku untuk perhitungan berikutnya —
 * fakta ini dinyatakan pada jawaban agar pengguna tidak mengira denda lama ikut
 * berubah.
 */

import { getDamageFineConfig, getFinePerDayIDR } from "@/lib/config/settings";
import { formatRupiah } from "./personalAnswer";

export const FINE_RATE_UNAVAILABLE =
  "Tarif denda belum dapat diakses saat ini. Silakan coba lagi.";

export interface FineRateScope {
  /** Pengguna menanyakan tarif denda keterlambatan. */
  late: boolean;
  /** Kunci kategori kerusakan yang ditanyakan (kosong = tidak menanyakan kerusakan). */
  damage: string[];
}

/** Kategori kerusakan yang ditampilkan saat pengguna bertanya "denda kerusakan" umum. */
const ALL_DAMAGE_KEYS = [
  "DIRTY",
  "LIGHT",
  "TORN_PAGE",
  "MISSING_PAGE",
  "COVER_DAMAGE",
  "SEVERE",
];

interface DamageCue {
  key: string;
  pattern: RegExp;
}

/**
 * Penanda kategori kerusakan. Urutan tidak memengaruhi hasil karena semua
 * kategori yang cocok dikumpulkan; pola yang lebih spesifik (mis. "halaman
 * hilang") tetap menghasilkan kunci yang sama dengan kata kuncinya.
 */
const DAMAGE_CUES: DamageCue[] = [
  { key: "TORN_PAGE", pattern: /\b(?:sobek|robek|halaman\s+sobek)\b/ },
  { key: "MISSING_PAGE", pattern: /\b(?:hilang|kehilangan|halaman\s+hilang)\b/ },
  { key: "COVER_DAMAGE", pattern: /\b(?:sampul|cover)\b/ },
  { key: "LIGHT", pattern: /\b(?:ringan|rusak\s+ringan|kerusakan\s+ringan)\b/ },
  { key: "SEVERE", pattern: /\b(?:berat|rusak\s+berat|kerusakan\s+berat)\b/ },
  { key: "DIRTY", pattern: /\b(?:kotor|kotoran|noda)\b/ },
];

const LATE_CUE = /\b(?:keterlambatan|terlambat|telat|overdue|per\s*hari|perhari|harian)\b/;
const DAMAGE_GENERIC_CUE = /\b(?:kerusakan|rusak)\b/;

/** Normalisasi ringan khusus modul ini (tanpa mengubah istilah domain). */
function normalizeRateQuery(query: string): string {
  return ` ${query
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * Menentukan cakupan tarif yang ditanyakan.
 *
 * - Menyebut kategori kerusakan spesifik → hanya kategori tersebut.
 * - Menyebut "kerusakan"/"rusak" tanpa kategori → seluruh kategori kerusakan.
 * - Menyebut keterlambatan/per hari → tarif keterlambatan.
 * - Tidak menyebut jenis apa pun (mis. "Berapa tarif denda?") → keduanya.
 */
export function detectFineRateScope(query: string): FineRateScope {
  const q = normalizeRateQuery(query);

  const late = LATE_CUE.test(q);

  const damage: string[] = [];
  for (const cue of DAMAGE_CUES) {
    if (cue.pattern.test(q) && !damage.includes(cue.key)) damage.push(cue.key);
  }

  if (damage.length === 0 && DAMAGE_GENERIC_CUE.test(q)) {
    damage.push(...ALL_DAMAGE_KEYS);
  }

  // Pertanyaan tarif umum tanpa jenis denda: tampilkan tarif keterlambatan dan
  // seluruh kategori kerusakan agar pengguna mendapat gambaran lengkap.
  if (!late && damage.length === 0) {
    return { late: true, damage: [...ALL_DAMAGE_KEYS] };
  }

  return { late, damage };
}

/**
 * Membangun jawaban tarif dari pengaturan aktif. Melempar error bila pembacaan
 * database gagal agar pipeline dapat menyatakan keterbatasan — bukan menampilkan
 * angka default seolah-olah itu tarif yang berlaku.
 */
export async function buildFineRateAnswer(
  query: string
): Promise<{ message: string }> {
  const scope = detectFineRateScope(query);
  const [lateRate, damageConfig] = await Promise.all([
    getFinePerDayIDR(),
    getDamageFineConfig(),
  ]);

  const sections: string[] = [];

  if (scope.late) {
    sections.push(
      `**Denda keterlambatan**\n- ${formatRupiah(lateRate)} per hari per buku.`
    );
  }

  if (scope.damage.length > 0) {
    const byKey = new Map(damageConfig.map((row) => [row.key, row]));
    const lines = scope.damage.map((key) => {
      const row = byKey.get(key);
      const label = row?.label ?? key;
      const amount = row?.amountIDR ?? 0;
      return `- ${label}: ${formatRupiah(amount)}`;
    });
    sections.push(`**Denda kerusakan**\n${lines.join("\n")}`);
  }

  return {
    message:
      `Tarif denda yang berlaku saat ini (dibaca dari pengaturan aktif):\n\n` +
      `${sections.join("\n\n")}\n\n` +
      `Denda yang sudah tercatat tidak berubah saat tarif diubah; tarif baru ` +
      `berlaku untuk perhitungan denda berikutnya.`,
  };
}
