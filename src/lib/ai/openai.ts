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
import type { RuntimeAIProviderId } from "./providers";
import {
  MAX_RATE_LIMIT_RETRIES,
  isRetryableRateLimit,
  logRateLimitRetry,
  parseRetryAfterSeconds,
  rateLimitRetryWaitMs,
  sleep,
} from "./rateLimitRetry";

/** Batas waktu untuk satu percobaan ke provider. */
const REQUEST_TIMEOUT_MS = AI_REQUEST_TIMEOUT_MS;
/** Batas waktu total untuk seluruh rangkaian percakapan. */
const TOTAL_BUDGET_MS = AI_TOTAL_BUDGET_MS;
/** Sisa waktu minimum agar satu ronde tool masih dicoba. */
const MIN_ROUND_MS = 4_000;
/** Batas token keluaran. Model reasoning memakai sebagian besar token untuk
 *  `reasoning_content`, sehingga batas kecil membuat `content` kosong. */
const MAX_OUTPUT_TOKENS = 1200;
/**
 * Batas token untuk uji koneksi. Batas 16 token (nilai lama) membuat model
 * reasoning mengembalikan `content` kosong karena seluruh kuota habis untuk
 * proses berpikir — provider yang sehat terlihat seperti gagal. Nilai ini tetap
 * kecil, tetapi cukup untuk satu jawaban pendek setelah reasoning.
 */
const CONNECTION_TEST_MAX_TOKENS = 512;

/**
 * Temperatur rendah untuk jawaban DATA yang harus akurat (nama, judul, tanggal,
 * jam). Nilai tinggi membuat model cenderung menambahkan detail yang tidak ada
 * di hasil fungsi (halusinasi).
 */
const TEMPERATURE = 0.2;

/**
 * Status upstream yang layak dicoba lagi ke model lain.
 * 401/403 tidak termasuk karena itu masalah kredensial, berlaku untuk semua model.
 */
const FALLBACK_STATUSES = new Set([404, 408, 409, 429, 500, 502, 503, 504]);

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
  if (status === 410) {
    return "Model AI sudah tidak didukung provider. Periksa nama model.";
  }
  if (status === 408) {
    return "Provider melaporkan timeout. Timeout bukan bukti API key salah.";
  }
  if (status === 429) {
    return "Batas penggunaan API AI tercapai. Tunggu sebentar lalu coba lagi.";
  }
  if (status >= 500) {
    return "Provider AI sedang mengalami gangguan. Coba lagi sebentar lagi.";
  }
  return `Provider AI menolak permintaan (HTTP ${status}).`;
}

/**
 * Pesan 429 yang lebih spesifik sesuai jenis rate-limit.
 * Tidak memuat API key atau kredensial — hanya informasi diagnostik.
 */
function describeRateLimitError(
  kind: "TPM" | "RPM" | "QUOTA" | "GENERAL",
  retryAfter: number | undefined,
  providerId: string | undefined
): string {
  const providerLabel = providerId ? ` (${providerId})` : "";
  const retryLabel =
    typeof retryAfter === "number" && retryAfter > 0
      ? ` Coba lagi dalam ${retryAfter} detik.`
      : " Tunggu sebentar lalu coba lagi.";
  switch (kind) {
    case "TPM":
      return (
        `Batas token per menit (TPM) model AI${providerLabel} tercapai. ` +
        `Permintaan melebihi kapasitas token model yang dipilih.${retryLabel}`
      );
    case "RPM":
      return (
        `Batas permintaan per menit (RPM) provider AI${providerLabel} tercapai.${retryLabel}`
      );
    case "QUOTA":
      return (
        `Kuota atau kredit akun provider AI${providerLabel} habis. ` +
        `Periksa saldo/kuota akun di dashboard provider.`
      );
    default:
      return `Batas penggunaan API AI${providerLabel} tercapai.${retryLabel}`;
  }
}

/**
 * Klasifikasikan jenis 429 dari body/kode provider.
 * Referensi Groq: https://console.groq.com/docs/rate-limits
 */
function detectRateLimitKind(
  providerError: ParsedProviderError,
  rawBody: string
): "TPM" | "RPM" | "QUOTA" | "GENERAL" {
  const code = (providerError.code ?? "").toLowerCase();
  const type = (providerError.type ?? "").toLowerCase();
  const msg = (providerError.message ?? rawBody).toLowerCase();

  // 1. Kuota/kredit habis (bukan rate-limit sementara)
  if (
    /\b(insufficient_quota|quota_exceeded|exceeded.*quota|credit|billing|payment|usage.*limit.*exceeded)\b/.test(
      msg
    ) ||
    code.includes("quota") ||
    code.includes("billing")
  ) {
    return "QUOTA";
  }

  // 2. Groq / OpenAI TPM: code = "rate_limit_exceeded", type berisi "tokens"
  if (
    /\b(tokens?\s+per\s+minute|tokens?\s+per\s+min|tokens?\s+per\s+day|tpm|tpd|token\s+limit|too\s+many\s+tokens)\b/.test(
      msg
    ) ||
    type.includes("token")
  ) {
    return "TPM";
  }

  // 3. RPM: requests per minute / request rate
  if (
    /\b(requests?\s+per\s+minute|requests?\s+per\s+min|requests?\s+per\s+day|rpm|rpd|request\s+limit)\b/.test(
      msg
    ) ||
    type.includes("request_rate")
  ) {
    return "RPM";
  }

  return "GENERAL";
}

/** Status yang dikirim ke browser. 401/404 upstream TIDAK diteruskan sebagai 401
 * agar browser tidak mengira sesi login pengguna kedaluwarsa. */
function toClientStatus(status: number): number {
  return status === 429 ? 429 : 502;
}

/**
 * Kode error jaringan yang aman dicatat (mis. ECONNRESET/ETIMEDOUT).
 * Tidak pernah mengambil pesan mentah karena bisa memuat URL/header.
 */
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

/** Kategori diagnostik tanpa membocorkan isi respons atau kredensial. */
function errorCategory(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const code = safeErrorCode(error) ?? "";
  if (name === "TimeoutError" || /TIMEOUT|ETIMEDOUT/i.test(code)) return "timeout";
  if (name === "AbortError" || code === "ABORT_ERR") return "abort";
  if (error instanceof AIProviderError) {
    return error.category ?? (error.upstreamStatus ? "http" : "transport");
  }
  return "transport";
}

/** Detail aman untuk log/diagnostik: nama error + kode, tanpa pesan mentah. */
function safeErrorSummary(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const code = safeErrorCode(error);
  return code ? `${name} (${code})` : name;
}

/** Jangan pernah meneruskan API key yang mungkin ter-echo di body error provider. */
function redactSecret(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("[REDACTED]");
}

function safeStringValue(value: unknown, maxLength = 200): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, maxLength);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

interface ParsedProviderError {
  message?: string;
  code?: string;
  type?: string;
  status?: string;
}

/**
 * Ambil metadata error dari body tanpa meneruskan pesan mentah ke UI.
 * Mendukung format OpenAI/Groq/OpenRouter (`error.code`, `error.type`,
 * `error.metadata.error_type`) dan beberapa format provider generik.
 */
function parseProviderError(raw: unknown): ParsedProviderError {
  if (!raw || typeof raw !== "object") return {};
  const root = raw as Record<string, unknown>;
  const error =
    root.error && typeof root.error === "object"
      ? (root.error as Record<string, unknown>)
      : root;
  const metadata =
    error.metadata && typeof error.metadata === "object"
      ? (error.metadata as Record<string, unknown>)
      : undefined;

  return {
    message:
      safeStringValue(error.message) ??
      safeStringValue(root.message) ??
      safeStringValue(error.detail),
    code:
      safeStringValue(error.code) ??
      safeStringValue(metadata?.error_type) ??
      safeStringValue(metadata?.provider_code),
    type:
      safeStringValue(error.type) ??
      safeStringValue(metadata?.error_type),
    status:
      safeStringValue(error.status) ??
      safeStringValue(metadata?.provider_code) ??
      safeStringValue(metadata?.error_type),
  };
}

function parseProviderErrorFromText(raw: string): ParsedProviderError {
  try {
    return parseProviderError(JSON.parse(raw));
  } catch {
    return { message: raw.slice(0, 300) };
  }
}

function providerDiagnostics(error: ParsedProviderError) {
  return {
    category: "http",
    providerCode: error.code,
    providerType: error.type,
    providerStatus: error.status,
  };
}

export interface OpenAIProviderOptions {
  /**
   * Nonaktifkan mode "thinking" model reasoning (mis. Nemotron). Tanpa ini
   * model menghabiskan ribuan token untuk `reasoning_content` sebelum menulis
   * jawaban — lambat (~20 detik) dan sering menghabiskan kuota token sehingga
   * `content` kosong. Default: aktif (thinking OFF) kecuali AI_DISABLE_THINKING=false.
   */
  disableThinking?: boolean;
  /**
   * Kirim `chat_template_kwargs` (khusus NVIDIA NIM). Provider OpenAI-compatible
   * lain (Groq/OpenRouter) tidak boleh menerima parameter khusus ini. Default
   * true untuk kompatibilitas dengan perilaku lama.
   */
  sendThinkingControl?: boolean;
  /**
   * Identitas provider untuk perbedaan kecil pada protokol OpenAI-compatible.
   * Saat ini Groq memakai `max_completion_tokens` (parameter resmi yang
   * menggantikan `max_tokens`), sedangkan NVIDIA/OpenRouter tetap memakai
   * `max_tokens`. Tidak memengaruhi perilaku NVIDIA.
   */
  providerId?: RuntimeAIProviderId;
}

/** Ronde maksimum eksekusi tool sebelum model wajib menulis jawaban akhir. */
const MAX_TOOL_ROUNDS = 2;

/**
 * Jeda sebelum mencoba MODEL BERIKUTNYA setelah 429 (retry model yang sama
 * sudah ditangani `requestRaw`).
 * - TPM: jeda pendek (500ms); batas token per menit tidak akan cepat reset.
 * - RPM: hormati retry-after dari provider (maks 2 detik sebelum fallback).
 * - QUOTA / GENERAL: jeda 500ms saja; fallback model mungkin tidak membantu
 *         kalau kuota akun habis, tapi tidak bisa tahu dari sini.
 */
async function resolveRateLimitDelay(error: unknown): Promise<void> {
  const rlError = error instanceof AIProviderError ? error : null;
  const kind = rlError?.rateLimitKind ?? "GENERAL";
  const retryAfter = rlError?.retryAfter;

  if (kind === "RPM" && typeof retryAfter === "number" && retryAfter > 0) {
    // Hormati saran provider, tapi batasi agar tidak memblokir lama.
    const waitMs = Math.min(retryAfter * 1000, 2_000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } else {
    // TPM / QUOTA / GENERAL: jeda pendek, langsung fallback.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export class OpenAIAIProvider implements AIProvider {
  private apiKey: string;
  private baseURL: string;
  /** Model utama, diikuti model cadangan yang memang terverifikasi bisa dipakai. */
  private models: string[];
  private disableThinking: boolean;
  private sendThinkingControl: boolean;
  private providerId?: RuntimeAIProviderId;

  constructor(
    apiKey: string,
    baseURL = "https://api.openai.com/v1",
    model = "gpt-3.5-turbo",
    fallbackModels: string[] = [],
    options: OpenAIProviderOptions = {}
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL.replace(/\/$/, "");
    this.models = [
      model,
      ...fallbackModels
        .map((m) => m.trim())
        .filter((m) => m.length > 0 && m !== model),
    ];
    this.disableThinking =
      options.disableThinking ?? process.env.AI_DISABLE_THINKING !== "false";
    this.sendThinkingControl = options.sendThinkingControl ?? true;
    this.providerId = options.providerId;
  }

  /**
   * Log diagnostik satu percobaan model. Tidak memuat prompt, pesan pengguna,
   * header Authorization, API key, atau isi respons provider.
   */
  private logAttemptFailure(
    requestId: string,
    model: string,
    attempt: number,
    total: number,
    durationMs: number,
    error: unknown,
    fallbackModel?: string
  ): void {
    const status =
      error instanceof AIProviderError ? error.upstreamStatus : undefined;
    const parts = [
      "[AI] Provider attempt gagal:",
      `requestId=${requestId}`,
      `model=${model}`,
      `attempt=${attempt}/${total}`,
      `durationMs=${durationMs}`,
      `category=${errorCategory(error)}`,
      `status=${status ?? "-"}`,
      `code=${safeErrorCode(error) ?? "-"}`,
    ];
    if (fallbackModel) parts.push(`fallback=${fallbackModel}`);
    console.warn(parts.join(" "));
  }

  private providerName(): string {
    return this.providerId ?? "OPENAI";
  }

  async chat(messages: AIChatMessage[]): Promise<string> {
    return (await this.chatDetailed(messages)).content;
  }

  async chatDetailed(messages: AIChatMessage[]): Promise<AIProviderResult> {
    const startedAt = Date.now();
    const requestId = randomUUID();
    let lastError: unknown = null;

    for (let i = 0; i < this.models.length; i += 1) {
      const model = this.models[i];
      const isLast = i === this.models.length - 1;
      const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);

      if (i > 0 && remaining <= 5_000) {
        console.warn(`[AI] Batas waktu total habis, berhenti sebelum mencoba ${model}.`);
        break;
      }

      const attemptStartedAt = Date.now();
      try {
        const content = await this.request(
          model,
          messages,
          Math.max(5_000, Math.min(REQUEST_TIMEOUT_MS, remaining))
        );
        return { content, provider: this.providerName(), model };
      } catch (error) {
        lastError = error;

        // Status upstream dipakai, bukan status ke browser: error kredensial
        // (401/403) disamarkan jadi 502 sehingga tidak ikut mencoba model lain.
        const upstream = error instanceof AIProviderError ? error.upstreamStatus ?? error.status : 0;
        const canFallback = !isLast && FALLBACK_STATUSES.has(upstream);
        const fallbackModel = canFallback ? this.models[i + 1] : undefined;

        this.logAttemptFailure(
          requestId,
          model,
          i + 1,
          this.models.length,
          Date.now() - attemptStartedAt,
          error,
          fallbackModel
        );

        if (!canFallback) throw error;

        // Batas penggunaan (429) umumnya berlaku per akun, bukan per model.
        // Jeda singkat sebelum mencoba model berikutnya agar tidak menghantam
        // limit yang sama secara beruntun.
        if (upstream === 429) {
          await resolveRateLimitDelay(error);
        }
      }
    }

    throw lastError;
  }

  /**
   * Chat dengan dukungan fungsi (tool-calling). Model memilih fungsi yang
   * sesuai konteks kalimat; server mengeksekusi query database sungguhan lalu
   * mengembalikan hasilnya agar model menyusun jawaban dari data aktual —
   * bukan dari pengetahuan umum.
   *
   * Alur per model: panggilan berulang sampai model menulis jawaban akhir
   * (maksimal MAX_TOOL_ROUNDS+1 ronde) atau gagal, dengan fallback ke model
   * cadangan seperti `chat()`.
   */
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
    const requestId = randomUUID();
    let lastError: unknown = null;
    // Cache hasil tool per request (nama + argumen). Bila model cadangan
    // mengulang panggilan yang sama setelah 429, query database TIDAK
    // dieksekusi dua kali — hasil yang sudah ada dipakai ulang.
    const toolCache = new Map<string, Promise<string>>();
    const memoizedExecute: AIToolExecutor = (name, args) => {
      const key = `${name}:${JSON.stringify(args)}`;
      const cached = toolCache.get(key);
      if (cached) return cached;
      const pending = execute(name, args);
      toolCache.set(key, pending);
      return pending;
    };

    for (let i = 0; i < this.models.length; i += 1) {
      const model = this.models[i];
      const isLast = i === this.models.length - 1;
      const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);

      if (i > 0 && remaining <= 5_000) {
        console.warn(`[AI] Batas waktu total habis, berhenti sebelum mencoba ${model}.`);
        break;
      }

      const attemptStartedAt = Date.now();
      try {
        const content = await this.toolsLoop(
          model,
          messages,
          tools,
          memoizedExecute,
          Math.max(5_000, Math.min(REQUEST_TIMEOUT_MS, remaining))
        );
        return { content, provider: this.providerName(), model };
      } catch (error) {
        lastError = error;

        const upstream = error instanceof AIProviderError ? error.upstreamStatus ?? error.status : 0;
        const canFallback = !isLast && FALLBACK_STATUSES.has(upstream);
        const fallbackModel = canFallback ? this.models[i + 1] : undefined;

        this.logAttemptFailure(
          requestId,
          model,
          i + 1,
          this.models.length,
          Date.now() - attemptStartedAt,
          error,
          fallbackModel
        );

        if (!canFallback) throw error;

        // Backoff yang sama seperti chat(): limit akun butuh jeda.
        if (upstream === 429) {
          await resolveRateLimitDelay(error);
        }
      }
    }

    throw lastError;
  }

  /**
   * Uji koneksi minimal: satu request ke model utama, tanpa fallback dan tanpa
   * tools, dengan batas token sangat kecil. Tidak mengeksekusi fungsi aplikasi.
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
      CONNECTION_TEST_MAX_TOKENS
    );
  }

  /**
   * Satu rangkaian tool-calling untuk satu model. Setiap panggilan tool
   * dieksekusi di server dan hasilnya ditambahkan ke percakapan sebelum
   * panggilan berikutnya.
   *
   * Bila model terus meminta fungsi tanpa menulis jawaban akhir, satu
   * permintaan penutup TANPA tools dikirim agar model merangkum hasil yang
   * sudah terkumpul — pengguna tetap mendapat jawaban dari data nyata,
   * bukan error 502.
   */
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
      const toolCalls = message?.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        if (typeof message?.content !== "string" || message.content.trim() === "") {
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

      // Simpan pesan asli model (beserta tool_calls) agar konteks panggilan
      // tetap utuh untuk provider yang memerlukannya.
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
          // Kegagalan query disampaikan sebagai hasil tool agar model bisa
          // mengatakan data belum dapat diakses — bukan mengklaim kosong.
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
    if (typeof closing?.content === "string" && closing.content.trim() !== "") {
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

  /**
   * Jalankan satu permintaan dengan retry 429 terbatas.
   *
   * Retry dilakukan pada level permintaan HTTP yang SAMA, sehingga ronde
   * tool-calling yang sudah selesai tidak diulang dan hasil tool tidak
   * dieksekusi ulang. Bila sisa waktu tidak cukup untuk menunggu reset,
   * error diteruskan agar fallback model (bila ada) dapat mencoba.
   */
  private async requestRaw(
    model: string,
    messages: AIChatMessage[],
    timeoutMs: number,
    tools?: AIToolDefinition[],
    maxOutputTokens = MAX_OUTPUT_TOKENS
  ): Promise<{ content: string | null; tool_calls?: AIToolCall[] }> {
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
        // Jangan menunggu bila sisa budget tidak cukup untuk satu request.
        if (waitMs + MIN_ROUND_MS > deadline - Date.now()) throw error;
        logRateLimitRetry(
          this.providerId ?? "openai-compatible",
          requestId,
          model,
          attempt + 1,
          waitMs,
          error
        );
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

  /**
   * Kirim satu permintaan (tanpa retry) dan kembalikan pesan model mentah
   * (termasuk tool_calls bila ada). Validasi HTTP/JSON tetap di sini;
   * validasi isi jawaban diserahkan ke pemanggil.
   */
  private async requestRawOnce(
    model: string,
    messages: AIChatMessage[],
    timeoutMs: number,
    tools?: AIToolDefinition[],
    maxOutputTokens = MAX_OUTPUT_TOKENS
  ): Promise<{ content: string | null; tool_calls?: AIToolCall[] }> {
    let response: Response;

    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: TEMPERATURE,
          // Groq mendokumentasikan `max_completion_tokens` sebagai pengganti
          // `max_tokens`. NVIDIA dan OpenRouter tetap memakai `max_tokens`
          // agar perilaku baseline NVIDIA tidak berubah.
          ...(this.providerId === "GROQ"
            ? { max_completion_tokens: maxOutputTokens }
            : { max_tokens: maxOutputTokens }),
          // Model reasoning provider ini mendukung pemadaman mode berpikir.
          // Ini memangkas waktu respons dari ~20s menjadi beberapa detik dan
          // mencegah kuota token habis sebelum jawaban ditulis.
          ...(this.disableThinking && this.sendThinkingControl
            ? { chat_template_kwargs: { enable_thinking: false } }
            : {}),
          ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const code = safeErrorCode(error);
      throw new AIProviderError(
        "Tidak dapat menghubungi provider AI. Periksa koneksi internet server.",
        503,
        error instanceof Error
          ? `${error.name}: ${error.message}${code ? ` (${code})` : ""}`
          : String(error),
        undefined,
        { code, category: errorCategory(error) }
      );
    }

    // Body dapat gagal dibaca setelah header diterima (reset/timeout/abort).
    // Jangan biarkan error transport mentah lolos: petakan ke AIProviderError
    // agar pemanggil tetap memakai kontrak error dan kebijakan fallback.
    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      const summary = safeErrorSummary(error);
      const detail = `HTTP ${response.status} ${model} — body read failed: ${summary}`;
      const diagnostics = {
        code: safeErrorCode(error),
        category: errorCategory(error),
      };

      if (!response.ok) {
        // Status HTTP sudah diterima, jadi pertahankan kategori/status upstream.
        throw new AIProviderError(
          describeUpstreamError(response.status),
          toClientStatus(response.status),
          detail,
          response.status,
          diagnostics
        );
      }

      throw new AIProviderError(
        "Tidak dapat menghubungi provider AI. Periksa koneksi internet server.",
        503,
        detail,
        undefined,
        diagnostics
      );
    }

    if (!response.ok) {
      const providerError = parseProviderErrorFromText(raw);
      const detail = providerError.message || raw.slice(0, 500);
      const codeSuffix = providerError.code ? ` [${providerError.code}]` : "";

      // Untuk 429, baca header waktu tunggu dan klasifikasikan jenis rate-limit
      // agar fallback dan pesan diagnostik bisa disesuaikan.
      if (response.status === 429) {
        const retryAfter = parseRetryAfterSeconds(response.headers);
        const rateLimitKind = detectRateLimitKind(providerError, raw);
        const userMessage = describeRateLimitError(rateLimitKind, retryAfter, this.providerId);
        throw new AIProviderError(
          userMessage,
          429,
          redactSecret(
            `HTTP 429 ${model} [${rateLimitKind}] — ${detail}${codeSuffix}`,
            this.apiKey
          ),
          429,
          {
            ...providerDiagnostics(providerError),
            rateLimitKind,
            retryAfter,
          }
        );
      }

      throw new AIProviderError(
        describeUpstreamError(response.status),
        toClientStatus(response.status),
        redactSecret(
          `HTTP ${response.status} ${model} — ${detail}${codeSuffix}`,
          this.apiKey
        ),
        response.status,
        providerDiagnostics(providerError)
      );
    }

    let data: {
      choices?: {
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
          tool_calls?: AIToolCall[];
        };
        finish_reason?: unknown;
        error?: unknown;
      }[];
      error?: unknown;
    };
    try {
      data = JSON.parse(raw);
    } catch {
      throw new AIProviderError(
        "Respons dari provider AI tidak dapat dibaca.",
        502,
        `HTTP 200 ${model} — body bukan JSON`,
        undefined,
        { category: "invalid-response" }
      );
    }

    // Sebagian provider (terutama agregator seperti OpenRouter) dapat
    // mengembalikan HTTP 200 dengan objek error di body. Jangan menganggapnya
    // sebagai jawaban kosong yang tidak bisa dijelaskan.
    const inlineProviderError = parseProviderError(
      data?.error ?? data?.choices?.[0]?.error
    );
    if (inlineProviderError.message || inlineProviderError.code) {
      const numericStatus =
        inlineProviderError.code && /^\d{3}$/.test(inlineProviderError.code)
          ? Number(inlineProviderError.code)
          : undefined;
      throw new AIProviderError(
        numericStatus === 402
          ? "Kuota atau kredit provider tidak mencukupi."
          : "Provider AI mengembalikan kesalahan pada respons sukses.",
        numericStatus === 402 || numericStatus === 429 ? 429 : 502,
        redactSecret(
          `HTTP 200 ${model} — ${inlineProviderError.message || "error"} ${
            inlineProviderError.code ? `[${inlineProviderError.code}]` : ""
          }`.trim(),
          this.apiKey
        ),
        numericStatus,
        {
          category: "invalid-response",
          providerCode: inlineProviderError.code,
          providerType: inlineProviderError.type,
          providerStatus: inlineProviderError.status,
        }
      );
    }

    const choice = data?.choices?.[0];
    const message = choice?.message;
    const content = message?.content;
    const reasoning = String(message?.reasoning_content ?? "");
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : undefined;
    const hasToolCalls = Boolean(toolCalls && toolCalls.length > 0);
    const finishReason =
      typeof choice?.finish_reason === "string" ? choice.finish_reason : "";

    // Sebagian provider mengembalikan content sebagai array bagian teks.
    const contentText =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part === "object") {
                  const text = (part as { text?: unknown }).text;
                  return typeof text === "string" ? text : "";
                }
                return "";
              })
              .join("")
          : "";

    // Content boleh kosong bila model meminta panggilan fungsi. Tanpa
    // panggilan fungsi, content kosong berarti tidak ada jawaban — atau
    // model reasoning menghabiskan seluruh kuota token untuk
    // reasoning_content sehingga tidak ada jawaban final.
    if (!hasToolCalls && contentText.trim() === "") {
      if (finishReason === "content_filter") {
        throw new AIProviderError(
          "Permintaan atau jawaban diblokir oleh filter keamanan provider.",
          502,
          `HTTP 200 ${model} — finish_reason=content_filter`,
          undefined,
          { category: "blocked" }
        );
      }
      throw new AIProviderError(
        "Provider AI tidak mengembalikan jawaban.",
        502,
        `HTTP 200 ${model} — content kosong, finish_reason=${
          finishReason || "UNKNOWN"
        }, reasoning=${reasoning.length} karakter`,
        undefined,
        { category: "empty-response" }
      );
    }

    return {
      content: contentText,
      tool_calls: toolCalls,
    };
  }

  private async request(
    model: string,
    messages: AIChatMessage[],
    timeoutMs: number
  ): Promise<string> {
    const { content, tool_calls } = await this.requestRaw(model, messages, timeoutMs);
    if (tool_calls && tool_calls.length > 0) {
      // Provider yang tidak mendukung tool-calling tetap bisa mengembalikan
      // tool_calls; anggap sebagai tidak ada jawaban teks.
      throw new AIProviderError(
        "Provider AI tidak mengembalikan jawaban.",
        502,
        `HTTP 200 ${model} — tool_calls tanpa dukungan, content kosong`,
        undefined,
        { category: "invalid-response" }
      );
    }
    // requestRaw menjamin content non-kosong bila tidak ada tool_calls.
    return content ?? "";
  }
}