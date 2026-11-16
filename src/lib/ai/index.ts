/**
 * Titik masuk provider AI runtime.
 *
 * Konfigurasi dibaca SETIAP REQUEST dari database (bila ada konfigurasi aktif)
 * atau .env (fallback transisi). Tidak ada cache in-memory, sehingga perubahan
 * yang diaktifkan Admin langsung berlaku untuk request berikutnya — juga aman
 * bila aplikasi dijalankan pada lebih dari satu instance.
 *
 * Setiap request membuat instance provider baru dari snapshot konfigurasi.
 * Rangkaian tool-calling dalam satu request tidak berpindah konfigurasi.
 */

import {
  AIProvider,
  AIProviderResult,
  type AIChatMessage,
  type AIToolDefinition,
  type AIToolExecutor,
} from "./types";
import { OpenAIAIProvider } from "./openai";
import { GeminiAIProvider } from "./gemini";
import {
  AIConfigurationError,
  getRuntimeAIConfig,
  readEnvRuntime,
  type RuntimeAIConfig,
} from "./configStore";
import type { RuntimeAIProviderId } from "./providers";

/**
 * Rangkaian provider dengan fallback. Identitas provider/model yang benar-benar
 * menjawab dikembalikan bersama hasil respons (`AIProviderResult`), bukan
 * disimpan pada state global. Dengan begitu request bersamaan tidak dapat
 * saling menimpa identitas model.
 */
export class FallbackAIProvider implements AIProvider {
  constructor(
    private readonly candidates: Array<{
      provider: AIProvider;
      providerId: string;
      model: string;
    }>
  ) {}

  private logSuccess(result: AIProviderResult): void {
    console.log(`[AI] Respons dihasilkan oleh ${result.provider} (${result.model}).`);
  }

  /**
   * Tandai respons yang berasal dari kandidat cadangan atau model cadangan di
   * dalam provider utama. Identitas provider/model yang menjawab tetap
   * dipertahankan; informasi utama hanya ditambahkan agar pemanggil/UI dapat
   * mengungkapkan perpindahan tersebut secara transparan.
   */
  private withFallbackIdentity(result: AIProviderResult, index: number): AIProviderResult {
    const primary = this.candidates[0];
    const usedFallback =
      index > 0 ||
      result.provider !== primary.providerId ||
      result.model !== primary.model;
    if (!usedFallback) return result;
    return {
      ...result,
      fallbackUsed: true,
      primaryProvider: primary.providerId,
      primaryModel: primary.model,
    };
  }

  async chat(messages: AIChatMessage[]): Promise<string> {
    return (await this.chatDetailed(messages)).content;
  }

  async chatDetailed(messages: AIChatMessage[]): Promise<AIProviderResult> {
    let lastError: unknown;
    for (let index = 0; index < this.candidates.length; index += 1) {
      const candidate = this.candidates[index];
      try {
        const result = candidate.provider.chatDetailed
          ? await candidate.provider.chatDetailed(messages)
          : {
              content: await candidate.provider.chat(messages),
              provider: candidate.providerId,
              model: candidate.model,
            };
        const decorated = this.withFallbackIdentity(result, index);
        this.logSuccess(decorated);
        return decorated;
      } catch (error) {
        lastError = error;
        console.warn(
          `[AI] Provider ${candidate.providerId} (${candidate.model}) gagal, mencoba cadangan berikutnya.`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    throw lastError ?? new Error("Semua provider AI gagal.");
  }

  async chatWithTools(
    messages: AIChatMessage[],
    tools: AIToolDefinition[],
    execute: AIToolExecutor
  ): Promise<string> {
    return (await this.chatWithToolsDetailed(messages, tools, execute)).content;
  }

  async chatWithToolsDetailed(
    messages: AIChatMessage[],
    tools: AIToolDefinition[],
    execute: AIToolExecutor
  ): Promise<AIProviderResult> {
    let lastError: unknown;
    for (let index = 0; index < this.candidates.length; index += 1) {
      const candidate = this.candidates[index];
      try {
        let result: AIProviderResult;
        if (candidate.provider.chatWithToolsDetailed) {
          result = await candidate.provider.chatWithToolsDetailed(messages, tools, execute);
        } else if (typeof candidate.provider.chatWithTools === "function") {
          result = {
            content: await candidate.provider.chatWithTools(messages, tools, execute),
            provider: candidate.providerId,
            model: candidate.model,
          };
        } else {
          result = {
            content: await candidate.provider.chat(messages),
            provider: candidate.providerId,
            model: candidate.model,
          };
        }
        const decorated = this.withFallbackIdentity(result, index);
        this.logSuccess(decorated);
        return decorated;
      } catch (error) {
        lastError = error;
        console.warn(
          `[AI] Provider ${candidate.providerId} (${candidate.model}) gagal, mencoba cadangan berikutnya.`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    throw lastError ?? new Error("Semua provider AI gagal.");
  }
}

export interface AIProviderBuildInput {
  provider: RuntimeAIProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModels: string[];
  disableThinking: boolean;
}

/** Bangun adapter sesuai protokol provider. */
export function buildAIProvider(input: AIProviderBuildInput): AIProvider {
  if (input.provider === "GEMINI") {
    return new GeminiAIProvider(
      input.apiKey,
      input.baseUrl,
      input.model,
      input.fallbackModels
    );
  }

  return new OpenAIAIProvider(
    input.apiKey,
    input.baseUrl,
    input.model,
    input.fallbackModels,
    {
      // Parameter thinking NVIDIA tidak dikirim ke Groq/OpenRouter/provider
      // OpenAI-compatible generik.
      disableThinking: input.provider === "NVIDIA" ? input.disableThinking : false,
      sendThinkingControl: input.provider === "NVIDIA",
      providerId: input.provider,
    }
  );
}

function buildFromRuntime(runtime: RuntimeAIConfig): AIProvider {
  if (runtime.status !== "active" && runtime.status !== "env") {
    throw new AIConfigurationError(
      runtime.status === "invalid"
        ? runtime.error
        : "AI Assistant belum dikonfigurasi. Administrator perlu mengatur provider dan API key pada menu Konfigurasi AI.",
      runtime.status === "invalid" ? "AI_CONFIG_INVALID" : "AI_NOT_CONFIGURED"
    );
  }

  const provider = buildAIProvider({
    provider: runtime.provider,
    apiKey: runtime.apiKey,
    baseUrl: runtime.baseUrl,
    model: runtime.model,
    fallbackModels: runtime.fallbackModels,
    disableThinking: runtime.disableThinking,
  });

  console.log(
    `[AI] Provider siap (${runtime.source}). provider=${runtime.provider} model=${runtime.model}` +
      `${runtime.fallbackModels.length ? ` fallback=${runtime.fallbackModels.join(",")}` : ""}` +
      ` thinking=${runtime.disableThinking ? "off" : "on"}`
  );

  return provider;
}

/**
 * True bila ada konfigurasi yang dapat dipakai runtime. Konfigurasi aktif yang
 * rusak menghasilkan false agar UI chat menampilkan pesan konfigurasi, bukan
 * diam-diam memakai .env.
 */
export async function isAIConfigured(): Promise<boolean> {
  const runtime = await getRuntimeAIConfig();
  return runtime.status === "active" || runtime.status === "env";
}

/**
 * Bangun rangkaian provider untuk SATU request. Parameter `userId` dipertahankan
 * demi kompatibilitas pemanggil lama, tetapi identitas model TIDAK lagi disimpan
 * per pengguna; setiap respons membawa identitasnya sendiri.
 */
export async function getAIProvider(_userId?: string): Promise<AIProvider> {
  const candidates: Array<{ provider: AIProvider; providerId: string; model: string }> = [];

  const runtime = await getRuntimeAIConfig();
  if (runtime.status === "invalid") {
    throw new AIConfigurationError(runtime.error, "AI_CONFIG_INVALID");
  }
  if (runtime.status === "active" || runtime.status === "env") {
    candidates.push({
      provider: buildAIProvider({
        provider: runtime.provider,
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        fallbackModels: runtime.fallbackModels,
        disableThinking: runtime.disableThinking,
      }),
      providerId: runtime.provider,
      model: runtime.model,
    });
  }

  // Provider cadangan dari .env (mis. NVIDIA) bila tersedia dan berbeda
  // dari provider utama yang sedang aktif. Hanya ditambahkan bila konfigurasi
  // aktif valid; konfigurasi aktif yang rusak TIDAK diam-diam memakai .env.
  const envRuntime = readEnvRuntime();
  const canUseEnvFallback =
    (runtime.status === "active" || runtime.status === "env") &&
    (envRuntime.status === "active" || envRuntime.status === "env");
  if (canUseEnvFallback) {
    const duplicate = candidates.some(
      (item) =>
        item.providerId === envRuntime.provider && item.model === envRuntime.model
    );
    if (!duplicate) {
      candidates.push({
        provider: buildAIProvider({
          provider: envRuntime.provider,
          apiKey: envRuntime.apiKey,
          baseUrl: envRuntime.baseUrl,
          model: envRuntime.model,
          fallbackModels: envRuntime.fallbackModels,
          disableThinking: envRuntime.disableThinking,
        }),
        providerId: envRuntime.provider,
        model: envRuntime.model,
      });
    }
  }

  if (candidates.length === 0) {
    throw new AIConfigurationError(
      "AI Assistant belum dikonfigurasi. Administrator perlu mengatur provider dan API key pada menu Konfigurasi AI.",
      "AI_NOT_CONFIGURED"
    );
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    console.log(
      `[AI] Provider siap. provider=${only.providerId} model=${only.model}`
    );
    return only.provider;
  }

  console.log(
    `[AI] Provider siap dengan fallback. primary=${candidates[0].providerId} (${candidates[0].model}), fallbacks=${candidates
      .slice(1)
      .map((item) => `${item.providerId} (${item.model})`)
      .join(", ")}`
  );
  return new FallbackAIProvider(candidates);
}

/** Untuk diagnostik aman (tanpa API key). */
export async function getAIConfigurationSummary(): Promise<{
  status: RuntimeAIConfig["status"];
  provider: string | null;
  model: string | null;
  message: string | null;
}> {
  const runtime = await getRuntimeAIConfig();
  if (runtime.status === "none") {
    return { status: "none", provider: null, model: null, message: null };
  }
  if (runtime.status === "invalid") {
    return {
      status: "invalid",
      provider: null,
      model: null,
      message: runtime.error,
    };
  }
  return {
    status: runtime.status,
    provider: runtime.provider,
    model: runtime.model,
    message: null,
  };
}
