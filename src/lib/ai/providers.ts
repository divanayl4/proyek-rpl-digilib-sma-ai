/**
 * Katalog provider AI yang didukung DigiLib.
 *
 * Modul ini murni metadata (tanpa secret / process.env) sehingga aman dipakai
 * oleh komponen UI maupun server. Endpoint provider sengaja DIBATASI pada
 * daftar yang diketahui: Administrator tidak dapat memasukkan URL arbitrer,
 * sehingga endpoint konfigurasi tidak menjadi jalur SSRF.
 */

export const AI_PROVIDER_IDS = ["NVIDIA", "GEMINI", "GROQ", "OPENROUTER"] as const;

export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AIProviderDefinition {
  id: AIProviderId;
  label: string;
  description: string;
  /** Endpoint tetap yang dipakai adapter. Tidak dapat diubah dari UI. */
  baseUrl: string;
  /** Jenis protokol yang dipakai adapter. */
  protocol: "openai-compatible" | "gemini-native";
  /** Label singkat protokol untuk ditampilkan pada UI. */
  protocolLabel: string;
  /** Nama field API key pada dokumentasi provider. */
  keyLabel: string;
  /**
   * Dukungan tool calling. "model-dependent" berarti adapter mendukung
   * protokolnya, tetapi model tertentu bisa menolak parameter tools.
   */
  toolCalling: "supported" | "model-dependent";
  toolCallingNote: string;
  docsUrl: string;
  /** Catatan operasional yang penting bagi Admin. */
  notes: string[];
}

export const AI_PROVIDERS: Record<AIProviderId, AIProviderDefinition> = {
  NVIDIA: {
    id: "NVIDIA",
    label: "NVIDIA NIM",
    description:
      "Endpoint NVIDIA NIM yang kompatibel dengan OpenAI Chat Completions. Cocok untuk model Llama/Nemotron pada katalog NVIDIA.",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    protocol: "openai-compatible",
    protocolLabel: "OpenAI-compatible",
    keyLabel: "NVIDIA API Key (nvapi-...)",
    toolCalling: "model-dependent",
    toolCallingNote:
      "Adapter mengirim skema tools standar. Tidak semua model NVIDIA NIM mendukung function calling; model tanpa dukungan akan ditolak provider.",
    docsUrl: "https://build.nvidia.com/",
    notes: [
      "Model reasoning NVIDIA dapat memakai banyak token untuk proses berpikir. Opsi pemadaman thinking hanya dikirim ke provider ini.",
      "Gunakan model yang tercantum pada akun NVIDIA Anda.",
    ],
  },
  GEMINI: {
    id: "GEMINI",
    label: "Google Gemini",
    description:
      "Google Gemini API native (generateContent). Menggunakan format contents/functionDeclarations, bukan endpoint OpenAI-compatible.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    protocol: "gemini-native",
    protocolLabel: "Gemini native (v1beta)",
    keyLabel: "Google AI Studio API Key",
    toolCalling: "supported",
    toolCallingNote:
      "Function calling didukung melalui functionDeclarations pada model generateContent. Model embedding tidak dapat dipakai untuk chat.",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    notes: [
      "Daftar model difilter ke model yang mendukung generateContent.",
      "Kunci dikirim melalui header x-goog-api-key, bukan query string.",
    ],
  },
  GROQ: {
    id: "GROQ",
    label: "Groq",
    description:
      "Groq Cloud OpenAI-compatible. Latensi rendah untuk model yang tersedia pada akun Groq.",
    baseUrl: "https://api.groq.com/openai/v1",
    protocol: "openai-compatible",
    protocolLabel: "OpenAI-compatible",
    keyLabel: "Groq API Key (gsk_...)",
    toolCalling: "model-dependent",
    toolCallingNote:
      "Sebagian model Groq mendukung tool calling. Uji model yang dipilih sebelum mengaktifkan.",
    docsUrl: "https://console.groq.com/docs",
    notes: ["Daftar model dapat dimuat langsung dari endpoint /models Groq."],
  },
  OPENROUTER: {
    id: "OPENROUTER",
    label: "OpenRouter",
    description:
      "OpenRouter menyediakan banyak model dari berbagai vendor melalui API yang kompatibel dengan OpenAI.",
    baseUrl: "https://openrouter.ai/api/v1",
    protocol: "openai-compatible",
    protocolLabel: "OpenAI-compatible",
    keyLabel: "OpenRouter API Key (sk-or-...)",
    toolCalling: "model-dependent",
    toolCallingNote:
      "Dukungan tools bergantung pada model yang dipilih di OpenRouter. Model gratis/tertentu dapat menolak tools.",
    docsUrl: "https://openrouter.ai/docs",
    notes: [
      "Nama model OpenRouter biasanya berbentuk vendor/model, mis. openai/gpt-4o-mini.",
      "Kredit akun OpenRouter harus mencukupi untuk model berbayar.",
    ],
  },
};

export function isAIProviderId(value: unknown): value is AIProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function getAIProviderDefinition(provider: AIProviderId): AIProviderDefinition {
  return AI_PROVIDERS[provider];
}

/** Provider runtime tambahan untuk kompatibilitas .env lama. */
export type RuntimeAIProviderId = AIProviderId | "OPENAI_COMPATIBLE";

export interface RuntimeProviderDefinition {
  id: RuntimeAIProviderId;
  label: string;
  baseUrl: string;
  protocol: "openai-compatible" | "gemini-native";
}

/**
 * Provider dari konfigurasi .env. Nilai AI_PROVIDER (bila ada) diprioritaskan;
 * jika tidak, provider disimpulkan dari host AI_BASE_URL. Endpoint generik
 * (mis. api.openai.com) diperlakukan sebagai OPENAI_COMPATIBLE, bukan dipaksa
 * menjadi salah satu provider target.
 */
export function resolveEnvProvider(
  explicitProvider: string | undefined,
  baseUrl: string | undefined
): RuntimeProviderDefinition {
  const explicit = (explicitProvider || "").trim().toUpperCase();
  const configuredBase = (baseUrl || "").trim().replace(/\/+$/, "");

  if (explicit === "NVIDIA" || explicit === "NIM") {
    return {
      ...AI_PROVIDERS.NVIDIA,
      id: "NVIDIA",
      baseUrl: configuredBase || AI_PROVIDERS.NVIDIA.baseUrl,
    };
  }
  if (explicit === "GEMINI" || explicit === "GOOGLE") {
    return {
      ...AI_PROVIDERS.GEMINI,
      id: "GEMINI",
      baseUrl: configuredBase || AI_PROVIDERS.GEMINI.baseUrl,
    };
  }
  if (explicit === "GROQ") {
    return {
      ...AI_PROVIDERS.GROQ,
      id: "GROQ",
      baseUrl: configuredBase || AI_PROVIDERS.GROQ.baseUrl,
    };
  }
  if (explicit === "OPENROUTER") {
    return {
      ...AI_PROVIDERS.OPENROUTER,
      id: "OPENROUTER",
      baseUrl: configuredBase || AI_PROVIDERS.OPENROUTER.baseUrl,
    };
  }
  if (explicit === "OPENAI" || explicit === "OPENAI_COMPATIBLE") {
    return {
      id: "OPENAI_COMPATIBLE",
      label: "OpenAI-compatible (.env)",
      baseUrl: configuredBase || "https://api.openai.com/v1",
      protocol: "openai-compatible",
    };
  }

  const base = configuredBase || "https://api.openai.com/v1";

  const lower = base.toLowerCase();
  if (lower.includes("generativelanguage.googleapis.com")) {
    return { ...AI_PROVIDERS.GEMINI, id: "GEMINI", baseUrl: base };
  }
  if (lower.includes("integrate.api.nvidia.com")) {
    return { ...AI_PROVIDERS.NVIDIA, id: "NVIDIA", baseUrl: base };
  }
  if (lower.includes("api.groq.com")) {
    return { ...AI_PROVIDERS.GROQ, id: "GROQ", baseUrl: base };
  }
  if (lower.includes("openrouter.ai")) {
    return { ...AI_PROVIDERS.OPENROUTER, id: "OPENROUTER", baseUrl: base };
  }

  return {
    id: "OPENAI_COMPATIBLE",
    label: "OpenAI-compatible (.env)",
    baseUrl: base,
    protocol: "openai-compatible",
  };
}
