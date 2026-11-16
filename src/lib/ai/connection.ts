/**
 * Uji koneksi provider dan daftar model untuk halaman Konfigurasi AI.
 *
 * - Tidak pernah menjalankan tool aplikasi.
 * - Hanya mengirim prompt minimal ("ping") dengan token keluaran kecil.
 * - Tidak melakukan retry tanpa batas dan tidak memakai fallback model saat
 *   pengujian, agar hasil tidak menyesatkan.
 * - Pesan hasil tidak memuat API key, header, URL berisi kredensial, atau
 *   stack trace.
 */

import { AIProviderError, isAIProviderError } from "./types";
import { buildAIProvider } from "./index";
import { AIConfigurationError, type AIConfigValues, type AITestCategory } from "./configStore";
import { getAIProviderDefinition } from "./providers";
import { AI_CONNECTION_TEST_TIMEOUT_MS } from "./timeouts";

export interface ConnectionTestOutcome {
  ok: boolean;
  category: AITestCategory;
  message: string;
  latencyMs: number;
  httpStatus: number | null;
  provider: AIConfigValues["provider"];
  model: string;
}

const AUTH_SIGNAL =
  /api[_ -]?key|invalid.*key|credential|unauthenticated|unauthorized|permission[_ -]?denied|authentication/;
const QUOTA_SIGNAL =
  /quota|credit|billing|insufficient|payment[_ -]?required|exceeded your current quota|saldo|resource[_ -]?exhausted/;
const RATE_LIMIT_SIGNAL = /rate[_ -]?limit|too many requests|rate_limited/;
const MODEL_SIGNAL =
  /model[_ -]?not[_ -]?found|model not found|no endpoints found|model[_ -]?not[_ -]?available|does not exist|not found|not available|unknown model|invalid model/;
const INVALID_REQUEST_SIGNAL =
  /invalid[_ -]?request|invalid[_ -]?argument|bad[_ -]?request|unsupported|parameter|temperature|max_tokens|max_completion_tokens|function[_ -]?calling|tool/;
const TIMEOUT_SIGNAL = /deadline[_ -]?exceeded|timeout|timed out/;

function providerSignal(error: AIProviderError): string {
  return [
    error.providerCode,
    error.providerType,
    error.providerStatus,
    error.detail,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

/** Sinyal dari kode/status provider saja, tanpa detail bebas. */
function providerCodeSignal(error: AIProviderError): string {
  return [error.providerCode, error.providerType, error.providerStatus]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

/**
 * Klasifikasi error provider. Urutan penting: kode/status spesifik provider
 * dipakai lebih dulu, lalu status HTTP, baru pencocokan teks sebagai fallback.
 * Semua pesan aman untuk UI dan tidak memuat secret/detail mentah.
 */
function classifyProviderError(error: unknown): {
  category: AITestCategory;
  message: string;
  httpStatus: number | null;
} {
  if (error instanceof AIConfigurationError) {
    return {
      category: "INVALID_CONFIG",
      message: error.message,
      httpStatus: null,
    };
  }

  if (isAIProviderError(error)) {
    const status = error.upstreamStatus ?? null;
    const category = error.category;
    const signal = providerSignal(error);

    if (category === "timeout" || (status === 408) || TIMEOUT_SIGNAL.test(signal)) {
      return {
        category: "TIMEOUT",
        message:
          "Koneksi ke provider melebihi batas waktu. Timeout BUKAN bukti API key salah; periksa jaringan atau coba lagi.",
        httpStatus: status,
      };
    }
    if (category === "abort") {
      return {
        category: "TIMEOUT",
        message: "Permintaan dibatalkan sebelum provider merespons.",
        httpStatus: status,
      };
    }
    if (category === "blocked") {
      return {
        category: "INVALID_RESPONSE",
        message: "Permintaan atau jawaban diblokir oleh kebijakan keamanan provider.",
        httpStatus: status,
      };
    }

    // 402 selalu masalah kredit/kuota (OpenRouter juga memakai 402).
    if (status === 402) {
      return {
        category: "QUOTA",
        message: "Kuota atau kredit provider tidak mencukupi.",
        httpStatus: status,
      };
    }

    // 401/403 umumnya kredensial, tetapi sebagian provider memakai 403 untuk
    // kuota yang habis. Kode kuota yang eksplisit menang.
    if (status === 401 || status === 403) {
      if (QUOTA_SIGNAL.test(signal)) {
        return {
          category: "QUOTA",
          message: "Kuota atau kredit provider tidak mencukupi.",
          httpStatus: status,
        };
      }
      return {
        category: "AUTH",
        message: "API key ditolak provider. Periksa kembali API key untuk provider ini.",
        httpStatus: status,
      };
    }

    if (status === 404 || status === 410) {
      return {
        category: "MODEL",
        message:
          "Model tidak ditemukan atau tidak tersedia untuk akun/API key ini. Pilih model lain atau muat daftar model.",
        httpStatus: status,
      };
    }

    if (status === 429) {
      return {
        category: QUOTA_SIGNAL.test(signal) ? "QUOTA" : "RATE_LIMIT",
        message: QUOTA_SIGNAL.test(signal)
          ? "Kuota atau kredit provider tidak mencukupi."
          : "Permintaan dibatasi provider (rate limit). Coba lagi beberapa saat lagi.",
        httpStatus: status,
      };
    }

    if (status === 400 || status === 409 || status === 422) {
      // Gemini melaporkan API key tidak valid sebagai HTTP 400 (API_KEY_INVALID),
      // bukan 401. Jangan salah label sebagai masalah model.
      if (AUTH_SIGNAL.test(signal)) {
        return {
          category: "AUTH",
          message: "API key ditolak provider. Periksa kembali API key untuk provider ini.",
          httpStatus: status,
        };
      }
      if (MODEL_SIGNAL.test(signal)) {
        return {
          category: "MODEL",
          message:
            "Model tidak ditemukan atau tidak tersedia untuk akun/API key ini. Pilih model lain atau muat daftar model.",
          httpStatus: status,
        };
      }
      return {
        category: "INVALID_REQUEST",
        message:
          "Request uji ditolak provider (parameter atau format tidak didukung). Periksa nama model dan dukungan fiturnya.",
        httpStatus: status,
      };
    }

    if (status && status >= 500) {
      return {
        category: "PROVIDER_UNAVAILABLE",
        message: "Provider tidak dapat dijangkau atau sedang mengalami gangguan.",
        httpStatus: status,
      };
    }

    if (category === "invalid-response" || category === "empty-response") {
      // Body HTTP 200 bisa berisi kode model (mis. OpenRouter `model_not_found`)
      // sebelum bentuk respons divalidasi. Kode eksplisit menang atas kategori.
      if (MODEL_SIGNAL.test(providerCodeSignal(error))) {
        return {
          category: "MODEL",
          message:
            "Model tidak ditemukan atau tidak tersedia untuk akun/API key ini. Pilih model lain atau muat daftar model.",
          httpStatus: status,
        };
      }
      const empty = /empty|kosong|content kosong|max_tokens|maxoutputtokens/.test(
        signal
      );
      return {
        category: "INVALID_RESPONSE",
        message: empty
          ? "Provider merespons, tetapi tidak menghasilkan teks. Model reasoning mungkin kehabisan token; coba model lain atau naikkan batas token uji."
          : "Provider merespons, tetapi format jawabannya tidak dapat dibaca.",
        httpStatus: status,
      };
    }

    // Kode provider tanpa status HTTP (mis. error di body HTTP 200).
    if (AUTH_SIGNAL.test(signal)) {
      return {
        category: "AUTH",
        message: "API key ditolak provider. Periksa kembali API key untuk provider ini.",
        httpStatus: status,
      };
    }
    if (QUOTA_SIGNAL.test(signal)) {
      return {
        category: "QUOTA",
        message: "Kuota atau kredit provider tidak mencukupi.",
        httpStatus: status,
      };
    }
    if (RATE_LIMIT_SIGNAL.test(signal)) {
      return {
        category: "RATE_LIMIT",
        message: "Permintaan dibatasi provider (rate limit). Coba lagi beberapa saat lagi.",
        httpStatus: status,
      };
    }
    if (MODEL_SIGNAL.test(signal)) {
      return {
        category: "MODEL",
        message:
          "Model tidak ditemukan atau tidak tersedia untuk akun/API key ini. Pilih model lain atau muat daftar model.",
        httpStatus: status,
      };
    }
    if (INVALID_REQUEST_SIGNAL.test(signal)) {
      return {
        category: "INVALID_REQUEST",
        message:
          "Request uji ditolak provider (parameter atau format tidak didukung). Periksa nama model dan dukungan fiturnya.",
        httpStatus: status,
      };
    }

    if (category === "transport" || category === "http") {
      return {
        category: "NETWORK",
        message:
          "Provider tidak dapat dijangkau dari server. Periksa koneksi internet/DNS server.",
        httpStatus: status,
      };
    }
    return {
      category: "UNKNOWN",
      message: "Terjadi kesalahan yang belum dapat diklasifikasikan.",
      httpStatus: status,
    };
  }

  if (error instanceof AIProviderError) {
    return {
      category: "UNKNOWN",
      message: "Terjadi kesalahan yang belum dapat diklasifikasikan.",
      httpStatus: error.upstreamStatus ?? null,
    };
  }

  return {
    category: "UNKNOWN",
    message: "Terjadi kesalahan yang belum dapat diklasifikasikan.",
    httpStatus: null,
  };
}

/** Uji model utama saja, tanpa fallback, tanpa tools. */
export async function testProviderConnection(
  values: AIConfigValues,
  apiKey: string
): Promise<ConnectionTestOutcome> {
  const definition = getAIProviderDefinition(values.provider);
  const startedAt = Date.now();

  if (!apiKey || apiKey.trim().length === 0) {
    return {
      ok: false,
      category: "INVALID_CONFIG",
      message: "API key belum diisi.",
      latencyMs: 0,
      httpStatus: null,
      provider: values.provider,
      model: values.model,
    };
  }

  const provider = buildAIProvider({
    provider: values.provider,
    apiKey,
    baseUrl: definition.baseUrl,
    model: values.model,
    fallbackModels: [],
    disableThinking: values.disableThinking,
  });

  try {
    if (provider.testConnection) {
      await provider.testConnection();
    } else {
      await provider.chat([{ role: "user", content: "ping" }]);
    }
    return {
      ok: true,
      category: "SUCCESS",
      message: `Koneksi ke ${definition.label} berhasil. Model ${values.model} merespons.`,
      latencyMs: Date.now() - startedAt,
      httpStatus: null,
      provider: values.provider,
      model: values.model,
    };
  } catch (error) {
    const classified = classifyProviderError(error);
    const latencyMs = Date.now() - startedAt;
    const timedOut = classified.category === "TIMEOUT";
    // Log aman: kategori/status/model saja. Tidak ada API key/detail mentah.
    console.warn(
      `[AI] Uji koneksi gagal: provider=${values.provider} model=${values.model} category=${classified.category} status=${classified.httpStatus ?? "-"} latencyMs=${latencyMs}`
    );
    return {
      ok: false,
      category: classified.category,
      message: timedOut
        ? `${classified.message} Batas uji ${Math.round(
            AI_CONNECTION_TEST_TIMEOUT_MS / 1000
          )} detik; latensi tercatat ${latencyMs} ms.`
        : classified.message,
      latencyMs,
      httpStatus: classified.httpStatus,
      provider: values.provider,
      model: values.model,
    };
  }
}

export class ModelListError extends Error {
  readonly category: AITestCategory;

  constructor(message: string, category: AITestCategory) {
    super(message);
    this.name = "ModelListError";
    this.category = category;
    Object.setPrototypeOf(this, ModelListError.prototype);
  }
}

const MODEL_LIST_TIMEOUT_MS = 20_000;
const MAX_MODELS = 300;

function httpErrorForModelList(status: number, raw = ""): ModelListError {
  const signal = raw.toLowerCase();
  if (status === 402 || (QUOTA_SIGNAL.test(signal) && status !== 401 && status !== 403)) {
    return new ModelListError(
      "Kuota atau kredit provider tidak mencukupi untuk memuat model.",
      "QUOTA"
    );
  }
  if (status === 401 || status === 403) {
    return new ModelListError("API key ditolak provider saat memuat model.", "AUTH");
  }
  if (status === 404) {
    return new ModelListError(
      "Endpoint daftar model tidak tersedia untuk provider ini.",
      "MODEL"
    );
  }
  if (status === 429) {
    return new ModelListError(
      "Permintaan daftar model dibatasi provider (rate limit/kuota).",
      "RATE_LIMIT"
    );
  }
  if (status === 400 || status === 422) {
    return new ModelListError(
      "Permintaan daftar model ditolak provider. Gunakan input model manual.",
      "INVALID_REQUEST"
    );
  }
  if (status >= 500) {
    return new ModelListError(
      "Provider tidak dapat dijangkau atau sedang mengalami gangguan.",
      "PROVIDER_UNAVAILABLE"
    );
  }
  return new ModelListError(
    "Daftar model tidak dapat dimuat. Gunakan input model manual.",
    "UNKNOWN"
  );
}

async function fetchJson(
  url: string,
  headers: Record<string, string>
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ModelListError(
        "Permintaan daftar model melebihi batas waktu.",
        "TIMEOUT"
      );
    }
    throw new ModelListError(
      "Provider tidak dapat dijangkau dari server.",
      "NETWORK"
    );
  }

  const raw = await response.text().catch(() => "");
  if (!response.ok) throw httpErrorForModelList(response.status, raw);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ModelListError(
      "Respons daftar model tidak dapat dibaca.",
      "INVALID_RESPONSE"
    );
  }
}

/**
 * Daftar model langsung dari provider (bila tersedia). Bila gagal, UI harus
 * tetap mengizinkan input manual — kegagalan daftar bukan kegagalan koneksi.
 */
export async function listProviderModels(
  values: AIConfigValues,
  apiKey: string
): Promise<{ models: string[]; source: "provider" }> {
  const definition = getAIProviderDefinition(values.provider);
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ModelListError("API key belum tersedia untuk memuat model.", "INVALID_CONFIG");
  }

  if (values.provider === "GEMINI") {
    const data = (await fetchJson(
      `${definition.baseUrl}/models?pageSize=200`,
      { "x-goog-api-key": apiKey }
    )) as {
      models?: Array<{
        name?: unknown;
        supportedGenerationMethods?: unknown;
      }>;
    };

    const models: string[] = [];
    for (const model of data.models ?? []) {
      if (typeof model.name !== "string") continue;
      const methods = Array.isArray(model.supportedGenerationMethods)
        ? model.supportedGenerationMethods
        : ["generateContent"];
      if (!methods.includes("generateContent")) continue;
      const name = model.name.replace(/^models\//, "");
      if (!name) continue;
      models.push(name);
    }
    return { models: Array.from(new Set(models)).sort().slice(0, MAX_MODELS), source: "provider" };
  }

  const data = (await fetchJson(`${definition.baseUrl}/models`, {
    Authorization: `Bearer ${apiKey}`,
  })) as { data?: Array<{ id?: unknown }> };

  const models = Array.from(
    new Set(
      (data.data ?? [])
        .map((item) => (typeof item.id === "string" ? item.id.trim() : ""))
        .filter((id) => id.length > 0)
    )
  ).sort();

  return { models: models.slice(0, MAX_MODELS), source: "provider" };
}
