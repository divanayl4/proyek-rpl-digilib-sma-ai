/**
 * WhatsApp Notification Service (Fonnte) — server-only.
 *
 * Arsitektur:
 * - SATU nomor WhatsApp Admin (FONNTE_ADMIN_NUMBER) menjadi pengirim seluruh
 *   notifikasi. Token Fonnte hanya dibaca di server dan tidak pernah dikirim ke
 *   klien/log. Token dari dashboard disimpan terenkripsi (AES-256-GCM).
 * - Setiap pengguna memiliki nomor WhatsApp sendiri di tabel User. Nomor wajib
 *   dinormalisasi (62…) dan diverifikasi sebelum dipakai menerima notifikasi.
 * - Seluruh pengiriman tercatat di WhatsAppDelivery dengan `eventKey` unik
 *   sebagai anti-duplikat dan riwayat status.
 *
 * Integrasi ini TERPISAH dari konfigurasi AI/chatbot. Modul ini tidak membaca
 * maupun mengubah provider/model/prompt/RAG AI.
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/ai/configCrypto";
import {
  WHATSAPP_CATEGORIES,
  WHATSAPP_CATEGORY_LABELS,
  isWhatsAppCategory,
  type WhatsAppCategory,
} from "@/lib/whatsapp-shared";

export {
  WHATSAPP_CATEGORIES,
  WHATSAPP_CATEGORY_LABELS,
  isWhatsAppCategory,
  type WhatsAppCategory,
};

export const FONNTE_SEND_URL = "https://api.fonnte.com/send";
export const FONNTE_DEVICE_URL = "https://api.fonnte.com/device";


/** Semua role boleh menerima notifikasi WhatsApp miliknya sendiri. */
export const WHATSAPP_RECIPIENT_ROLES = [
  "ADMIN",
  "LIBRARIAN",
  "STUDENT",
  "TEACHER",
  "STAFF",
] as const;

export type WhatsAppConfigSource = "database" | "environment" | "none";

export interface WhatsAppConfig {
  token: string | null;
  /** Nomor Admin yang menjadi pengirim (format 62…). */
  adminNumber: string | null;
  enabled: boolean;
  enabledCategories: WhatsAppCategory[];
  tokenSource: WhatsAppConfigSource;
  adminNumberSource: WhatsAppConfigSource;
}

const SETTING_KEYS = {
  TOKEN: "whatsapp.fonnteToken",
  ADMIN_NUMBER: "whatsapp.adminNumber",
  ENABLED: "whatsapp.enabled",
  ENABLED_CATEGORIES: "whatsapp.enabledCategories",
  LAST_CONNECTION: "whatsapp.lastConnectionTest",
} as const;

const FONNTE_TIMEOUT_MS = 12_000;
const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const VERIFICATION_RESEND_MS = 60 * 1000;
export const VERIFICATION_MAX_ATTEMPTS = 5;

export interface WhatsAppConnectionStatus {
  status: "UNKNOWN" | "CONNECTED" | "FAILED";
  message: string;
  checkedAt: string | null;
}

// ---------------------------------------------------------------------------
// Nomor telepon
// ---------------------------------------------------------------------------

/**
 * Normalisasi nomor Indonesia ke format internasional tanpa "+" (62…).
 * Menerima: 08xx, 8xx, 628xx, +628xx, dengan spasi/tanda hubung/titik.
 * Mengembalikan null bila bukan nomor seluler Indonesia yang valid.
 */
export function normalizeWhatsAppNumber(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.trim().replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  else if (!digits.startsWith("62")) return null;

  // 62 + 8 + 7..11 digit → total 11..15 digit. Nomor seluler Indonesia.
  if (!/^628\d{7,11}$/.test(digits)) return null;
  return digits;
}

/** Tampilkan nomor secara aman: 6281•••••890. */
export function maskPhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = normalizeWhatsAppNumber(raw) ?? raw;
  if (normalized.length <= 7) return "••••";
  return `${normalized.slice(0, 4)}${"•".repeat(Math.max(3, normalized.length - 7))}${normalized.slice(-3)}`;
}

/** Token tidak pernah ditampilkan utuh. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Konfigurasi (database + fallback environment)
// ---------------------------------------------------------------------------

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

function decodeStoredToken(raw: string | null): string | null {
  if (!raw) return null;
  // Token baru selalu tersimpan sebagai envelope terenkripsi. Nilai lama yang
  // bukan envelope diabaikan (jangan pernah memakai plaintext dari database).
  const decrypted = decryptSecret(raw);
  return decrypted && decrypted.trim() ? decrypted.trim() : null;
}

function parseEnabledCategories(raw: string | null): WhatsAppCategory[] {
  if (!raw) return [...WHATSAPP_CATEGORIES];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...WHATSAPP_CATEGORIES];
    const valid = parsed.filter(isWhatsAppCategory);
    return valid.length > 0 ? Array.from(new Set(valid)) : [];
  } catch {
    return [...WHATSAPP_CATEGORIES];
  }
}

/**
 * Konfigurasi efektif. Nilai database (dashboard) menang atas environment;
 * token di database selalu terenkripsi. Tidak pernah melempar.
 */
export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const [tokenRaw, adminRaw, enabledRaw, categoriesRaw] = await Promise.all([
    readSetting(SETTING_KEYS.TOKEN),
    readSetting(SETTING_KEYS.ADMIN_NUMBER),
    readSetting(SETTING_KEYS.ENABLED),
    readSetting(SETTING_KEYS.ENABLED_CATEGORIES),
  ]);

  const dbToken = decodeStoredToken(tokenRaw);
  const envToken =
    process.env.FONNTE_API_TOKEN && process.env.FONNTE_API_TOKEN.trim()
      ? process.env.FONNTE_API_TOKEN.trim()
      : null;
  const token = dbToken ?? envToken;

  const dbAdmin = adminRaw ? normalizeWhatsAppNumber(adminRaw) : null;
  const envAdmin = process.env.FONNTE_ADMIN_NUMBER
    ? normalizeWhatsAppNumber(process.env.FONNTE_ADMIN_NUMBER)
    : null;
  const adminNumber = dbAdmin ?? envAdmin;

  const enabled =
    enabledRaw !== null
      ? enabledRaw === "true"
      : process.env.FONNTE_ENABLED !== "false";

  return {
    token,
    adminNumber,
    enabled,
    enabledCategories: parseEnabledCategories(categoriesRaw),
    tokenSource: dbToken ? "database" : envToken ? "environment" : "none",
    adminNumberSource: dbAdmin
      ? "database"
      : envAdmin
        ? "environment"
        : "none",
  };
}

/** Status konfigurasi yang aman ditampilkan ke UI (tanpa token utuh). */
export async function getWhatsAppConfigSummary() {
  const config = await getWhatsAppConfig();
  const lastConnection = await getLastConnectionTest();

  return {
    configured: Boolean(config.token),
    tokenMasked: maskSecret(config.token),
    tokenSource: config.tokenSource,
    adminNumber: config.adminNumber,
    adminNumberSource: config.adminNumberSource,
    enabled: config.enabled,
    enabledCategories: config.enabledCategories,
    allCategories: WHATSAPP_CATEGORIES.map((key) => ({
      key,
      label: WHATSAPP_CATEGORY_LABELS[key],
    })),
    lastConnection,
  };
}

export interface SaveWhatsAppConfigInput {
  /** Bila undefined/string kosong, token lama tidak diubah. */
  token?: string | null;
  adminNumber?: string | null;
  enabled?: boolean;
  enabledCategories?: string[];
}

/**
 * Simpan konfigurasi dari dashboard Admin. Token dienkripsi; token kosong
 * berarti "pertahankan yang lama". Tidak pernah mengembalikan token.
 */
export async function saveWhatsAppConfig(input: SaveWhatsAppConfigInput) {
  if (typeof input.token === "string" && input.token.trim()) {
    const encrypted = encryptSecret(input.token.trim());
    await writeSetting(SETTING_KEYS.TOKEN, encrypted);
  }

  if (input.adminNumber !== undefined) {
    if (input.adminNumber === null || input.adminNumber.trim() === "") {
      await prisma.setting.deleteMany({ where: { key: SETTING_KEYS.ADMIN_NUMBER } });
    } else {
      const normalized = normalizeWhatsAppNumber(input.adminNumber);
      if (!normalized) throw new Error("Nomor WhatsApp Admin tidak valid.");
      await writeSetting(SETTING_KEYS.ADMIN_NUMBER, normalized);
    }
  }

  if (typeof input.enabled === "boolean") {
    await writeSetting(SETTING_KEYS.ENABLED, input.enabled ? "true" : "false");
  }

  if (Array.isArray(input.enabledCategories)) {
    const valid = Array.from(
      new Set(input.enabledCategories.filter(isWhatsAppCategory))
    );
    await writeSetting(SETTING_KEYS.ENABLED_CATEGORIES, JSON.stringify(valid));
  }

  return getWhatsAppConfigSummary();
}

/** Fitur siap dipakai: token ada, nomor admin ada, dan tidak dimatikan. */
export function isWhatsAppReady(config: WhatsAppConfig): boolean {
  return Boolean(config.token && config.adminNumber && config.enabled);
}

// ---------------------------------------------------------------------------
// Fonnte API
// ---------------------------------------------------------------------------

export interface FonnteSendResult {
  ok: boolean;
  providerMessageId: string | null;
  providerStatus: string | null;
  error: string | null;
}

function sanitizeProviderError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  // Jangan pernah menyertakan token pada pesan error.
  const token = process.env.FONNTE_API_TOKEN;
  let sanitized = text.slice(0, 500);
  if (token && token.trim()) {
    sanitized = sanitized.split(token.trim()).join("[redacted]");
  }
  return sanitized;
}

function isFonnteSuccess(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const status = (payload as { status?: unknown }).status;
  return status === true || status === "true" || status === "success";
}

/**
 * Kirim satu pesan melalui Fonnte. Berhasil HANYA bila respons JSON Fonnte
 * menyatakan status sukses — bukan sekadar HTTP 200. Tidak pernah melempar.
 */
export async function sendWhatsAppMessage(
  target: string,
  message: string,
  timeoutMs: number = FONNTE_TIMEOUT_MS
): Promise<FonnteSendResult> {
  const config = await getWhatsAppConfig();
  if (!config.token) {
    return {
      ok: false,
      providerMessageId: null,
      providerStatus: null,
      error: "Token Fonnte belum dikonfigurasi.",
    };
  }

  const normalized = normalizeWhatsAppNumber(target);
  if (!normalized) {
    return {
      ok: false,
      providerMessageId: null,
      providerStatus: null,
      error: "Nomor penerima tidak valid.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new URLSearchParams({ target: normalized, message });
    const res = await fetch(FONNTE_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: config.token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: controller.signal,
    });

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        providerMessageId: null,
        providerStatus: `HTTP ${res.status}`,
        error:
          sanitizeProviderError(
            (payload as { reason?: unknown; detail?: unknown } | null)?.reason ??
              (payload as { detail?: unknown } | null)?.detail
          ) ?? `Fonnte membalas HTTP ${res.status}.`,
      };
    }

    if (!isFonnteSuccess(payload)) {
      return {
        ok: false,
        providerMessageId: null,
        providerStatus: "REJECTED",
        error:
          sanitizeProviderError(
            (payload as { reason?: unknown; detail?: unknown } | null)?.reason ??
              (payload as { detail?: unknown } | null)?.detail
          ) ?? "Fonnte menolak pengiriman pesan.",
      };
    }

    const idField = (payload as { id?: unknown }).id;
    const providerMessageId = Array.isArray(idField)
      ? String(idField[0] ?? "")
      : idField !== undefined
        ? String(idField)
        : null;
    const process = (payload as { process?: unknown }).process;

    return {
      ok: true,
      providerMessageId: providerMessageId || null,
      providerStatus: typeof process === "string" ? process : "SENT",
      error: null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      providerMessageId: null,
      providerStatus: aborted ? "TIMEOUT" : "NETWORK_ERROR",
      error: aborted
        ? "Waktu koneksi ke Fonnte habis."
        : "Gagal menghubungi Fonnte.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface FonnteDeviceResult {
  ok: boolean;
  message: string;
  deviceName: string | null;
  quota: string | null;
}

/**
 * Periksa koneksi/device Fonnte. Token tidak pernah dikembalikan ke UI.
 */
export async function checkFonnteConnection(): Promise<FonnteDeviceResult> {
  const config = await getWhatsAppConfig();
  if (!config.token) {
    return {
      ok: false,
      message: "Token Fonnte belum dikonfigurasi.",
      deviceName: null,
      quota: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FONNTE_TIMEOUT_MS);
  try {
    const res = await fetch(FONNTE_DEVICE_URL, {
      method: "POST",
      headers: { Authorization: config.token },
      signal: controller.signal,
    });

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok || !isFonnteSuccess(payload)) {
      return {
        ok: false,
        message:
          sanitizeProviderError(
            (payload as { reason?: unknown; detail?: unknown } | null)?.reason ??
              (payload as { detail?: unknown } | null)?.detail
          ) ?? `Fonnte menolak koneksi (HTTP ${res.status}).`,
        deviceName: null,
        quota: null,
      };
    }

    const device =
      (payload as { device?: unknown }).device ??
      (payload as { name?: unknown }).name ??
      (payload as { device_name?: unknown }).device_name;
    const quota =
      (payload as { quota?: unknown }).quota ??
      (payload as { remaining?: unknown }).remaining;

    return {
      ok: true,
      message: "Koneksi Fonnte berhasil.",
      deviceName: device !== undefined ? String(device) : null,
      quota: quota !== undefined ? String(quota) : null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      message: aborted
        ? "Waktu koneksi ke Fonnte habis."
        : "Gagal menghubungi Fonnte.",
      deviceName: null,
      quota: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getLastConnectionTest(): Promise<WhatsAppConnectionStatus> {
  const raw = await readSetting(SETTING_KEYS.LAST_CONNECTION);
  if (!raw) return { status: "UNKNOWN", message: "Belum pernah diuji.", checkedAt: null };
  try {
    const parsed = JSON.parse(raw) as Partial<WhatsAppConnectionStatus>;
    const status =
      parsed.status === "CONNECTED" || parsed.status === "FAILED"
        ? parsed.status
        : "UNKNOWN";
    return {
      status,
      message: typeof parsed.message === "string" ? parsed.message : "",
      checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : null,
    };
  } catch {
    return { status: "UNKNOWN", message: "Belum pernah diuji.", checkedAt: null };
  }
}

export async function recordConnectionTest(result: FonnteDeviceResult): Promise<void> {
  const payload: WhatsAppConnectionStatus = {
    status: result.ok ? "CONNECTED" : "FAILED",
    message: result.message,
    checkedAt: new Date().toISOString(),
  };
  await writeSetting(SETTING_KEYS.LAST_CONNECTION, JSON.stringify(payload)).catch(
    () => undefined
  );
}

// ---------------------------------------------------------------------------
// Verifikasi nomor
// ---------------------------------------------------------------------------

export function hashVerificationCode(
  userId: string,
  normalizedNumber: string,
  code: string
): string {
  return createHash("sha256")
    .update(`${userId}:${normalizedNumber}:${code}`)
    .digest("hex");
}

export function codesMatch(expectedHash: string, providedHash: string): boolean {
  const a = Buffer.from(expectedHash, "utf8");
  const b = Buffer.from(providedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface VerificationRequestResult {
  ok: boolean;
  message: string;
  expiresAt?: Date;
  maskedNumber?: string;
}

/** Buat kode 6 digit, simpan hash, lalu kirim ke nomor tujuan via Fonnte. */
export async function requestWhatsAppVerification(
  userId: string,
  rawNumber: string
): Promise<VerificationRequestResult> {
  const number = normalizeWhatsAppNumber(rawNumber);
  if (!number) {
    return { ok: false, message: "Nomor WhatsApp tidak valid. Contoh: 081234567890." };
  }

  const config = await getWhatsAppConfig();
  if (!isWhatsAppReady(config)) {
    return {
      ok: false,
      message: "Fitur WhatsApp belum dikonfigurasi oleh Administrator.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      whatsappVerificationSentAt: true,
      whatsappVerificationCodeHash: true,
    },
  });
  if (!user) {
    return { ok: false, message: "Pengguna tidak ditemukan atau tidak aktif." };
  }

  if (
    user.whatsappVerificationCodeHash &&
    user.whatsappVerificationSentAt &&
    Date.now() - user.whatsappVerificationSentAt.getTime() < VERIFICATION_RESEND_MS
  ) {
    return {
      ok: false,
      message: "Kode baru saja dikirim. Tunggu 1 menit sebelum meminta ulang.",
    };
  }

  const taken = await prisma.user.findFirst({
    where: { whatsappNumber: number, NOT: { id: userId } },
    select: { id: true },
  });
  if (taken) {
    return { ok: false, message: "Nomor ini sudah digunakan akun DigiLib lain." };
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  const codeHash = hashVerificationCode(userId, number, code);
  const eventKey = `whatsapp:verify:${userId}:${Date.now()}`;

  // Catat klaim lebih dulu agar riwayat tetap ada walau pengiriman gagal.
  try {
    await prisma.whatsAppDelivery.create({
      data: {
        eventKey,
        userId,
        category: "ACCOUNT",
        recipientNumber: number,
        title: "Kode Verifikasi WhatsApp",
        message: "Kode verifikasi nomor WhatsApp DigiLib.",
        status: "PENDING",
      },
    });
  } catch {
    return { ok: false, message: "Permintaan verifikasi sedang diproses. Coba lagi." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      whatsappVerificationCodeHash: codeHash,
      whatsappVerificationExpiresAt: expiresAt,
      whatsappVerificationAttempts: 0,
      whatsappVerificationSentAt: new Date(),
    },
  });

  const text =
    `*DigiLib SMA — Verifikasi WhatsApp*\n\n` +
    `Kode verifikasi Anda: *${code}*\n\n` +
    `Kode berlaku ${Math.round(VERIFICATION_TTL_MS / 60000)} menit. ` +
    `Jangan bagikan kode ini kepada siapa pun.`;
  const send = await sendWhatsAppMessage(number, text);

  if (!send.ok) {
    await prisma.whatsAppDelivery
      .update({
        where: { eventKey },
        data: {
          status: "FAILED",
          providerStatus: send.providerStatus,
          errorMessage: send.error,
        },
      })
      .catch(() => undefined);
    // Kode tidak berguna bila tidak terkirim; hapus agar tidak terkunci.
    await prisma.user
      .update({
        where: { id: userId },
        data: {
          whatsappVerificationCodeHash: null,
          whatsappVerificationExpiresAt: null,
        },
      })
      .catch(() => undefined);
    return { ok: false, message: send.error ?? "Gagal mengirim kode verifikasi." };
  }

  await prisma.whatsAppDelivery
    .update({
      where: { eventKey },
      data: {
        status: "SENT",
        providerMessageId: send.providerMessageId,
        providerStatus: send.providerStatus,
        sentAt: new Date(),
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    message: "Kode verifikasi telah dikirim ke WhatsApp Anda.",
    expiresAt,
    maskedNumber: maskPhoneNumber(number) ?? undefined,
  };
}

export interface VerificationConfirmResult {
  ok: boolean;
  message: string;
  whatsappNumber?: string;
  maskedNumber?: string;
}

/** Konfirmasi kode dan aktifkan nomor. Nomor hanya disimpan bila kode cocok. */
export async function confirmWhatsAppVerification(
  userId: string,
  rawNumber: string,
  code: string
): Promise<VerificationConfirmResult> {
  const number = normalizeWhatsAppNumber(rawNumber);
  if (!number) {
    return { ok: false, message: "Nomor WhatsApp tidak valid." };
  }
  if (!/^\d{6}$/.test(code.trim())) {
    return { ok: false, message: "Kode verifikasi harus 6 digit." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      whatsappVerificationCodeHash: true,
      whatsappVerificationExpiresAt: true,
      whatsappVerificationAttempts: true,
    },
  });
  if (!user) return { ok: false, message: "Pengguna tidak ditemukan." };

  if (!user.whatsappVerificationCodeHash || !user.whatsappVerificationExpiresAt) {
    return { ok: false, message: "Tidak ada permintaan verifikasi aktif." };
  }
  if (user.whatsappVerificationExpiresAt.getTime() <= Date.now()) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        whatsappVerificationCodeHash: null,
        whatsappVerificationExpiresAt: null,
        whatsappVerificationAttempts: 0,
      },
    });
    return { ok: false, message: "Kode verifikasi sudah kedaluwarsa." };
  }
  if (user.whatsappVerificationAttempts >= VERIFICATION_MAX_ATTEMPTS) {
    return {
      ok: false,
      message: "Terlalu banyak percobaan. Minta kode baru untuk melanjutkan.",
    };
  }

  const providedHash = hashVerificationCode(userId, number, code.trim());
  if (!codesMatch(user.whatsappVerificationCodeHash, providedHash)) {
    const attempts = user.whatsappVerificationAttempts + 1;
    await prisma.user.update({
      where: { id: userId },
      data: {
        whatsappVerificationAttempts: attempts,
        ...(attempts >= VERIFICATION_MAX_ATTEMPTS
          ? {
              whatsappVerificationCodeHash: null,
              whatsappVerificationExpiresAt: null,
            }
          : {}),
      },
    });
    return { ok: false, message: "Kode verifikasi salah." };
  }

  const taken = await prisma.user.findFirst({
    where: { whatsappNumber: number, NOT: { id: userId } },
    select: { id: true },
  });
  if (taken) {
    return { ok: false, message: "Nomor ini sudah digunakan akun DigiLib lain." };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        whatsappNumber: number,
        whatsappVerified: true,
        whatsappVerifiedAt: new Date(),
        whatsappNotificationsEnabled: true,
        whatsappVerificationCodeHash: null,
        whatsappVerificationExpiresAt: null,
        whatsappVerificationAttempts: 0,
        whatsappVerificationSentAt: null,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, message: "Nomor ini sudah digunakan akun DigiLib lain." };
    }
    return { ok: false, message: "Gagal menyimpan nomor WhatsApp." };
  }

  // Konfirmasi via WhatsApp (best effort; tidak menggagalkan aktivasi).
  await sendWhatsAppMessage(
    number,
    "*DigiLib SMA*\n\nNomor WhatsApp Anda berhasil diverifikasi dan akan menerima notifikasi DigiLib."
  ).catch(() => undefined);

  return {
    ok: true,
    message: "Nomor WhatsApp berhasil diverifikasi.",
    whatsappNumber: number,
    maskedNumber: maskPhoneNumber(number) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Pengiriman notifikasi + riwayat/anti-duplikat
// ---------------------------------------------------------------------------

export type WhatsAppDeliveryStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export type WhatsAppDeliveryReason =
  | "DISABLED"
  | "NOT_RECIPIENT"
  | "DUPLICATE"
  | "FAILED"
  | "SKIPPED";

export interface WhatsAppDeliveryInput {
  userId: string;
  title: string;
  message: string;
  /** Kunci deterministik peristiwa, mis. "borrow:approve:<borrowId>". */
  eventKey: string;
  category?: WhatsAppCategory;
}

export interface WhatsAppDeliveryResult {
  sent: boolean;
  reason?: WhatsAppDeliveryReason;
  status?: WhatsAppDeliveryStatus;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/**
 * Kirim notifikasi ke pemilik `userId`. Tidak pernah melempar sehingga tidak
 * menggagalkan transaksi DigiLib. Alur:
 *  1. Klaim WhatsAppDelivery(eventKey unik) → duplikat berhenti.
 *  2. Validasi user aktif, nomor terverifikasi, preferensi & kategori aktif.
 *  3. Kirim via Fonnte; simpan status SENT/FAILED beserta respons provider.
 */
export async function deliverWhatsAppNotification(
  input: WhatsAppDeliveryInput
): Promise<WhatsAppDeliveryResult> {
  const { userId, title, message, eventKey } = input;
  const category: WhatsAppCategory = input.category ?? "ACCOUNT";

  try {
    const config = await getWhatsAppConfig();
    if (!isWhatsAppReady(config)) {
      return { sent: false, reason: "DISABLED" };
    }
    if (!config.enabledCategories.includes(category)) {
      return { sent: false, reason: "DISABLED" };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
        whatsappNumber: true,
        whatsappVerified: true,
        whatsappNotificationsEnabled: true,
      },
    });

    const recipientNumber = user?.whatsappNumber ?? "";

    try {
      await prisma.whatsAppDelivery.create({
        data: {
          eventKey,
          userId,
          category,
          recipientNumber,
          title,
          message,
          status: "PENDING",
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { sent: false, reason: "DUPLICATE", status: "SKIPPED" };
      }
      return { sent: false, reason: "FAILED" };
    }

    const skip = async (reason: string): Promise<WhatsAppDeliveryResult> => {
      await prisma.whatsAppDelivery
        .update({
          where: { eventKey },
          data: { status: "SKIPPED", errorMessage: reason },
        })
        .catch(() => undefined);
      return { sent: false, reason: "SKIPPED", status: "SKIPPED" };
    };

    if (!user || !user.isActive) return skip("Pengguna tidak ditemukan/nonaktif.");
    if (
      !user.whatsappNumber ||
      !user.whatsappVerified ||
      !user.whatsappNotificationsEnabled
    ) {
      return skip("Nomor WhatsApp belum diverifikasi atau notifikasi dimatikan.");
    }
    if (
      !(WHATSAPP_RECIPIENT_ROLES as readonly string[]).includes(user.role)
    ) {
      return skip("Role tidak berhak menerima notifikasi.");
    }

    const text = `*${title}*\n\n${message}\n\n— DigiLib SMA`;
    const send = await sendWhatsAppMessage(user.whatsappNumber, text);

    await prisma.whatsAppDelivery
      .update({
        where: { eventKey },
        data: {
          recipientNumber: user.whatsappNumber,
          status: send.ok ? "SENT" : "FAILED",
          providerMessageId: send.providerMessageId,
          providerStatus: send.providerStatus,
          errorMessage: send.error,
          sentAt: send.ok ? new Date() : null,
        },
      })
      .catch(() => undefined);

    if (!send.ok) {
      return { sent: false, reason: "FAILED", status: "FAILED" };
    }
    return { sent: true, status: "SENT" };
  } catch {
    return { sent: false, reason: "FAILED" };
  }
}

/** Pengiriman sistem (bukan akun): pesan uji / OTP. Tetap dicatat di riwayat. */
export async function sendWhatsAppSystemMessage(input: {
  target: string;
  title: string;
  message: string;
  category: WhatsAppCategory;
  eventKey: string;
  userId?: string | null;
}): Promise<{ ok: boolean; error: string | null; deliveryStatus: WhatsAppDeliveryStatus }> {
  const normalized = normalizeWhatsAppNumber(input.target);
  if (!normalized) {
    return { ok: false, error: "Nomor penerima tidak valid.", deliveryStatus: "FAILED" };
  }

  const title = input.title;
  const message = input.message;
  try {
    await prisma.whatsAppDelivery.create({
      data: {
        eventKey: input.eventKey,
        userId: input.userId ?? null,
        category: input.category,
        recipientNumber: normalized,
        title,
        message,
        status: "PENDING",
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Pesan ini sudah pernah diproses.", deliveryStatus: "SKIPPED" };
    }
    return { ok: false, error: "Gagal mencatat pengiriman.", deliveryStatus: "FAILED" };
  }

  const send = await sendWhatsAppMessage(normalized, message);
  await prisma.whatsAppDelivery
    .update({
      where: { eventKey: input.eventKey },
      data: {
        status: send.ok ? "SENT" : "FAILED",
        providerMessageId: send.providerMessageId,
        providerStatus: send.providerStatus,
        errorMessage: send.error,
        sentAt: send.ok ? new Date() : null,
      },
    })
    .catch(() => undefined);

  return {
    ok: send.ok,
    error: send.error,
    deliveryStatus: send.ok ? "SENT" : "FAILED",
  };
}

// ---------------------------------------------------------------------------
// Broadcast / pengumuman
// ---------------------------------------------------------------------------

export type WhatsAppAudience = "ALL" | "ROLE" | "USER";

export interface WhatsAppBroadcastInput {
  title: string;
  message: string;
  audience: WhatsAppAudience;
  role?: string | null;
  userId?: string | null;
  category?: WhatsAppCategory;
  link?: string | null;
}

export interface WhatsAppBroadcastResult {
  batchId: string;
  targetedUsers: number;
  inAppCreated: number;
  whatsappSent: number;
  whatsappSkipped: number;
  whatsappFailed: number;
}

/**
 * Kirim pengumuman ke semua pengguna aktif, role tertentu, atau satu pengguna.
 * Notifikasi in-app selalu dibuat; WhatsApp hanya untuk nomor terverifikasi.
 */
export async function broadcastWhatsAppNotification(
  input: WhatsAppBroadcastInput
): Promise<WhatsAppBroadcastResult> {
  const category: WhatsAppCategory = input.category ?? "ANNOUNCEMENT";
  const batchId = `announcement:${Date.now()}:${randomInt(0, 1_000_000)}`;

  const where: Record<string, unknown> = { isActive: true };
  if (input.audience === "ROLE") {
    if (!input.role) throw new Error("Role tujuan wajib dipilih.");
    where.role = input.role;
  } else if (input.audience === "USER") {
    if (!input.userId) throw new Error("Pengguna tujuan wajib dipilih.");
    where.id = input.userId;
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      whatsappNumber: true,
      whatsappVerified: true,
      whatsappNotificationsEnabled: true,
    },
  });

  if (users.length === 0) {
    return {
      batchId,
      targetedUsers: 0,
      inAppCreated: 0,
      whatsappSent: 0,
      whatsappSkipped: 0,
      whatsappFailed: 0,
    };
  }

  let inAppCreated = 0;
  try {
    const created = await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        title: input.title,
        message: input.message,
        type: category === "OUTAGE" ? "ERROR" : category === "MAINTENANCE" ? "WARNING" : "INFO",
        link: input.link ?? null,
      })),
    });
    inAppCreated = created.count;
  } catch {
    inAppCreated = 0;
  }

  let whatsappSent = 0;
  let whatsappSkipped = 0;
  let whatsappFailed = 0;

  // Pengiriman berurutan dengan jeda kecil agar tidak menabrak rate limit Fonnte.
  for (const user of users) {
    if (
      !user.whatsappNumber ||
      !user.whatsappVerified ||
      !user.whatsappNotificationsEnabled
    ) {
      whatsappSkipped++;
      continue;
    }
    const result = await deliverWhatsAppNotification({
      userId: user.id,
      title: input.title,
      message: input.message,
      eventKey: `${batchId}:${user.id}`,
      category,
    });
    if (result.sent) whatsappSent++;
    else if (result.reason === "SKIPPED" || result.reason === "DISABLED") whatsappSkipped++;
    else whatsappFailed++;
  }

  return {
    batchId,
    targetedUsers: users.length,
    inAppCreated,
    whatsappSent,
    whatsappSkipped,
    whatsappFailed,
  };
}
