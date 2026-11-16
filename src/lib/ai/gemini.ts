/**
 * Adapter Google Gemini API native (generateContent).
 *
 * Gemini TIDAK kompatibel penuh dengan endpoint OpenAI /chat/completions:
 * - pesan memakai `contents` dengan role user/model,
 * - system prompt memakai `systemInstruction`,
 * - function calling memakai `functionDeclarations` + `functionCall` /
 *   `functionResponse`.
 *
 * Adapter ini mempertahankan kontrak pipeline DigiLib: system prompt, riwayat
 * percakapan, tool-calling multi-ronde, hasil tool, timeout, dan fallback model.
 */

import { randomUUID } from "node:crypto";
import {
  AIChatMessage,
  AIProvider,
  AIProviderError,
  AIProviderResult,
  AIToolCall,
  AIToolDefinition,
  AIToolExecutor,
} from "./types";
import {
  AI_CONNECTION_TEST_TIMEOUT_MS,
  AI_REQUEST_TIMEOUT_MS,
  AI_TOTAL_BUDGET_MS,
} from "./timeouts";
import {
  MAX_RATE_LIMIT_RETRIES,
  isRetryableRateLimit,
  logRateLimitRetry,
  parseRetryAfterSeconds,
  rateLimitRetryWaitMs,
  sleep,
} from "./rateLimitRetry";

const REQUEST_TIMEOUT_MS = AI_REQUEST_TIMEOUT_MS;
const TOTAL_BUDGET_MS = AI_TOTAL_BUDGET_MS;
const MIN_ROUND_MS = 4_000;
const MAX_OUTPUT_TOKENS = 1200;
/**
 * Uji koneksi memakai batas token yang lebih longgar. Model Gemini 2.5/3
 * memakai sebagian `maxOutputTokens` untuk "thinking"; batas 16 token membuat
 * respons sukses tetapi tanpa teks, sehingga provider sehat terlihat gagal.
 * 2048 tetap kecil untuk satu prompt "ping", tetapi cukup untuk reasoning.
 */
const CONNECTION_TEST_MAX_OUTPUT_TOKENS = 2048;
const TEMPERATURE = 0.2;
const MAX_TOOL_ROUNDS = 2;

const FALLBACK_STATUSES = new Set([404, 408, 409, 429, 500, 502, 503, 504]);

function safeErrorCode(error: unknown): string | undefined {
  const direct = error as { code?: unknown } | null;
  if (direct && typeof direct.code === "string" && direct.code.length > 0) {
    return direct.code;
  }
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (cause && typeof cause.code === "string" && cause.code.length > 0) {
    return cause.code;
  }
  return undefined;
}

function errorCategory(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const code = safeErrorCode(error) ?? "";
  if (name === "TimeoutError" || /TIMEOUT|ETIMEDOUT/i.test(code)) return "timeout";
  if (name === "AbortError" || code === "ABORT_ERR") return "abort";
  return "transport";
}

function redact(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("[REDACTED]");
}

interface GeminiErrorDetails {
  message?: string;
  code?: string;
  status?: string;
  reason?: string;
}

function safeString(value: unknown, maxLength = 200): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, maxLength);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * Gemini memakai format error `{ error: { code, status, message, details } }`.
 * `status` (mis. API_KEY_INVALID/RESOURCE_EXHAUSTED) lebih akurat daripada
 * pencocokan teks, jadi nilainya disimpan untuk klasifikasi.
 */
function parseGeminiError(raw: string): GeminiErrorDetails {
  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        code?: unknown;
        status?: unknown;
        message?: unknown;
        details?: Array<{ reason?: unknown }>;
      };
    };
    const error = parsed?.error;
    if (!error) return {};
    const reason = Array.isArray(error.details)
      ? error.details
          .map((detail) => safeString(detail?.reason))
          .find((value): value is string => Boolean(value))
      : undefined;
    return {
      message: safeString(error.message, 500),
      code: safeString(error.code),
      status: safeString(error.status),
      reason,
    };
  } catch {
    return { message: raw.slice(0, 300) };
  }
}

function describeUpstreamError(status: number): string {
  if (status === 400) {
    return "Permintaan ditolak provider. Model atau parameter konfigurasi tidak sesuai.";
  }
  if (status === 401 || status === 403) {
    return "API key AI ditolak oleh provider. Periksa kembali API key pada Konfigurasi AI.";
  }
  if (status === 402) {
    return "Kuota atau kredit provider tidak mencukupi.";
  }
  if (status === 404) {
    return "Model AI tidak tersedia pada akun provider ini. Periksa nama model.";
  }
  if (status === 408) {
    return "Provider melaporkan timeout. Timeout bukan bukti API key salah.";
  }
  if (status === 409) {
    return "Permintaan bertentangan dengan status provider. Periksa konfigurasi model.";
  }
  if (status === 429) {
    return "Batas penggunaan atau kuota API AI tercapai. Tunggu sebentar lalu coba lagi.";
  }
  if (status >= 500) {
    return "Provider AI sedang mengalami gangguan. Coba lagi sebentar lagi.";
  }
  return `Provider AI menolak permintaan (HTTP ${status}).`;
}

function toClientStatus(status: number): number {
  return status === 429 ? 429 : 502;
}

/**
 * Klasifikasi 429 Gemini. Hanya kuota/kredit yang benar-benar habis yang
 * dianggap QUOTA (tidak di-retry); rate limit sementara → GENERAL/RPM.
 */
function detectGeminiRateLimitKind(
  error: GeminiErrorDetails
): "TPM" | "RPM" | "QUOTA" | "GENERAL" {
  const status = (error.status ?? "").toUpperCase();
  const reason = (error.reason ?? "").toUpperCase();
  const message = (error.message ?? "").toLowerCase();
  if (
    /\b(insufficient_quota|quota_exceeded|billing|credit|payment)\b/.test(
      message
    ) ||
    reason.includes("BILLING") ||
    status.includes("BILLING")
  ) {
    return "QUOTA";
  }
  if (reason.includes("TOKEN") || /\btoken/.test(message)) return "TPM";
  if (reason.includes("RATE") || /\brequests?\b/.test(message)) return "RPM";
  return "GENERAL";
}

interface GeminiPart {
  text?: string;
  /** Bagian "thinking" Gemini; bukan jawaban final. */
  thought?: boolean;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name?: string; response?: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiRawMessage {
  content: string | null;
  tool_calls?: AIToolCall[];
}

export class GeminiAIProvider implements AIProvider {
  private apiKey: string;
  private baseURL: string;
  private models: string[];

  constructor(apiKey: string, baseURL: string, model: string, fallbackModels: string[] = []) {
    this.apiKey = apiKey;
    this.baseURL = baseURL.replace(/\/+$/, "");
    this.models = [this.normalizeModel(model), ...fallbackModels.map((item) => this.normalizeModel(item))]
      .map((item) => item.trim())
      .filter((item, index, all) => item.length > 0 && all.indexOf(item) === index);
  }

  private normalizeModel(model: string): string {
    return model.trim().replace(/^models\//, "");
  }

  async chat(messages: AIChatMessage[]): Promise<string> {
    return (await this.chatDetailed(messages)).content;
  }

  async chatDetailed(messages: AIChatMessage[]): Promise<AIProviderResult> {
    const startedAt = Date.now();
    let lastError: unknown = null;
    const requestId = randomUUID();

    for (let index = 0; index < this.models.length; index += 1) {
      const model = this.models[index];
      const isLast = index === this.models.length - 1;
      const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
      if (index > 0 && remaining <= 5_000) break;

      const attemptStartedAt = Date.now();
      try {
        const message = await this.requestRaw(
          model,
          messages,
          Math.max(5_000, Math.min(REQUEST_TIMEOUT_MS, remaining))
        );
        if (message.tool_calls && message.tool_calls.length > 0) {
          throw new AIProviderError(
            "Provider AI tidak mengembalikan jawaban.",
            502,
            `HTTP 200 ${model} — functionCall tanpa dukungan tools`,
            undefined,
            { category: "invalid-response" }
          );
        }
        return { content: message.content ?? "", provider: "GEMINI", model };
      } catch (error) {
        lastError = error;
        const upstream =
          error instanceof AIProviderError ? error.upstreamStatus ?? error.status : 0;
        const canFallback = !isLast && FALLBACK_STATUSES.has(upstream);
        this.logAttemptFailure(
          requestId,
          model,
          index + 1,
          Date.now() - attemptStartedAt,
          error
        );
        if (!canFallback) throw error;
        if (upstream === 429) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
    }

    throw lastError;
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
    const startedAt = Date.now();
    let lastError: unknown = null;
    const requestId = randomUUID();
    // Cache hasil tool per request agar model cadangan yang mengulang
    // panggilan sama tidak mengeksekusi query database dua kali.
    const toolCache = new Map<string, Promise<string>>();
    const memoizedExecute: AIToolExecutor = (name, args) => {
      const key = `${name}:${JSON.stringify(args)}`;
      const cached = toolCache.get(key);
      if (cached) return cached;
      const pending = execute(name, args);
      toolCache.set(key, pending);
      return pending;
    };

    for (let index = 0; index < this.models.length; index += 1) {
      const model = this.models[index];
      const isLast = index === this.models.length - 1;
      const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
      if (index > 0 && remaining <= 5_000) break;

      const attemptStartedAt = Date.now();
      try {
        const content = await this.toolsLoop(
          model,
          messages,
          tools,
          memoizedExecute,
          Math.max(5_000, Math.min(REQUEST_TIMEOUT_MS, remaining))
        );
        return { content, provider: "GEMINI", model };
      } catch (error) {
        lastError = error;
        const upstream =
          error instanceof AIProviderError ? error.upstreamStatus ?? error.status : 0;
        const canFallback = !isLast && FALLBACK_STATUSES.has(upstream);
        this.logAttemptFailure(
          requestId,
          model,
          index + 1,
          Date.now() - attemptStartedAt,
          error
        );
        if (!canFallback) throw error;
        if (upstream === 429) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
    }

    throw lastError;
  }

  /**
   * Uji koneksi minimal: satu prompt pendek ke model utama, tanpa tools.
   * Tidak memakai fallback agar hasil pengujian tidak menyesatkan.
   */
  async testConnection(): Promise<void> {
    const model = this.models[0];
    if (!model) {
      throw new AIProviderError(
        "Model utama belum diisi.",
        400,
        "Konfigurasi model kosong",
        undefined,
        { category: "invalid-config" }
      );
    }
    await this.requestRaw(
      model,
      [{ role: "user", content: "ping" }],
      AI_CONNECTION_TEST_TIMEOUT_MS,
      undefined,
      CONNECTION_TEST_MAX_OUTPUT_TOKENS
    );
  }

  private logAttemptFailure(
    requestId: string,
    model: string,
    attempt: number,
    durationMs: number,
    error: unknown
  ): void {
    const status =
      error instanceof AIProviderError ? error.upstreamStatus : undefined;
    console.warn(
      [
        "[AI] Gemini attempt gagal:",
        `requestId=${requestId}`,
        `model=${model}`,
        `attempt=${attempt}/${this.models.length}`,
        `durationMs=${durationMs}`,
        `category=${error instanceof AIProviderError ? error.category ?? "http" : errorCategory(error)}`,
        `status=${status ?? "-"}`,
        `code=${safeErrorCode(error) ?? "-"}`,
      ].join(" ")
    );
  }

  private async toolsLoop(
    model: string,
    messages: AIChatMessage[],
    tools: AIToolDefinition[],
    execute: AIToolExecutor,
    timeoutMs: number
  ): Promise<string> {
    const conversation: AIChatMessage[] = [...messages];
    const deadline = Date.now() + timeoutMs;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ROUND_MS) break;

      const message = await this.requestRaw(
        model,
        conversation,
        Math.min(timeoutMs, remaining),
        tools
      );
      const toolCalls = message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        if (typeof message.content !== "string" || message.content.trim() === "") {
          throw new AIProviderError(
            "Provider AI tidak mengembalikan jawaban.",
            502,
            `HTTP 200 ${model} — content kosong`,
            undefined,
            { category: "empty-response" }
          );
        }
        return message.content;
      }

      conversation.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        let result: string;
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          result = await execute(call.function.name, args);
        } catch (error) {
          result = JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    const closingBudget = deadline - Date.now();
    if (closingBudget < MIN_ROUND_MS) {
      throw new AIProviderError(
        "Tidak dapat menghubungi provider AI. Periksa koneksi internet server.",
        503,
        `HTTP 200 ${model} — budget waktu habis setelah ${MAX_TOOL_ROUNDS + 1} ronde tool-calling`,
        undefined,
        { category: "timeout" }
      );
    }

    const closing = await this.requestRaw(
      model,
      [
        ...conversation,
        {
          role: "user",
          content:
            "Susun jawaban akhir dari hasil fungsi di atas. Jangan memanggil fungsi lagi.",
        },
      ],
      Math.min(timeoutMs, closingBudget)
    );
    if (typeof closing.content === "string" && closing.content.trim() !== "") {
      return closing.content;
    }

    throw new AIProviderError(
      "Provider AI tidak mengembalikan jawaban.",
      502,
      `HTTP 200 ${model} — tanpa jawaban setelah ${MAX_TOOL_ROUNDS + 1} ronde tool-calling`,
      undefined,
      { category: "empty-response" }
    );
  }

  /** Konversi pesan internal DigiLib → format contents Gemini. */
  private buildContents(messages: AIChatMessage[]): {
    contents: GeminiContent[];
    systemInstruction?: { parts: Array<{ text: string }> };
  } {
    const systemParts: string[] = [];
    const contents: GeminiContent[] = [];
    const toolNames = new Map<string, string>();

    for (const message of messages) {
      if (message.role === "system") {
        if (message.content.trim()) systemParts.push(message.content);
        continue;
      }

      if (message.role === "user") {
        contents.push({ role: "user", parts: [{ text: message.content }] });
        continue;
      }

      if (message.role === "assistant") {
        const parts: GeminiPart[] = [];
        if (message.content.trim()) parts.push({ text: message.content });
        for (const call of message.tool_calls ?? []) {
          toolNames.set(call.id, call.function.name);
          let args: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(call.function.arguments || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            args = {};
          }
          parts.push({ functionCall: { name: call.function.name, args } });
        }
        contents.push({
          role: "model",
          parts: parts.length > 0 ? parts : [{ text: message.content }],
        });
        continue;
      }

      if (message.role === "tool") {
        const name = message.tool_call_id
          ? toolNames.get(message.tool_call_id) ?? "tool"
          : "tool";
        let response: Record<string, unknown>;
        try {
          const parsed = JSON.parse(message.content);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            response = parsed as Record<string, unknown>;
          } else {
            response = { result: parsed };
          }
        } catch {
          response = { result: message.content };
        }
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name, response } }],
        });
      }
    }

    return {
      contents,
      ...(systemParts.length > 0
        ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } }
        : {}),
    };
  }

  /**
   * Retry 429 terbatas pada level satu permintaan HTTP. Ronde tool-calling
   * yang sudah selesai tidak diulang, sehingga hasil fungsi tetap konsisten.
   */
  private async requestRaw(
    model: string,
    messages: AIChatMessage[],
    timeoutMs: number,
    tools?: AIToolDefinition[],
    maxOutputTokens = MAX_OUTPUT_TOKENS
  ): Promise<GeminiRawMessage> {
    const requestId = randomUUID();
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ROUND_MS) break;

      try {
        return await this.requestRawOnce(
          model,
          messages,
          Math.min(remaining, timeoutMs),
          tools,
          maxOutputTokens
        );
      } catch (error) {
        lastError = error;
        if (
          !isRetryableRateLimit(error) ||
          attempt === MAX_RATE_LIMIT_RETRIES
        ) {
          throw error;
        }
        const waitMs = rateLimitRetryWaitMs(error, attempt);
        if (waitMs + MIN_ROUND_MS > deadline - Date.now()) throw error;
        logRateLimitRetry("GEMINI", requestId, model, attempt + 1, waitMs, error);
        await sleep(waitMs);
      }
    }

    if (lastError) throw lastError;
    throw new AIProviderError(
      "Tidak dapat menghubungi provider AI. Periksa koneksi internet server.",
      503,
      `Budget waktu habis sebelum memanggil ${model}`,
      undefined,
      { category: "timeout" }
    );
  }

  private async requestRawOnce(
    model: string,
    messages: AIChatMessage[],
    timeoutMs: number,
    tools?: AIToolDefinition[],
    maxOutputTokens = MAX_OUTPUT_TOKENS
  ): Promise<GeminiRawMessage> {
    const { contents, systemInstruction } = this.buildContents(messages);
    const body = {
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens,
      },
      ...(tools && tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: tools.map((tool) => ({
                  name: tool.function.name,
                  description: tool.function.description,
                  parameters: tool.function.parameters,
                })),
              },
            ],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          }
        : {}),
    };

    const url = `${this.baseURL}/models/${encodeURIComponent(model)}:generateContent`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const code = safeErrorCode(error);
      throw new AIProviderError(
        "Tidak dapat menghubungi provider AI. Periksa koneksi internet server.",
        503,
        `${error instanceof Error ? error.name : "Error"}${code ? ` (${code})` : ""}`,
        undefined,
        { code, category: errorCategory(error) }
      );
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      throw new AIProviderError(
        !response.ok
          ? describeUpstreamError(response.status)
          : "Tidak dapat menghubungi provider AI. Periksa koneksi internet server.",
        !response.ok ? toClientStatus(response.status) : 503,
        `HTTP ${response.status} ${model} — body read failed: ${
          error instanceof Error ? error.name : "Error"
        }`,
        response.ok ? undefined : response.status,
        { code: safeErrorCode(error), category: "transport" }
      );
    }

    if (!response.ok) {
      const providerError = parseGeminiError(raw);
      const detail = providerError.message || raw.slice(0, 500);
      const codeSuffix = [providerError.status, providerError.reason]
        .filter((value): value is string => Boolean(value))
        .join("/");
      const retryAfter =
        response.status === 429
          ? parseRetryAfterSeconds(response.headers)
          : undefined;
      const rateLimitKind =
        response.status === 429
          ? detectGeminiRateLimitKind(providerError)
          : undefined;
      throw new AIProviderError(
        describeUpstreamError(response.status),
        toClientStatus(response.status),
        redact(
          `HTTP ${response.status} ${model} — ${detail}${
            codeSuffix ? ` [${codeSuffix}]` : ""
          }`,
          this.apiKey
        ),
        response.status,
        {
          category: "http",
          providerCode: providerError.reason,
          providerType: providerError.status,
          providerStatus: providerError.status,
          ...(rateLimitKind ? { rateLimitKind } : {}),
          ...(retryAfter !== undefined ? { retryAfter } : {}),
        }
      );
    }

    let data: {
      candidates?: Array<{
        content?: { parts?: GeminiPart[] };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
      error?: { message?: string };
    };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      throw new AIProviderError(
        "Respons dari provider AI tidak dapat dibaca.",
        502,
        `HTTP 200 ${model} — body bukan JSON`,
        undefined,
        { category: "invalid-response" }
      );
    }

    const inlineProviderError = parseGeminiError(raw);
    if (inlineProviderError.message || inlineProviderError.status || inlineProviderError.reason) {
      throw new AIProviderError(
        "Provider AI mengembalikan kesalahan pada respons sukses.",
        502,
        redact(
          `HTTP 200 ${model} — ${
            inlineProviderError.message || inlineProviderError.status || "error"
          }`,
          this.apiKey
        ),
        undefined,
        {
          category: "invalid-response",
          providerCode: inlineProviderError.reason,
          providerType: inlineProviderError.status,
          providerStatus: inlineProviderError.status,
        }
      );
    }

    const blockReason =
      data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason;
    if (
      data.promptFeedback?.blockReason ||
      (typeof blockReason === "string" &&
        ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST"].includes(blockReason))
    ) {
      throw new AIProviderError(
        "Permintaan atau jawaban diblokir oleh kebijakan keamanan provider AI.",
        502,
        `HTTP 200 ${model} — blockReason=${blockReason}`,
        undefined,
        { category: "blocked" }
      );
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    // Bagian `thought` adalah proses berpikir, bukan jawaban final. Jangan
    // mengirimkannya sebagai jawaban ke pengguna.
    const text = parts
      .filter((part) => part.thought !== true)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();

    const toolCalls: AIToolCall[] = [];
    for (const part of parts) {
      const call = part.functionCall;
      if (!call || typeof call.name !== "string" || !call.name) continue;
      toolCalls.push({
        id: `gemini-${randomUUID()}`,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        },
      });
    }

    if (toolCalls.length === 0 && text.length === 0) {
      const finish = candidate?.finishReason ?? "UNKNOWN";
      throw new AIProviderError(
        finish === "MAX_TOKENS"
          ? "Provider merespons, tetapi batas token habis sebelum jawaban ditulis (termasuk token thinking)."
          : "Provider AI tidak mengembalikan jawaban.",
        502,
        `HTTP 200 ${model} — content kosong, finishReason=${finish}`,
        undefined,
        {
          category:
            finish === "MAX_TOKENS" ? "empty-response" : "invalid-response",
        }
      );
    }

    return { content: text, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}
