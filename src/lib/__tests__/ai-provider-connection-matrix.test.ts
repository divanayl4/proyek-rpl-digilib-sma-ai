/**
 * Matriks uji koneksi per provider (Gemini native, Groq, OpenRouter).
 *
 * Semua request jaringan dimock. Tes ini memastikan:
 * - endpoint, header autentikasi, dan payload sesuai protokol provider;
 * - uji memakai operasi generasi minimal (bukan hanya daftar model);
 * - error provider diklasifikasikan berdasarkan status/kode, bukan teks umum;
 * - API key tidak bocor ke URL, pesan hasil, atau log.
 */

import { testProviderConnection } from "@/lib/ai/connection";
import { GeminiAIProvider } from "@/lib/ai/gemini";
import type { AIConfigValues } from "@/lib/ai/configStore";

const GEMINI_KEY = "AIza-connection-secret-123";
const GROQ_KEY = "gsk_connection_secret_123";
const OPENROUTER_KEY = "sk-or-v1-connection-secret-123";

function values(
  provider: AIConfigValues["provider"],
  model: string
): AIConfigValues {
  const baseUrl =
    provider === "GEMINI"
      ? "https://generativelanguage.googleapis.com/v1beta"
      : provider === "GROQ"
        ? "https://api.groq.com/openai/v1"
        : provider === "OPENROUTER"
          ? "https://openrouter.ai/api/v1"
          : "https://integrate.api.nvidia.com/v1";
  return {
    provider,
    model,
    fallbackModels: [],
    disableThinking: false,
    baseUrl,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function textResponse(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: text } }] }),
  } as unknown as Response;
}

function geminiTextResponse(text: string) {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  });
}

let fetchMock: jest.Mock;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function requestBody(callIndex = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[callIndex][1] as { body: string }).body);
}

function requestInit(callIndex = 0): RequestInit {
  return fetchMock.mock.calls[callIndex][1] as RequestInit;
}

function allLogs(): string {
  return warnSpy.mock.calls.flat().join(" ");
}

describe("Google Gemini — uji koneksi native", () => {
  const config = values("GEMINI", "gemini-2.5-flash");

  it("mengirim generateContent dengan header x-goog-api-key dan payload native", async () => {
    fetchMock.mockResolvedValue(geminiTextResponse("pong"));

    const outcome = await testProviderConnection(config, GEMINI_KEY);

    expect(outcome).toMatchObject({
      ok: true,
      category: "SUCCESS",
      provider: "GEMINI",
      model: "gemini-2.5-flash",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(String(url)).not.toContain(GEMINI_KEY);
    expect(String(url)).not.toContain("key=");
    expect(requestInit().headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_KEY,
    });

    const body = requestBody();
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "ping" }] }]);
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 2048 });
    expect(body.tools).toBeUndefined();
    expect(allLogs()).not.toContain(GEMINI_KEY);
  });

  it("mengklasifikasikan API_KEY_INVALID sebagai AUTH, bukan model", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: `API key not valid. ${GEMINI_KEY}`,
            details: [{ reason: "API_KEY_INVALID" }],
          },
        },
        400
      )
    );

    const outcome = await testProviderConnection(config, GEMINI_KEY);

    expect(outcome).toMatchObject({ ok: false, category: "AUTH", httpStatus: 400 });
    expect(outcome.message).not.toContain(GEMINI_KEY);
    expect(allLogs()).not.toContain(GEMINI_KEY);
  });

  it("mengklasifikasikan model tidak ditemukan sebagai MODEL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 404,
            status: "NOT_FOUND",
            message: "models/tidak-ada is not found for API version v1beta",
          },
        },
        404
      )
    );

    const outcome = await testProviderConnection(config, GEMINI_KEY);
    expect(outcome).toMatchObject({ ok: false, category: "MODEL", httpStatus: 404 });
  });

  it("membedakan kuota (RESOURCE_EXHAUSTED) dari rate limit biasa", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "You exceeded your current quota. Check billing details.",
          },
        },
        429
      )
    );

    const outcome = await testProviderConnection(config, GEMINI_KEY);
    expect(outcome).toMatchObject({ ok: false, category: "QUOTA", httpStatus: 429 });
  });

  it("memetakan timeout transport ke TIMEOUT tanpa menuduh API key", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TimeoutError" })
    );

    const outcome = await testProviderConnection(config, GEMINI_KEY);
    expect(outcome.category).toBe("TIMEOUT");
    expect(outcome.message.toLowerCase()).toContain("bukan bukti api key salah");
  });

  it("menolak respons sukses yang bukan JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>gateway</html>",
    } as unknown as Response);

    const outcome = await testProviderConnection(config, GEMINI_KEY);
    expect(outcome.category).toBe("INVALID_RESPONSE");
  });

  it("menjelaskan respons kosong karena MAX_TOKENS, bukan API key salah", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
      })
    );

    const outcome = await testProviderConnection(config, GEMINI_KEY);
    expect(outcome.category).toBe("INVALID_RESPONSE");
    expect(outcome.message.toLowerCase()).toContain("token");
    expect(outcome.message.toLowerCase()).not.toContain("api key salah");
  });

  it("tidak mengembalikan bagian thought sebagai jawaban final", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: "proses berpikir internal", thought: true },
                { text: "jawaban final" },
              ],
            },
            finishReason: "STOP",
          },
        ],
      })
    );

    const provider = new GeminiAIProvider(
      GEMINI_KEY,
      config.baseUrl,
      config.model
    );
    await expect(provider.chat([{ role: "user", content: "Halo" }])).resolves.toBe(
      "jawaban final"
    );
  });
});

describe("Groq — uji koneksi Chat Completions", () => {
  const config = values("GROQ", "llama-3.1-8b-instant");

  it("memakai endpoint resmi, Bearer, max_completion_tokens, dan tanpa parameter NVIDIA", async () => {
    fetchMock.mockResolvedValue(textResponse("pong"));

    const outcome = await testProviderConnection(config, GROQ_KEY);
    expect(outcome).toMatchObject({ ok: true, provider: "GROQ" });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(String(url)).not.toContain(GROQ_KEY);
    expect(requestInit().headers).toMatchObject({
      Authorization: `Bearer ${GROQ_KEY}`,
    });

    const body = requestBody();
    expect(body.model).toBe("llama-3.1-8b-instant");
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(body.max_completion_tokens).toBe(512);
    expect(body.max_tokens).toBeUndefined();
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(allLogs()).not.toContain(GROQ_KEY);
  });

  it("mengklasifikasikan 401 sebagai AUTH", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "Invalid API Key",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        },
        401
      )
    );

    const outcome = await testProviderConnection(config, GROQ_KEY);
    expect(outcome).toMatchObject({ ok: false, category: "AUTH", httpStatus: 401 });
    expect(outcome.message).not.toContain(GROQ_KEY);
  });

  it("mengklasifikasikan model_not_found sebagai MODEL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "The model `tidak-ada` does not exist",
            type: "invalid_request_error",
            code: "model_not_found",
          },
        },
        400
      )
    );

    const outcome = await testProviderConnection(config, GROQ_KEY);
    expect(outcome).toMatchObject({ ok: false, category: "MODEL", httpStatus: 400 });
  });

  it("mengklasifikasikan rate limit sebagai RATE_LIMIT", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "Rate limit reached",
            type: "rate_limit_exceeded",
            code: "rate_limit_exceeded",
          },
        },
        429
      )
    );

    const outcome = await testProviderConnection(config, GROQ_KEY);
    expect(outcome).toMatchObject({
      ok: false,
      category: "RATE_LIMIT",
      httpStatus: 429,
    });
  });

  it("memetakan timeout ke TIMEOUT", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TimeoutError" })
    );

    const outcome = await testProviderConnection(config, GROQ_KEY);
    expect(outcome.category).toBe("TIMEOUT");
  });

  it("memetakan gangguan server provider ke PROVIDER_UNAVAILABLE", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "upstream unavailable" } }, 503)
    );

    const outcome = await testProviderConnection(config, GROQ_KEY);
    expect(outcome).toMatchObject({
      ok: false,
      category: "PROVIDER_UNAVAILABLE",
      httpStatus: 503,
    });
  });

  it("menjelaskan content kosong dari model reasoning", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: { content: "", reasoning_content: "x".repeat(100) },
            finish_reason: "length",
          },
        ],
      })
    );

    const outcome = await testProviderConnection(config, GROQ_KEY);
    expect(outcome.category).toBe("INVALID_RESPONSE");
    expect(outcome.message.toLowerCase()).toContain("token");
  });
});

describe("OpenRouter — uji koneksi Chat Completions", () => {
  const config = values("OPENROUTER", "openai/gpt-4o-mini");

  it("memakai endpoint resmi, Bearer, dan identifier model vendor/model", async () => {
    fetchMock.mockResolvedValue(textResponse("pong"));

    const outcome = await testProviderConnection(config, OPENROUTER_KEY);
    expect(outcome).toMatchObject({
      ok: true,
      provider: "OPENROUTER",
      model: "openai/gpt-4o-mini",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(String(url)).not.toContain(OPENROUTER_KEY);
    expect(requestInit().headers).toMatchObject({
      Authorization: `Bearer ${OPENROUTER_KEY}`,
    });

    const body = requestBody();
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(body.max_tokens).toBe(512);
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(allLogs()).not.toContain(OPENROUTER_KEY);
  });

  it("mengklasifikasikan 401 sebagai AUTH", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 401, message: "Unauthorized" } }, 401)
    );

    const outcome = await testProviderConnection(config, OPENROUTER_KEY);
    expect(outcome).toMatchObject({ ok: false, category: "AUTH", httpStatus: 401 });
    expect(outcome.message).not.toContain(OPENROUTER_KEY);
  });

  it("mengklasifikasikan model tanpa endpoint sebagai MODEL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 404,
            message: "No endpoints found for model",
            metadata: { error_type: "model_not_found" },
          },
        },
        404
      )
    );

    const outcome = await testProviderConnection(config, OPENROUTER_KEY);
    expect(outcome).toMatchObject({ ok: false, category: "MODEL", httpStatus: 404 });
  });

  it("mengklasifikasikan 402 insufficient credits sebagai QUOTA", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 402,
            message: "Insufficient credits",
            metadata: { error_type: "payment_required" },
          },
        },
        402
      )
    );

    const outcome = await testProviderConnection(config, OPENROUTER_KEY);
    expect(outcome).toMatchObject({ ok: false, category: "QUOTA", httpStatus: 402 });
  });

  it("mengklasifikasikan error upstream 429 sebagai RATE_LIMIT", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 429,
            message: "Rate limit exceeded",
            metadata: {
              error_type: "rate_limit_exceeded",
              provider_code: "rate_limited",
            },
          },
        },
        429
      )
    );

    const outcome = await testProviderConnection(config, OPENROUTER_KEY);
    expect(outcome).toMatchObject({
      ok: false,
      category: "RATE_LIMIT",
      httpStatus: 429,
    });
  });

  it("menangani error provider yang dikirim dengan HTTP 200", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        error: {
          code: 404,
          message: "No endpoints found for model",
          metadata: { error_type: "model_not_found" },
        },
      })
    );

    const outcome = await testProviderConnection(config, OPENROUTER_KEY);
    expect(outcome).toMatchObject({ ok: false, category: "MODEL" });
    expect(outcome.message).not.toContain(OPENROUTER_KEY);
  });

  it("memetakan timeout ke TIMEOUT", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TimeoutError" })
    );

    const outcome = await testProviderConnection(config, OPENROUTER_KEY);
    expect(outcome.category).toBe("TIMEOUT");
    expect(outcome.message.toLowerCase()).toContain("bukan bukti api key salah");
  });
});
