/**
 * Runtime, database-backed settings (server-only).
 *
 * Nilai yang dapat diubah Admin disimpan pada tabel `Setting` sebagai key/value.
 * Modul ini menyediakan pembacaan dengan fallback ke default di config, sehingga
 * sistem tetap berjalan walaupun Admin belum pernah menyimpan nilai apa pun.
 *
 * PENTING: tarif denda yang berlaku diambil dari sini. Perubahan tarif hanya
 * memengaruhi denda yang dihitung SETELAH perubahan. Denda yang sudah
 * di-*snapshot* pada BorrowRecord.fineAmount/Rate tidak ikut berubah.
 */

import { prisma } from "@/lib/prisma";
import { LIBRARY_CONFIG, getDamageCondition } from "@/lib/config/library";

export const SETTING_KEYS = {
  FINE_PER_DAY_IDR: "finePerDayIDR",
  /** Awalan key tarif denda kerusakan per kategori: `damageFineIDR.<KEY>`. */
  DAMAGE_FINE_PREFIX: "damageFineIDR.",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export function damageFineSettingKey(conditionKey: string): string {
  return `${SETTING_KEYS.DAMAGE_FINE_PREFIX}${conditionKey}`;
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    // Tabel belum ada / DB error – jangan sampai mematikan fitur peminjaman.
    return null;
  }
}

/**
 * Tarif denda harian yang berlaku (IDR). Fallback ke config bila belum diatur
 * Admin atau bila nilai tersimpan tidak valid.
 */
export async function getFinePerDayIDR(): Promise<number> {
  const raw = await readSetting(SETTING_KEYS.FINE_PER_DAY_IDR);
  if (raw === null) return LIBRARY_CONFIG.finePerDayIDR;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return LIBRARY_CONFIG.finePerDayIDR;
  return parsed;
}

/**
 * Apakah Admin sudah menetapkan tarif denda secara eksplisit di database.
 * Dipakai untuk memberi tahu bahwa tarif masih memakai nilai bawaan.
 */
export async function isFineRateConfigured(): Promise<boolean> {
  const raw = await readSetting(SETTING_KEYS.FINE_PER_DAY_IDR);
  if (raw === null) return false;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0;
}

export async function setFinePerDayIDR(value: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.FINE_PER_DAY_IDR },
    update: { value: String(value) },
    create: { key: SETTING_KEYS.FINE_PER_DAY_IDR, value: String(value) },
  });
}

/**
 * Tarif denda untuk satu kategori kerusakan. Fallback ke default config bila
 * Admin belum mengatur. Kategori tidak dikenal → 0 (tidak menagih tanpa dasar).
 */
export async function getDamageFineIDR(conditionKey: string): Promise<number> {
  const condition = getDamageCondition(conditionKey);
  if (!condition) return 0;
  const raw = await readSetting(damageFineSettingKey(conditionKey));
  if (raw === null) return condition.defaultFineIDR;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return condition.defaultFineIDR;
  return parsed;
}

/** Daftar tarif kerusakan + status apakah sudah dikonfigurasi eksplisit. */
export async function getDamageFineConfig(): Promise<
  Array<{ key: string; label: string; amountIDR: number; configured: boolean; defaultIDR: number }>
> {
  const rows = await prisma.setting
    .findMany({ where: { key: { startsWith: SETTING_KEYS.DAMAGE_FINE_PREFIX } } })
    .catch(() => [] as Array<{ key: string; value: string }>);
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  return LIBRARY_CONFIG.damageConditions.map((c) => {
    const raw = stored.get(damageFineSettingKey(c.key));
    const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
    const configured = Number.isFinite(parsed) && parsed >= 0;
    return {
      key: c.key,
      label: c.label,
      amountIDR: configured ? parsed : c.defaultFineIDR,
      configured,
      defaultIDR: c.defaultFineIDR,
    };
  });
}

export async function setDamageFineIDR(conditionKey: string, value: number): Promise<void> {
  const key = damageFineSettingKey(conditionKey);
  await prisma.setting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}
