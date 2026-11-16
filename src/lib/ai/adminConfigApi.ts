/**
 * Bantuan internal endpoint Konfigurasi AI (server-only).
 * Tidak pernah mengembalikan API key ke pemanggil HTTP.
 */

import { prisma } from "@/lib/prisma";
import {
  AIConfigValidationError,
  AIConfigurationError,
  readActiveApiKeyForProvider,
  readDraftApiKey,
  readDraftConfig,
  type AIConfigValues,
} from "@/lib/ai/configStore";
import {
  resolveEnvProvider,
  type AIProviderId,
} from "@/lib/ai/providers";

export type ApiKeySource = "REQUEST" | "DRAFT" | "ACTIVE" | "ENV";

export interface ResolvedApiKey {
  apiKey: string;
  source: ApiKeySource;
}

/**
 * Prefix API key yang secara publik dan konsisten dipakai provider. Tujuannya
 * bukan menebak provider dari key sembarang, melainkan menolak kasus yang jelas
 * salah (mis. key NVIDIA `nvapi-` dimasukkan untuk Gemini). Key dengan format
 * baru/tidak dikenal tetap diizinkan dan diuji ke provider yang dipilih.
 */
const PROVIDER_KEY_PREFIXES: Array<{ provider: AIProviderId; prefix: string }> = [
  { provider: "NVIDIA", prefix: "nvapi-" },
  { provider: "GROQ", prefix: "gsk_" },
  { provider: "OPENROUTER", prefix: "sk-or-" },
  { provider: "GEMINI", prefix: "AIza" },
];

export function detectProviderKeyMismatch(
  provider: AIProviderId,
  apiKey: string
): AIProviderId | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  const match = PROVIDER_KEY_PREFIXES.find((item) =>
    trimmed.toLowerCase().startsWith(item.prefix.toLowerCase())
  );
  if (!match) return null;
  return match.provider === provider ? null : match.provider;
}

function assertKeyBelongsToProvider(provider: AIProviderId, apiKey: string): void {
  const owner = detectProviderKeyMismatch(provider, apiKey);
  if (owner) {
    throw new AIConfigValidationError(
      `API key yang dimasukkan tampaknya milik provider ${owner}, bukan ${provider}. Gunakan API key yang sesuai; key tidak dikirim ke provider.`
    );
  }
}

/**
 * Urutan pemilihan API key untuk uji/daftar model:
 * 1. API key yang dikirim pada body request (belum disimpan).
 * 2. API key DRAFT — hanya bila provider draft sama.
 * 3. API key AKTIF — hanya bila provider aktif sama.
 * 4. API key .env — hanya bila provider .env sama.
 *
 * Key provider lain TIDAK PERNAH dipakai sebagai fallback. Prefix yang jelas
 * milik provider lain juga ditolak sebelum request jaringan.
 */
export async function resolveApiKeyForConfig(
  values: AIConfigValues,
  providedApiKey: unknown
): Promise<ResolvedApiKey | null> {
  if (typeof providedApiKey === "string" && providedApiKey.trim().length > 0) {
    const apiKey = providedApiKey.trim();
    assertKeyBelongsToProvider(values.provider, apiKey);
    return { apiKey, source: "REQUEST" };
  }

  const draft = await readDraftConfig();
  if (draft && draft.provider === values.provider) {
    const key = await readDraftApiKey();
    if (key) {
      assertKeyBelongsToProvider(values.provider, key);
      return { apiKey: key, source: "DRAFT" };
    }
  }

  const activeKey = await readActiveApiKeyForProvider(values.provider);
  if (activeKey) {
    assertKeyBelongsToProvider(values.provider, activeKey);
    return { apiKey: activeKey, source: "ACTIVE" };
  }

  // 4. API key .env server — hanya bila provider .env sama. Dipakai untuk uji
  // pertama kali sebelum ada draft/aktif; tidak pernah dikirim ke browser.
  const envKey = process.env.AI_API_KEY?.trim();
  if (envKey) {
    const envProvider = resolveEnvProvider(
      process.env.AI_PROVIDER,
      process.env.AI_BASE_URL
    );
    if (envProvider.id === values.provider) {
      assertKeyBelongsToProvider(values.provider, envKey);
      return { apiKey: envKey, source: "ENV" };
    }
  }

  return null;
}

/** Catat audit tanpa secret. Kegagalan audit tidak membatalkan perubahan yang sah. */
export async function writeConfigAudit(
  actorId: string | null,
  action: string,
  details: string
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { action, userId: actorId, details },
    });
  } catch (error) {
    console.warn(
      "[AI] Gagal menulis audit konfigurasi:",
      error instanceof Error ? error.name : "Error"
    );
  }
}

export function isValidationError(error: unknown): error is AIConfigValidationError {
  return error instanceof AIConfigValidationError;
}

export function isConfigurationError(error: unknown): error is AIConfigurationError {
  return error instanceof AIConfigurationError;
}
