export interface AIChatMessageBookRef {
  id: string;
  title: string;
  author?: string;
  available?: number | null;
}

export interface AIChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Hanya untuk pesan assistant yang meminta eksekusi fungsi. */
  tool_calls?: AIToolCall[];
  /** Hanya untuk pesan tool: id panggilan yang dijawab. */
  tool_call_id?: string;
  /**
   * Referensi buku dari jawaban katalog/detail sebelumnya (opsional, in-request).
   * Dipakai untuk mengikat pertanyaan lanjutan ke entitas buku spesifik tanpa
   * mengubah makna jawaban yang sudah diberikan.
   */
  references?: AIChatMessageBookRef[];
}

/** Satu panggilan fungsi yang diminta model. */
export interface AIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** Argumen sebagai string JSON ( sesuai format OpenAI ). */
    arguments: string;
  };
}

/** Hasil eksekusi satu tool, dikirim kembali ke model sebagai pesan `tool`. */
export interface AIToolResult {
  tool_call_id: string;
  role: "tool";
  content: string;
}

/** Definisi fungsi yang boleh dipakai model (skema JSON OpenAI). */
export interface AIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** Executor tool di server. Menerima nama + argumen JSON, mengembalikan teks.
 *  `userId` diikat oleh pemanggil (route) sebelum executor ini diteruskan. */
export type AIToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<string>;

/**
 * Identitas provider/model yang BENAR-BENAR menghasilkan sebuah respons.
 *
 * Nilai ini dikembalikan bersama hasil respons (bukan disimpan pada state
 * global), sehingga dua request bersamaan tidak dapat saling menimpa
 * identitas model.
 */
export interface AIResponseIdentity {
  /** ID provider runtime, mis. NVIDIA / OPENROUTER / GEMINI. */
  provider: string;
  /** Model yang benar-benar menjawab, termasuk bila model cadangan dipakai. */
  model: string;
  /**
   * True bila respons berasal dari kandidat cadangan (provider/model berbeda
   * dari konfigurasi utama request ini), sehingga pemanggil dapat
   * mengungkapkannya alih-alih diam-diam mengganti pilihan pengguna.
   */
  fallbackUsed?: boolean;
  /** Provider yang dikonfigurasi sebagai utama pada request ini. */
  primaryProvider?: string;
  /** Model yang dikonfigurasi sebagai utama pada request ini. */
  primaryModel?: string;
}

/** Hasil lengkap satu pemanggilan provider beserta identitasnya. */
export interface AIProviderResult extends AIResponseIdentity {
  content: string;
}

export interface AIProvider {
  chat(messages: AIChatMessage[]): Promise<string>;
  /**
   * Sama seperti `chat`, tetapi model boleh memakai fungsi (tool-calling).
   * Provider yang tidak mendukung cukup tidak mengimplementasikannya dan route
   * akan kembali ke `chat` biasa.
   */
  chatWithTools?(
    messages: AIChatMessage[],
    tools: AIToolDefinition[],
    execute: AIToolExecutor
  ): Promise<string>;
  /**
   * Varian `chat` yang mengembalikan provider/model aktual. Diimplementasikan
   * oleh provider nyata dan `FallbackAIProvider`; pemanggil TIDAK boleh membaca
   * identitas dari state global.
   */
  chatDetailed?(messages: AIChatMessage[]): Promise<AIProviderResult>;
  /** Varian `chatWithTools` yang mengembalikan provider/model aktual. */
  chatWithToolsDetailed?(
    messages: AIChatMessage[],
    tools: AIToolDefinition[],
    execute: AIToolExecutor
  ): Promise<AIProviderResult>;
  /**
   * Uji koneksi minimal ke model utama (tanpa fallback, tanpa tools).
   * Dipakai halaman Konfigurasi AI; TIDAK boleh mengeksekusi tool aplikasi.
   */
  testConnection?(): Promise<void>;
}

/**
 * Marker pembatas blok konteks katalog di dalam system prompt.
 * Dipakai penyusun prompt agar blok data katalog mudah dikenali.
 */
export const CATALOG_CONTEXT_MARKER = "KONTEKS KATALOG";

/**
 * Error yang berasal dari provider AI (bukan dari aplikasi kita).
 * `message` aman ditampilkan ke user, `detail` hanya untuk log server.
 */
export class AIProviderError extends Error {
  readonly status: number;
  readonly detail: string;
  /** Status asli dari provider. Berbeda dari `status` yang dikirim ke browser. */
  readonly upstreamStatus?: number;
  /** Kode transport yang aman (mis. ECONNRESET), bila tersedia. */
  readonly code?: string;
  /** Kategori diagnostik: transport/timeout/abort/http/invalid-response. */
  readonly category?: string;
  /**
   * Kode error milik provider (mis. `model_not_found`, `API_KEY_INVALID`).
   * Aman untuk diagnostik internal; tidak pernah berisi secret.
   */
  readonly providerCode?: string;
  /** Tipe/status error provider (mis. `invalid_request_error`, `PERMISSION_DENIED`). */
  readonly providerType?: string;
  /** Status tekstual provider (mis. `RESOURCE_EXHAUSTED`, `NOT_FOUND`). */
  readonly providerStatus?: string;
  /**
   * Jenis rate-limit: TPM (token per menit), RPM (request per menit),
   * QUOTA (kuota/kredit akun habis), atau GENERAL (tidak terklasifikasi).
   * Hanya diisi untuk error HTTP 429.
   */
  readonly rateLimitKind?: "TPM" | "RPM" | "QUOTA" | "GENERAL";
  /**
   * Waktu tunggu yang disarankan provider sebelum mencoba ulang (detik).
   * Dibaca dari header `retry-after` atau header rate-limit provider.
   */
  readonly retryAfter?: number;

  constructor(
    message: string,
    status = 502,
    detail = "",
    upstreamStatus?: number,
    diagnostics?: {
      code?: string;
      category?: string;
      providerCode?: string;
      providerType?: string;
      providerStatus?: string;
      rateLimitKind?: "TPM" | "RPM" | "QUOTA" | "GENERAL";
      retryAfter?: number;
    }
  ) {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
    this.detail = detail;
    this.upstreamStatus = upstreamStatus;
    this.code = diagnostics?.code;
    this.category = diagnostics?.category;
    this.providerCode = diagnostics?.providerCode;
    this.providerType = diagnostics?.providerType;
    this.providerStatus = diagnostics?.providerStatus;
    this.rateLimitKind = diagnostics?.rateLimitKind;
    this.retryAfter = diagnostics?.retryAfter;
    Object.setPrototypeOf(this, AIProviderError.prototype);
  }
}

export function isAIProviderError(error: unknown): error is AIProviderError {
  return (
    error instanceof AIProviderError ||
    (error instanceof Error && error.name === "AIProviderError")
  );
}
