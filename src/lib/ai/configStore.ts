/**
 * Penyimpanan konfigurasi AI (server-only).
 *
 * Tabel `Setting` yang sudah ada dipakai agar tidak perlu migrasi destruktif.
 * Konfigurasi PUBLIK dan SECRET dipisahkan pada key berbeda:
 *
 *   ai.config.draft   → JSON provider/model/fallback/parameter (tanpa API key)
 *   ai.secret.draft   → envelope AES-256-GCM API key draft
 *   ai.config.active  → JSON konfigurasi yang sedang dipakai runtime
 *   ai.secret.active  → envelope AES-256-GCM API key aktif
 *   ai.test.last      → metadata hasil uji koneksi terakhir (tanpa secret)
 *
 * API key TIDAK PERNAH diserialisasi ke UI. `getPublicConfigState()` hanya
 * mengembalikan status boolean "hasApiKey".
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  SecretEncryptionError,
  decryptSecret,
  encryptSecret,
  getEncryptionKeyState,
} from "@/lib/ai/configCrypto";
import {
  AI_PROVIDERS,
  type AIProviderId,
  type RuntimeAIProviderId,
  getAIProviderDefinition,
  isAIProviderId,
  resolveEnvProvider,
} from "@/lib/ai/providers";

export const AI_CONFIG_KEYS = {
  CONFIG_DRAFT: "ai.config.draft",
  SECRET_DRAFT: "ai.secret.draft",
  CONFIG_ACTIVE: "ai.config.active",
  SECRET_ACTIVE: "ai.secret.active",
  TEST_LAST: "ai.test.last",
} as const;

export interface AIConfigValues {
  provider: AIProviderId;
  model: string;
  fallbackModels: string[];
  disableThinking: boolean;
  /** Selalu endpoint tetap dari katalog provider (tidak dapat diubah UI). */
  baseUrl: string;
}

export interface StoredAIConfig extends AIConfigValues {
  updatedAt: string;
  updatedBy: string | null;
  activatedAt?: string;
}

export interface PublicAIConfig extends AIConfigValues {
  updatedAt: string;
  updatedBy: string | null;
  activatedAt?: string;
  hasApiKey: boolean;
  apiKeyValid: boolean;
}

export type AITestCategory =
  | "SUCCESS"
  | "AUTH"
  | "MODEL"
  | "RATE_LIMIT"
  | "QUOTA"
  | "NETWORK"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "INVALID_REQUEST"
  | "INVALID_CONFIG"
  | "UNKNOWN";

export interface AITestResult {
  ok: boolean;
  category: AITestCategory;
  message: string;
  at: string;
  provider: AIProviderId | null;
  model: string | null;
  latencyMs: number | null;
  httpStatus: number | null;
  testedBy: string | null;
  configFingerprint: string | null;
}

export interface RuntimeAIConfigBase {
  provider: RuntimeAIProviderId;
  model: string;
  fallbackModels: string[];
  baseUrl: string;
  disableThinking: boolean;
}

export type RuntimeAIConfig =
  | (RuntimeAIConfigBase & {
      status: "active";
      source: "DATABASE";
      apiKey: string;
      config: StoredAIConfig;
    })
  | (RuntimeAIConfigBase & {
      status: "env";
      source: "ENV";
      apiKey: string;
    })
  | { status: "none" }
  | { status: "invalid"; error: string };

export class AIConfigurationError extends Error {
  readonly code: string;

  constructor(message: string, code = "AI_CONFIG_ERROR") {
    super(message);
    this.name = "AIConfigurationError";
    this.code = code;
    Object.setPrototypeOf(this, AIConfigurationError.prototype);
  }
}

export class AIConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigValidationError";
    Object.setPrototypeOf(this, AIConfigValidationError.prototype);
  }
}

export class AIDraftChangedError extends Error {
  constructor() {
    super(
      "Draft konfigurasi berubah saat proses aktivasi. Muat ulang halaman lalu uji dan aktifkan kembali."
    );
    this.name = "AIDraftChangedError";
    Object.setPrototypeOf(this, AIDraftChangedError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Validasi
// ---------------------------------------------------------------------------

const MAX_MODEL_LENGTH = 200;
const MAX_FALLBACK_MODELS = 5;

function normalizeModelName(value: unknown, provider: AIProviderId): string | null {
  if (typeof value !== "string") return null;
  let model = value.trim();
  if (!model || model.length > MAX_MODEL_LENGTH) return null;
  // Nama model tidak boleh memuat baris baru/karakter kontrol.
  if (/[\u0000-\u001f\u007f]/.test(model)) return null;
  if (provider === "GEMINI" && model.startsWith("models/")) {
    model = model.slice("models/".length);
  }
  return model;
}

export interface AIConfigValidationResult {
  ok: boolean;
  error?: string;
  values?: AIConfigValues;
}

/**
 * Validasi input publik. Base URL TIDAK diterima dari pengguna: nilainya selalu
 * diturunkan dari katalog provider untuk mencegah SSRF.
 */
export function validateAIConfigInput(input: unknown): AIConfigValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Konfigurasi tidak valid." };
  }
  const raw = input as Record<string, unknown>;

  if (!isAIProviderId(raw.provider)) {
    return { ok: false, error: "Provider AI tidak dikenal." };
  }
  const provider = raw.provider;
  const definition = getAIProviderDefinition(provider);

  const model = normalizeModelName(raw.model, provider);
  if (!model) {
    return {
      ok: false,
      error: `Model utama wajib diisi (maksimal ${MAX_MODEL_LENGTH} karakter, tanpa baris baru).`,
    };
  }

  let fallbackRaw: unknown = raw.fallbackModels;
  if (typeof fallbackRaw === "string") {
    fallbackRaw = fallbackRaw.split(",");
  }
  if (fallbackRaw === undefined || fallbackRaw === null) {
    fallbackRaw = [];
  }
  if (!Array.isArray(fallbackRaw)) {
    return { ok: false, error: "Daftar model fallback tidak valid." };
  }
  if (fallbackRaw.length > MAX_FALLBACK_MODELS) {
    return {
      ok: false,
      error: `Model fallback maksimal ${MAX_FALLBACK_MODELS} buah.`,
    };
  }

  const fallbackModels: string[] = [];
  for (const item of fallbackRaw) {
    if (typeof item !== "string") continue;
    if (item.trim() === "") continue;
    const normalized = normalizeModelName(item, provider);
    if (!normalized) {
      return {
        ok: false,
        error: "Nama model fallback tidak valid (kosong/terlalu panjang/berisi karakter kontrol).",
      };
    }
    if (normalized === model) continue;
    if (!fallbackModels.includes(normalized)) fallbackModels.push(normalized);
  }

  const disableThinking =
    provider === "NVIDIA" ? raw.disableThinking !== false : false;

  return {
    ok: true,
    values: {
      provider,
      model,
      fallbackModels,
      disableThinking,
      baseUrl: definition.baseUrl,
    },
  };
}

export function fingerprintAIConfig(values: AIConfigValues): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: values.provider,
        model: values.model,
        fallbackModels: values.fallbackModels,
        disableThinking: values.disableThinking,
      })
    )
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Pembacaan mentah
// ---------------------------------------------------------------------------

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

/** API key .env hanya boleh dipakai bila provider .env sama dengan provider target. */
function readEnvApiKeyForProvider(provider: AIProviderId): string | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  const envProvider = resolveEnvProvider(
    process.env.AI_PROVIDER,
    process.env.AI_BASE_URL
  );
  return envProvider.id === provider ? apiKey : null;
}

function encryptDraftSecret(plaintext: string): string {
  try {
    return encryptSecret(plaintext);
  } catch (error) {
    if (error instanceof SecretEncryptionError) {
      throw new AIConfigurationError(error.message, "AI_ENCRYPTION_UNAVAILABLE");
    }
    throw error;
  }
}

function parseStoredConfig(raw: string | null): StoredAIConfig | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const validation = validateAIConfigInput(parsed);
  if (!validation.ok || !validation.values) return null;

  const record = parsed as Record<string, unknown>;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt
      ? record.updatedAt
      : new Date(0).toISOString();
  const updatedBy =
    typeof record.updatedBy === "string" && record.updatedBy ? record.updatedBy : null;
  const activatedAt =
    typeof record.activatedAt === "string" && record.activatedAt
      ? record.activatedAt
      : undefined;

  return { ...validation.values, updatedAt, updatedBy, activatedAt };
}

function serializeConfig(config: StoredAIConfig): string {
  return JSON.stringify(config);
}

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

export interface SecretState {
  present: boolean;
  valid: boolean;
  reason?: string;
}

function inspectSecret(raw: string | null): SecretState {
  if (!raw) return { present: false, valid: false };
  const keyState = getEncryptionKeyState();
  if (!keyState.available) {
    return { present: true, valid: false, reason: keyState.reason };
  }
  const decrypted = decryptSecret(raw);
  if (decrypted === null) {
    return {
      present: true,
      valid: false,
      reason:
        "API key tersimpan tidak dapat didekripsi. Kunci enkripsi server mungkin berubah.",
    };
  }
  return { present: true, valid: true };
}

async function readSecretPlaintext(key: string): Promise<string | null> {
  const raw = await readSetting(key);
  if (!raw) return null;
  const keyState = getEncryptionKeyState();
  if (!keyState.available) {
    throw new AIConfigurationError(keyState.reason, "AI_ENCRYPTION_UNAVAILABLE");
  }
  const plaintext = decryptSecret(raw);
  if (plaintext === null) {
    throw new AIConfigurationError(
      "API key tersimpan tidak dapat didekripsi. Kunci enkripsi server mungkin berubah.",
      "AI_SECRET_UNDECRYPTABLE"
    );
  }
  return plaintext;
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export async function readDraftConfig(): Promise<StoredAIConfig | null> {
  return parseStoredConfig(await readSetting(AI_CONFIG_KEYS.CONFIG_DRAFT));
}

export async function readActiveConfig(): Promise<StoredAIConfig | null> {
  return parseStoredConfig(await readSetting(AI_CONFIG_KEYS.CONFIG_ACTIVE));
}

export interface SaveDraftOptions {
  updatedBy: string | null;
}

export interface SaveDraftInput extends Record<string, unknown> {
  provider?: unknown;
  model?: unknown;
  fallbackModels?: unknown;
  disableThinking?: unknown;
  apiKey?: unknown;
  clearApiKey?: unknown;
}

/**
 * Simpan draft. API key lama pada DRAFT dipertahankan bila field apiKey kosong
 * dan provider tidak berubah. API key AKTIF tidak pernah disentuh di sini.
 */
export async function saveDraftConfig(
  input: SaveDraftInput,
  options: SaveDraftOptions
): Promise<PublicAIConfig> {
  const validation = validateAIConfigInput(input);
  if (!validation.ok || !validation.values) {
    throw new AIConfigValidationError(
      validation.error || "Konfigurasi tidak valid."
    );
  }
  const values = validation.values;

  const clearApiKey = input.clearApiKey === true;
  const newApiKey =
    typeof input.apiKey === "string" && input.apiKey.trim().length > 0
      ? input.apiKey.trim()
      : null;

  if (clearApiKey && newApiKey) {
    throw new AIConfigValidationError(
      "Tidak dapat menghapus dan mengganti API key pada saat yang sama."
    );
  }

  const existingDraft = await readDraftConfig();
  const existingDraftSecretRaw = await readSetting(AI_CONFIG_KEYS.SECRET_DRAFT);
  const active = await readActiveConfig();
  const activeSecretRaw = await readSetting(AI_CONFIG_KEYS.SECRET_ACTIVE);

  let nextSecretRaw: string | null = existingDraftSecretRaw;
  let secretChanged = false;

  if (clearApiKey) {
    nextSecretRaw = null;
    secretChanged = existingDraftSecretRaw !== null;
  } else if (newApiKey) {
    if (newApiKey.length > 4096) {
      throw new AIConfigValidationError("API key terlalu panjang.");
    }
    nextSecretRaw = encryptDraftSecret(newApiKey);
    secretChanged = true;
  } else {
    // Provider berubah → JANGAN memakai ulang API key draft provider lama.
    if (existingDraft && existingDraft.provider !== values.provider) {
      nextSecretRaw = null;
      secretChanged = existingDraftSecretRaw !== null;
    }
    // Bila provider baru sama dengan provider aktif, key aktif boleh dipakai
    // sebagai draft key (tanpa menyalin plaintext ke mana pun).
    if (!nextSecretRaw && active && active.provider === values.provider && activeSecretRaw) {
      nextSecretRaw = activeSecretRaw;
      secretChanged = true;
    }
    // Adopsi API key .env server (provider sama) agar aktivasi pertama tidak
    // memaksa Admin mengetik ulang secret yang sudah ada. Tetap dienkripsi dan
    // tidak pernah dikirim ke browser.
    if (!nextSecretRaw) {
      const envKey = readEnvApiKeyForProvider(values.provider);
      if (envKey) {
        nextSecretRaw = encryptDraftSecret(envKey);
        secretChanged = true;
      }
    }
  }

  const now = new Date().toISOString();
  const stored: StoredAIConfig = {
    ...values,
    updatedAt: now,
    updatedBy: options.updatedBy,
  };

  const previousFingerprint = existingDraft
    ? fingerprintAIConfig(existingDraft)
    : null;
  const nextFingerprint = fingerprintAIConfig(values);

  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key: AI_CONFIG_KEYS.CONFIG_DRAFT },
      update: { value: serializeConfig(stored) },
      create: { key: AI_CONFIG_KEYS.CONFIG_DRAFT, value: serializeConfig(stored) },
    });

    if (nextSecretRaw) {
      await tx.setting.upsert({
        where: { key: AI_CONFIG_KEYS.SECRET_DRAFT },
        update: { value: nextSecretRaw },
        create: { key: AI_CONFIG_KEYS.SECRET_DRAFT, value: nextSecretRaw },
      });
    } else {
      await tx.setting.deleteMany({ where: { key: AI_CONFIG_KEYS.SECRET_DRAFT } });
    }

    if (secretChanged || previousFingerprint !== nextFingerprint) {
      await tx.setting.deleteMany({ where: { key: AI_CONFIG_KEYS.TEST_LAST } });
    }
  });

  return toPublicConfig(stored, nextSecretRaw);
}

function toPublicConfig(
  config: StoredAIConfig,
  secretRaw: string | null
): PublicAIConfig {
  const secret = inspectSecret(secretRaw);
  return {
    ...config,
    hasApiKey: secret.present,
    apiKeyValid: secret.valid,
  };
}

export interface DraftRuntimeConfig {
  config: StoredAIConfig;
  /** API key plaintext hanya hidup di memori selama request. */
  apiKey: string | null;
  rawConfig: string | null;
  secretRaw: string | null;
}

export async function readDraftRuntimeConfig(): Promise<DraftRuntimeConfig | null> {
  const rawConfig = await readSetting(AI_CONFIG_KEYS.CONFIG_DRAFT);
  const config = parseStoredConfig(rawConfig);
  if (!config) return null;

  const secretRaw = await readSetting(AI_CONFIG_KEYS.SECRET_DRAFT);
  let apiKey: string | null = null;
  if (secretRaw) {
    const keyState = getEncryptionKeyState();
    if (!keyState.available) {
      throw new AIConfigurationError(keyState.reason, "AI_ENCRYPTION_UNAVAILABLE");
    }
    apiKey = decryptSecret(secretRaw);
    if (apiKey === null) {
      throw new AIConfigurationError(
        "API key draft tidak dapat didekripsi. Simpan ulang API key.",
        "AI_SECRET_UNDECRYPTABLE"
      );
    }
  }

  return { config, apiKey, rawConfig, secretRaw };
}

/** Ambil API key draft bila ada; null berarti belum disimpan. */
export async function readDraftApiKey(): Promise<string | null> {
  return readSecretPlaintext(AI_CONFIG_KEYS.SECRET_DRAFT);
}

/**
 * API key aktif hanya boleh dipakai ulang bila provider yang diuji sama.
 * Mencegah key provider lama dipakai untuk provider baru.
 */
export async function readActiveApiKeyForProvider(
  provider: AIProviderId
): Promise<string | null> {
  const active = await readActiveConfig();
  if (!active || active.provider !== provider) return null;
  return readSecretPlaintext(AI_CONFIG_KEYS.SECRET_ACTIVE);
}

/** Hapus API key DRAFT saja. Konfigurasi aktif tidak berubah. */
export async function clearDraftApiKey(): Promise<void> {
  await deleteSetting(AI_CONFIG_KEYS.SECRET_DRAFT);
  await deleteSetting(AI_CONFIG_KEYS.TEST_LAST);
}

/** Buang draft dan API key draft. Konfigurasi aktif tidak berubah. */
export async function discardDraft(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.setting.deleteMany({
      where: {
        key: { in: [AI_CONFIG_KEYS.CONFIG_DRAFT, AI_CONFIG_KEYS.SECRET_DRAFT, AI_CONFIG_KEYS.TEST_LAST] },
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Test metadata
// ---------------------------------------------------------------------------

export async function recordTestResult(result: AITestResult): Promise<void> {
  // Hanya metadata aman yang disimpan: tidak ada API key/ciphertext/prompt.
  await writeSetting(AI_CONFIG_KEYS.TEST_LAST, JSON.stringify(result));
}

export async function readLastTestResult(): Promise<AITestResult | null> {
  const raw = await readSetting(AI_CONFIG_KEYS.TEST_LAST);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AITestResult>;
    if (typeof parsed.ok !== "boolean" || typeof parsed.message !== "string") {
      return null;
    }
    return {
      ok: parsed.ok,
      category: (parsed.category as AITestCategory) ?? "UNKNOWN",
      message: parsed.message,
      at: typeof parsed.at === "string" ? parsed.at : new Date(0).toISOString(),
      provider: isAIProviderId(parsed.provider) ? parsed.provider : null,
      model: typeof parsed.model === "string" ? parsed.model : null,
      latencyMs: typeof parsed.latencyMs === "number" ? parsed.latencyMs : null,
      httpStatus: typeof parsed.httpStatus === "number" ? parsed.httpStatus : null,
      testedBy: typeof parsed.testedBy === "string" ? parsed.testedBy : null,
      configFingerprint:
        typeof parsed.configFingerprint === "string" ? parsed.configFingerprint : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Aktivasi atomik
// ---------------------------------------------------------------------------

export interface ActivateDraftOptions {
  updatedBy: string | null;
  expectedRawConfig: string;
  /** Snapshot secret draft saat pengujian; mencegah aktivasi key yang belum diuji. */
  expectedSecretRaw?: string | null;
}

/**
 * Salin draft yang SUDAH diuji ke konfigurasi aktif dalam satu transaksi.
 * Bila draft berubah sejak pengujian, aktivasi dibatalkan (tidak ada
 * konfigurasi setengah jadi).
 */
export async function commitDraftAsActive(
  options: ActivateDraftOptions
): Promise<StoredAIConfig> {
  return prisma.$transaction(async (tx) => {
    const currentRaw = (
      await tx.setting.findUnique({ where: { key: AI_CONFIG_KEYS.CONFIG_DRAFT } })
    )?.value ?? null;

    if (!currentRaw || currentRaw !== options.expectedRawConfig) {
      throw new AIDraftChangedError();
    }
    const draft = parseStoredConfig(currentRaw);
    if (!draft) {
      throw new AIConfigValidationError("Draft konfigurasi tidak valid.");
    }

    const secretRaw = (
      await tx.setting.findUnique({ where: { key: AI_CONFIG_KEYS.SECRET_DRAFT } })
    )?.value ?? null;
    if (!secretRaw) {
      throw new AIConfigValidationError(
        "API key belum tersimpan pada draft. Masukkan API key lalu simpan."
      );
    }
    if (
      options.expectedSecretRaw !== undefined &&
      secretRaw !== options.expectedSecretRaw
    ) {
      throw new AIDraftChangedError();
    }

    // Pastikan secret dapat didekripsi SEBELUM ditulis sebagai aktif.
    const keyState = getEncryptionKeyState();
    if (!keyState.available) {
      throw new AIConfigurationError(keyState.reason, "AI_ENCRYPTION_UNAVAILABLE");
    }
    if (decryptSecret(secretRaw) === null) {
      throw new AIConfigurationError(
        "API key draft tidak dapat didekripsi. Simpan ulang API key.",
        "AI_SECRET_UNDECRYPTABLE"
      );
    }

    const now = new Date().toISOString();
    const active: StoredAIConfig = {
      ...draft,
      updatedAt: now,
      updatedBy: options.updatedBy,
      activatedAt: now,
    };

    await tx.setting.upsert({
      where: { key: AI_CONFIG_KEYS.CONFIG_ACTIVE },
      update: { value: serializeConfig(active) },
      create: { key: AI_CONFIG_KEYS.CONFIG_ACTIVE, value: serializeConfig(active) },
    });
    await tx.setting.upsert({
      where: { key: AI_CONFIG_KEYS.SECRET_ACTIVE },
      update: { value: secretRaw },
      create: { key: AI_CONFIG_KEYS.SECRET_ACTIVE, value: secretRaw },
    });

    return active;
  });
}

/** Hapus konfigurasi aktif; runtime kembali ke fallback .env. */
export async function deactivateActiveConfig(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.setting.deleteMany({
      where: { key: { in: [AI_CONFIG_KEYS.CONFIG_ACTIVE, AI_CONFIG_KEYS.SECRET_ACTIVE] } },
    });
  });
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

function envConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY && process.env.AI_API_KEY.trim().length > 0);
}

export function readEnvRuntime(): RuntimeAIConfig {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return { status: "none" };

  const provider = resolveEnvProvider(process.env.AI_PROVIDER, process.env.AI_BASE_URL);
  const model = (process.env.AI_MODEL || "gpt-3.5-turbo").trim();
  const fallbackModels = (process.env.AI_FALLBACK_MODELS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== model);
  const disableThinking = process.env.AI_DISABLE_THINKING !== "false";

  return {
    status: "env",
    source: "ENV",
    apiKey,
    provider: provider.id,
    model,
    fallbackModels,
    baseUrl: provider.baseUrl,
    disableThinking,
  };
}

/**
 * Resolusi konfigurasi runtime SETIAP REQUEST (tanpa cache in-memory).
 *
 * Prioritas:
 * 1. Konfigurasi aktif di database.
 * 2. Fallback .env bila TIDAK ADA konfigurasi aktif.
 *
 * Bila konfigurasi aktif ada tetapi rusak/tidak dapat didekripsi, runtime TIDAK
 * diam-diam beralih ke .env/provider lain — statusnya "invalid" agar Admin
 * memperbaikinya secara sadar.
 */
export async function getRuntimeAIConfig(): Promise<RuntimeAIConfig> {
  let activeRaw: string | null;
  try {
    activeRaw = await readSetting(AI_CONFIG_KEYS.CONFIG_ACTIVE);
  } catch {
    // Tidak dapat memastikan apakah ada konfigurasi aktif → jangan diam-diam
    // memakai .env. Status invalid agar Admin menyadari masalah database.
    return {
      status: "invalid",
      error:
        "Konfigurasi AI tidak dapat dibaca dari database. Periksa koneksi database lalu muat ulang Konfigurasi AI.",
    };
  }

  if (!activeRaw) return readEnvRuntime();

  const config = parseStoredConfig(activeRaw);
  if (!config) {
    return {
      status: "invalid",
      error:
        "Konfigurasi AI aktif di database tidak valid. Buka menu Konfigurasi AI dan simpan ulang.",
    };
  }

  let secretRaw: string | null;
  try {
    secretRaw = await readSetting(AI_CONFIG_KEYS.SECRET_ACTIVE);
  } catch {
    return {
      status: "invalid",
      error: "Konfigurasi AI aktif tidak dapat dibaca dari database.",
    };
  }
  if (!secretRaw) {
    return {
      status: "invalid",
      error:
        "Konfigurasi AI aktif tidak memiliki API key tersimpan. Buka menu Konfigurasi AI.",
    };
  }

  const keyState = getEncryptionKeyState();
  if (!keyState.available) {
    return { status: "invalid", error: keyState.reason };
  }
  const apiKey = decryptSecret(secretRaw);
  if (apiKey === null) {
    return {
      status: "invalid",
      error:
        "API key konfigurasi aktif tidak dapat didekripsi. Kunci enkripsi server mungkin berubah.",
    };
  }

  const definition = getAIProviderDefinition(config.provider);
  return {
    status: "active",
    source: "DATABASE",
    apiKey,
    provider: config.provider,
    model: config.model,
    fallbackModels: config.fallbackModels,
    baseUrl: definition.baseUrl,
    disableThinking: config.disableThinking,
    config,
  };
}

// ---------------------------------------------------------------------------
// Status publik (aman untuk UI)
// ---------------------------------------------------------------------------

export interface AIPublicDiagnostics {
  runtimeSource: AIPublicState["source"];
  draft: {
    present: boolean;
    secretPresent: boolean;
    secretValid: boolean;
    testedSuccessfully: boolean;
    changedSinceTest: boolean;
  };
  active: {
    present: boolean;
    secretPresent: boolean;
    secretValid: boolean;
  };
  encryption: {
    source: "AI_CONFIG_ENCRYPTION_KEY" | "NEXTAUTH_SECRET" | null;
    fallbackInUse: boolean;
  };
  env: {
    configured: boolean;
    keyAvailableForDraftProvider: boolean;
    providerMatchesDraft: boolean;
  };
  lastTest: {
    ok: boolean;
    category: AITestCategory;
    at: string;
  } | null;
  nextAction: {
    code:
      | "NONE"
      | "SAVE_DRAFT"
      | "PROVIDE_KEY"
      | "FIX_KEY"
      | "TEST_DRAFT"
      | "RETRY_TEST"
      | "ACTIVATE_DRAFT"
      | "FIX_ACTIVE";
    message: string;
  };
}

export interface AIPublicState {
  configured: boolean;
  source: "DATABASE" | "ENV" | "NONE" | "INVALID";
  effective: {
    provider: RuntimeAIProviderId | null;
    providerLabel: string | null;
    model: string | null;
    fallbackModels: string[];
    baseUrl: string | null;
    disableThinking: boolean;
  };
  active: PublicAIConfig | null;
  draft: PublicAIConfig | null;
  env: {
    configured: boolean;
    provider: RuntimeAIProviderId;
    providerLabel: string;
    model: string;
    baseUrl: string;
    disableThinking: boolean;
  };
  lastTest: AITestResult | null;
  diagnostics: AIPublicDiagnostics;
  encryption: {
    available: boolean;
    source: "AI_CONFIG_ENCRYPTION_KEY" | "NEXTAUTH_SECRET" | null;
    message: string | null;
  };
  message: string | null;
  providers: typeof AI_PROVIDERS;
}

function draftTestMatches(
  draft: PublicAIConfig | null,
  lastTest: AITestResult | null
): boolean {
  if (!draft || !lastTest || !lastTest.configFingerprint) return false;
  return lastTest.configFingerprint === fingerprintAIConfig(draft);
}

function buildPublicDiagnostics(args: {
  source: AIPublicState["source"];
  activeRawPresent: boolean;
  active: PublicAIConfig | null;
  activeSecretPresent: boolean;
  draft: PublicAIConfig | null;
  draftSecretPresent: boolean;
  lastTest: AITestResult | null;
  encryptionSource: "AI_CONFIG_ENCRYPTION_KEY" | "NEXTAUTH_SECRET" | null;
  envConfigured: boolean;
  envProviderMatchesDraft: boolean;
}): AIPublicDiagnostics {
  const testedSuccessfully = draftTestMatches(args.draft, args.lastTest) && args.lastTest?.ok === true;
  const changedSinceTest = Boolean(
    args.draft &&
      args.lastTest &&
      args.lastTest.configFingerprint &&
      args.lastTest.configFingerprint !== fingerprintAIConfig(args.draft)
  );

  let nextAction: AIPublicDiagnostics["nextAction"];
  if (args.activeRawPresent && !args.active) {
    nextAction = {
      code: "FIX_ACTIVE",
      message:
        "Konfigurasi aktif di database rusak. Simpan ulang konfigurasi aktif atau nonaktifkan agar runtime kembali ke .env.",
    };
  } else if (args.active && !args.active.apiKeyValid) {
    nextAction = {
      code: "FIX_ACTIVE",
      message:
        "API key konfigurasi aktif tidak dapat didekripsi. Masukkan ulang API key lalu uji dan aktifkan kembali.",
    };
  } else if (args.active) {
    nextAction = {
      code: "NONE",
      message:
        "Runtime memakai konfigurasi aktif dari database. Draft (bila ada) tidak memengaruhi runtime sampai diaktifkan.",
    };
  } else if (!args.draft) {
    nextAction = {
      code: "SAVE_DRAFT",
      message:
        "Belum ada draft. Pilih provider, isi model utama, lalu klik Simpan Konfigurasi. Runtime tetap memakai .env sampai aktivasi berhasil.",
    };
  } else if (!args.draft.hasApiKey) {
    nextAction = {
      code: "PROVIDE_KEY",
      message: args.envProviderMatchesDraft
        ? "Draft belum memiliki API key. AI_API_KEY pada .env cocok untuk provider ini dan akan diadopsi saat Simpan Konfigurasi; atau masukkan API key baru."
        : "Draft belum memiliki API key. Masukkan API key provider ini lalu simpan draft.",
    };
  } else if (!args.draft.apiKeyValid) {
    nextAction = {
      code: "FIX_KEY",
      message:
        "API key draft tidak dapat didekripsi (kunci enkripsi server mungkin berubah). Masukkan ulang API key lalu simpan draft.",
    };
  } else if (testedSuccessfully) {
    nextAction = {
      code: "ACTIVATE_DRAFT",
      message:
        "Draft sudah diuji berhasil. Klik Aktifkan Konfigurasi lalu konfirmasi Uji & Aktifkan. Server akan menguji ulang sebelum mengganti runtime.",
    };
  } else if (args.lastTest && !args.lastTest.ok && draftTestMatches(args.draft, args.lastTest)) {
    const category = args.lastTest.category;
    nextAction = {
      code: "RETRY_TEST",
      message:
        category === "TIMEOUT"
          ? "Uji koneksi gagal karena TIMEOUT, bukan bukti API key salah. Aktivasi ditolak dan runtime tetap memakai .env. Periksa koneksi server lalu klik Uji Koneksi lagi."
          : `Uji koneksi gagal (kategori ${category}). Aktivasi ditolak dan runtime tetap memakai .env. Perbaiki penyebabnya lalu klik Uji Koneksi lagi.`,
    };
  } else {
    nextAction = {
      code: "TEST_DRAFT",
      message: changedSinceTest
        ? "Draft berubah setelah uji terakhir. Klik Uji Koneksi untuk menguji konfigurasi yang sekarang, lalu aktifkan."
        : "Draft belum diuji. Klik Uji Koneksi; aktivasi hanya dapat dilakukan setelah uji koneksi berhasil.",
    };
  }

  return {
    runtimeSource: args.source,
    draft: {
      present: Boolean(args.draft),
      secretPresent: args.draftSecretPresent,
      secretValid: args.draft?.apiKeyValid ?? false,
      testedSuccessfully,
      changedSinceTest,
    },
    active: {
      present: Boolean(args.active),
      secretPresent: args.activeSecretPresent,
      secretValid: args.active?.apiKeyValid ?? false,
    },
    encryption: {
      source: args.encryptionSource,
      fallbackInUse: args.encryptionSource === "NEXTAUTH_SECRET",
    },
    env: {
      configured: args.envConfigured,
      keyAvailableForDraftProvider: Boolean(
        args.draft && args.envConfigured && args.envProviderMatchesDraft
      ),
      providerMatchesDraft: args.envProviderMatchesDraft,
    },
    lastTest: args.lastTest
      ? {
          ok: args.lastTest.ok,
          category: args.lastTest.category,
          at: args.lastTest.at,
        }
      : null,
    nextAction,
  };
}

export async function getPublicConfigState(): Promise<AIPublicState> {
  const [activeRaw, draftRaw, activeSecretRaw, draftSecretRaw, lastTest] =
    await Promise.all([
      readSetting(AI_CONFIG_KEYS.CONFIG_ACTIVE),
      readSetting(AI_CONFIG_KEYS.CONFIG_DRAFT),
      readSetting(AI_CONFIG_KEYS.SECRET_ACTIVE),
      readSetting(AI_CONFIG_KEYS.SECRET_DRAFT),
      readLastTestResult(),
    ]);

  const activeConfig = parseStoredConfig(activeRaw);
  const draftConfig = parseStoredConfig(draftRaw);
  const active = activeConfig
    ? toPublicConfig(activeConfig, activeSecretRaw)
    : null;
  const draft = draftConfig ? toPublicConfig(draftConfig, draftSecretRaw) : null;

  const envProvider = resolveEnvProvider(process.env.AI_PROVIDER, process.env.AI_BASE_URL);
  const env = {
    configured: envConfigured(),
    provider: envProvider.id,
    providerLabel: envProvider.label,
    model: (process.env.AI_MODEL || "gpt-3.5-turbo").trim(),
    baseUrl: envProvider.baseUrl,
    disableThinking: process.env.AI_DISABLE_THINKING !== "false",
  };

  const keyState = getEncryptionKeyState();
  const encryption = {
    available: keyState.available,
    source: keyState.available ? keyState.source : null,
    message: keyState.available ? null : keyState.reason,
  };

  let source: AIPublicState["source"] = "NONE";
  let message: string | null = null;
  let effective: AIPublicState["effective"] = {
    provider: null,
    providerLabel: null,
    model: null,
    fallbackModels: [],
    baseUrl: null,
    disableThinking: false,
  };

  if (activeRaw) {
    if (!active) {
      source = "INVALID";
      message =
        "Konfigurasi aktif di database rusak. Runtime tidak memakai .env selama konfigurasi aktif masih ada.";
    } else if (!active.apiKeyValid) {
      source = "INVALID";
      message =
        "API key konfigurasi aktif tidak dapat dibaca/didekripsi. Perbaiki melalui halaman Konfigurasi AI.";
    } else {
      source = "DATABASE";
      effective = {
        provider: active.provider,
        providerLabel: getAIProviderDefinition(active.provider).label,
        model: active.model,
        fallbackModels: active.fallbackModels,
        baseUrl: active.baseUrl,
        disableThinking: active.disableThinking,
      };
    }
  } else if (env.configured) {
    source = "ENV";
    effective = {
      provider: env.provider,
      providerLabel: env.providerLabel,
      model: env.model,
      fallbackModels: (process.env.AI_FALLBACK_MODELS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      baseUrl: env.baseUrl,
      disableThinking: env.disableThinking,
    };
    message =
      "Belum ada konfigurasi AI aktif di database. Runtime memakai konfigurasi .env.";
  } else {
    source = "NONE";
    message =
      "AI Assistant belum dikonfigurasi. Simpan dan aktifkan konfigurasi melalui halaman ini.";
  }

  const envProviderMatchesDraft = Boolean(draft && env.provider === draft.provider);
  const diagnostics = buildPublicDiagnostics({
    source,
    activeRawPresent: Boolean(activeRaw),
    active,
    activeSecretPresent: Boolean(activeSecretRaw),
    draft,
    draftSecretPresent: Boolean(draftSecretRaw),
    lastTest,
    encryptionSource: keyState.available ? keyState.source : null,
    envConfigured: env.configured,
    envProviderMatchesDraft,
  });

  return {
    configured: source === "DATABASE" || source === "ENV",
    source,
    effective,
    active,
    draft,
    env,
    lastTest,
    diagnostics,
    encryption,
    message,
    providers: AI_PROVIDERS,
  };
}
