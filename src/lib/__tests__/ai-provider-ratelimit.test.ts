/**
 * AI Provider — Penanganan Rate Limit (429) & retry otomatis.
 *
 * Memastikan:
 * 1. Pesan 429 dibedakan berdasarkan jenis: TPM, RPM, QUOTA, GENERAL.
 * 2. `retryAfter` dibaca dari header provider.
 * 3. Retry otomatis hanya untuk 429 sementara (bukan QUOTA), dibatasi.
 * 4. Retry berhasil pada model yang sama setelah limit reset.
 * 5. Fallback model tetap berjalan bila retry gagal.
 * 6. Tool tidak dieksekusi dua kali akibat retry/fallback.
 * 7. Provider lain (NVIDIA/OpenRouter) tidak terpengaruh.
 */

import { OpenAIAIProvider } from "@/lib/ai/openai";
import { parseRetryAfterSeconds } from "@/lib/ai/rateLimitRetry";
import { AIProviderError, AIToolDefinition } from "@/lib/ai/types";

const messages = [{ role: "user" as const, content: "Halo" }];

function headerReader(headers: Record<string, string>) {
  return {
    get: (key: string) => headers[key.toLowerCase()] ?? null,
  } as unknown as Headers;
}

// ─── Parsing header reset ────────────────────────────────────────────────────

describe("parseRetryAfterSeconds", () => {
  it("membaca detik numerik", () => {
    expect(parseRetryAfterSeconds(headerReader({ "retry-after": "24" }))).toBe(24);
  });

  it("membaca durasi gaya Groq (7.66s) dan gabungan (1m2.5s)", () => {
    expect(
      parseRetryAfterSeconds(headerReader({ "x-ratelimit-reset-tokens": "7.66s" }))
    ).toBe(8);
    expect(
      parseRetryAfterSeconds(headerReader({ "retry-after": "1m2.5s" }))
    ).toBe(63);
  });

  it("mengabaikan nilai yang bukan durasi valid", () => {
    expect(
      parseRetryAfterSeconds(headerReader({ "retry-after": "nanti saja" }))
    ).toBeUndefined();
  });
});

function responseHeaders(headers: Record<string, string> = {}) {
  return { get: (key: string) => headers[key.toLowerCase()] ?? null };
}

function errorResponse429(
  message: string,
  headers: Record<string, string> = {}
) {
  return {
    ok: false,
    status: 429,
    headers: responseHeaders(headers),
    text: async () => JSON.stringify({ error: { message, type: "rate_limit_exceeded" } }),
  } as unknown as Response;
}

function quotaResponse429(message = "quota exceeded for this billing period") {
  return {
    ok: false,
    status: 429,
    headers: responseHeaders(),
    text: async () =>
      JSON.stringify({ error: { message, type: "insufficient_quota" } }),
  } as unknown as Response;
}

function okResponse(content: string, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: responseHeaders(headers),
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function toolCallResponse(
  name: string,
  args: Record<string, unknown>,
  id = "call-1"
) {
  return {
    ok: true,
    status: 200,
    headers: responseHeaders(),
    text: async () =>
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id,
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
          },
        ],
      }),
  } as unknown as Response;
}

const tools: AIToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_my_history",
      description: "Riwayat peminjaman pengguna",
      parameters: { type: "object", properties: {} },
    },
  },
];

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function calledModels(): string[] {
  return fetchMock.mock.calls.map(
    (c) => JSON.parse((c[1] as { body: string }).body).model
  );
}

async function catchAIError(p: Promise<unknown>): Promise<AIProviderError> {
  try {
    await p;
    throw new Error("Panggilan diharapkan menghasilkan error");
  } catch (e) {
    return e as AIProviderError;
  }
}

/** Jalankan promise sambil memajukan timer palsu (untuk jeda Retry-After). */
async function runWithFakeTimers<T>(promise: Promise<T>, advanceMs = 60_000): Promise<T> {
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error })
  );
  await jest.advanceTimersByTimeAsync(advanceMs);
  const result = await settled;
  if (result.ok) return result.value;
  throw result.error;
}

// ─── Provider normal ─────────────────────────────────────────────────────────

describe("OpenAIAIProvider — provider normal", () => {
  it("NVIDIA normal memakai satu permintaan", async () => {
    fetchMock.mockResolvedValue(okResponse("Halo dari NVIDIA"));

    const provider = new OpenAIAIProvider(
      "key-nvidia",
      "https://integrate.api.nvidia.com/v1",
      "meta/llama-3.2-11b-vision-instruct",
      [],
      { providerId: "NVIDIA" }
    );

    await expect(provider.chat(messages)).resolves.toBe("Halo dari NVIDIA");
    expect(calledModels()).toEqual(["meta/llama-3.2-11b-vision-instruct"]);
  });

  it("Groq normal memakai parameter max_completion_tokens", async () => {
    fetchMock.mockResolvedValue(okResponse("Halo dari Groq"));

    const provider = new OpenAIAIProvider(
      "key-groq",
      "https://api.groq.com/openai/v1",
      "llama-3.3-70b-versatile",
      [],
      { providerId: "GROQ" }
    );

    await expect(provider.chat(messages)).resolves.toBe("Halo dari Groq");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.max_completion_tokens).toBeGreaterThan(0);
    expect(body.max_tokens).toBeUndefined();
  });
});

// ─── Klasifikasi jenis rate-limit ────────────────────────────────────────────

describe("OpenAIAIProvider — klasifikasi 429", () => {
  it("mengidentifikasi error TPM dari pesan provider", async () => {
    fetchMock.mockResolvedValue(
      errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "0" })
    );

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "model-a");

    const err = await catchAIError(provider.chat(messages));
    expect(err).toBeInstanceOf(AIProviderError);
    expect(err.rateLimitKind).toBe("TPM");
    expect(err.message).toMatch(/token per menit|TPM/i);
    expect(err.upstreamStatus).toBe(429);
  });

  it("mengidentifikasi error RPM dari pesan provider", async () => {
    fetchMock.mockResolvedValue(
      errorResponse429("requests per minute rate limit exceeded", { "retry-after": "0" })
    );

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "model-a");

    const err = await catchAIError(provider.chat(messages));
    expect(err.rateLimitKind).toBe("RPM");
    expect(err.message).toMatch(/permintaan per menit|RPM/i);
  });

  it("mengidentifikasi error QUOTA dari pesan provider", async () => {
    fetchMock.mockResolvedValue(quotaResponse429());

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "model-a");

    const err = await catchAIError(provider.chat(messages));
    expect(err.rateLimitKind).toBe("QUOTA");
    expect(err.message).toMatch(/kuota|kredit/i);
  });

  it("menggunakan GENERAL bila jenis tidak dikenali", async () => {
    fetchMock.mockResolvedValue(
      errorResponse429("too many requests", { "retry-after": "0" })
    );

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "model-a");

    const err = await catchAIError(provider.chat(messages));
    expect(err.rateLimitKind).toBe("GENERAL");
  });
});

// ─── Parsing header retry-after ──────────────────────────────────────────────

describe("OpenAIAIProvider — parsing retry-after header", () => {
  it("membaca nilai numerik dari header retry-after", async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(
      errorResponse429("rpm limit", { "retry-after": "5" })
    );

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "model-a");

    const err = await runWithFakeTimers(catchAIError(provider.chat(messages)));
    expect(err.retryAfter).toBe(5);
  });

  it("mengabaikan header retry-after yang tidak valid", async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(
      errorResponse429("rpm limit", { "retry-after": "invalid" })
    );

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "model-a");

    const err = await runWithFakeTimers(catchAIError(provider.chat(messages)));
    expect(err.retryAfter).toBeUndefined();
  });

  it("membaca header x-ratelimit-reset-tokens sebagai fallback", async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(
      errorResponse429("tpm limit", { "x-ratelimit-reset-tokens": "10" })
    );

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "model-a");

    const err = await runWithFakeTimers(catchAIError(provider.chat(messages)));
    expect(err.retryAfter).toBe(10);
  });
});

// ─── Retry otomatis ──────────────────────────────────────────────────────────

describe("OpenAIAIProvider — retry otomatis 429", () => {
  it("retry TPM lalu berhasil pada model yang sama", async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "2" })
      )
      .mockResolvedValueOnce(okResponse("jawaban setelah reset"));

    const provider = new OpenAIAIProvider(
      "key-groq",
      "https://api.groq.com/openai/v1",
      "llama-3.3-70b-versatile",
      [],
      { providerId: "GROQ" }
    );

    const answer = await runWithFakeTimers(provider.chat(messages), 10_000);

    expect(answer).toBe("jawaban setelah reset");
    expect(calledModels()).toEqual([
      "llama-3.3-70b-versatile",
      "llama-3.3-70b-versatile",
    ]);
  });

  it("retry RPM lalu berhasil pada model yang sama", async () => {
    fetchMock
      .mockResolvedValueOnce(
        errorResponse429("requests per minute rate limit exceeded", { "retry-after": "0" })
      )
      .mockResolvedValueOnce(okResponse("jawaban RPM"));

    const provider = new OpenAIAIProvider(
      "key-groq",
      "https://api.groq.com/openai/v1",
      "llama-3.3-70b-versatile",
      [],
      { providerId: "GROQ" }
    );

    await expect(provider.chat(messages)).resolves.toBe("jawaban RPM");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("membatasi retry maksimal 2 kali (total 3 percobaan)", async () => {
    fetchMock.mockResolvedValue(
      errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "0" })
    );

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "primary");

    const err = await catchAIError(provider.chat(messages));

    expect(err.upstreamStatus).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("tidak me-retry 429 kuota habis", async () => {
    fetchMock.mockResolvedValue(quotaResponse429());

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "primary");

    const err = await catchAIError(provider.chat(messages));

    expect(err.rateLimitKind).toBe("QUOTA");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("berpindah ke model cadangan setelah retry TPM gagal", async () => {
    fetchMock
      .mockResolvedValueOnce(
        errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "0" })
      )
      .mockResolvedValueOnce(
        errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "0" })
      )
      .mockResolvedValueOnce(
        errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "0" })
      )
      .mockResolvedValueOnce(okResponse("jawaban dari cadangan"));

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "primary", [
      "fallback",
    ]);

    const answer = await provider.chat(messages);

    expect(answer).toBe("jawaban dari cadangan");
    expect(calledModels()).toEqual(["primary", "primary", "primary", "fallback"]);
  });

  it("semua model gagal menghasilkan error 429 yang jelas", async () => {
    fetchMock.mockResolvedValue(
      errorResponse429("requests per minute rate limit exceeded", { "retry-after": "0" })
    );

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "primary", [
      "fallback",
    ]);

    const err = await catchAIError(provider.chat(messages));

    expect(err).toBeInstanceOf(AIProviderError);
    expect(err.upstreamStatus).toBe(429);
    // 3 percobaan primary + 3 percobaan fallback.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("tidak menjalankan tool dua kali saat fallback model", async () => {
    const execute = jest.fn(async () => JSON.stringify({ total: 1 }));

    fetchMock
      // Model utama: panggil tool, lalu kena 429 pada ronde berikutnya.
      .mockResolvedValueOnce(toolCallResponse("get_my_history", {}))
      .mockResolvedValueOnce(
        errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "0" })
      )
      .mockResolvedValueOnce(
        errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "0" })
      )
      .mockResolvedValueOnce(
        errorResponse429("tokens per minute rate limit exceeded", { "retry-after": "0" })
      )
      // Model cadangan: mengulang tool yang sama, lalu menulis jawaban akhir.
      .mockResolvedValueOnce(toolCallResponse("get_my_history", {}))
      .mockResolvedValueOnce(okResponse("Total pinjaman Anda 1."));

    const provider = new OpenAIAIProvider("key-x", "https://api.test/v1", "primary", [
      "fallback",
    ]);

    const answer = await provider.chatWithTools(messages, tools, execute);

    expect(answer).toBe("Total pinjaman Anda 1.");
    // Query database hanya dieksekusi SEKALI meskipun model berganti.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("get_my_history", {});
  });

  it("tidak bocorkan API key pada pesan error 429", async () => {
    fetchMock.mockResolvedValue(
      errorResponse429("bad key super-secret-api-key", { "retry-after": "0" })
    );

    const provider = new OpenAIAIProvider(
      "super-secret-api-key",
      "https://api.test/v1",
      "primary"
    );

    const err = await catchAIError(provider.chat(messages));

    expect(err.message).not.toContain("super-secret-api-key");
    expect(err.detail).not.toContain("super-secret-api-key");
    expect(err.upstreamStatus).toBe(429);
  });
});

// ─── Provider lain tidak terpengaruh ─────────────────────────────────────────

describe("OpenAIAIProvider — provider lain tidak terpengaruh", () => {
  it("OpenRouter tetap berjalan normal pada respons sukses", async () => {
    fetchMock.mockResolvedValue(okResponse("Halo dari OpenRouter"));

    const provider = new OpenAIAIProvider(
      "key-or",
      "https://openrouter.ai/api/v1",
      "some-model",
      [],
      { providerId: "OPENROUTER" }
    );

    await expect(provider.chat(messages)).resolves.toBe("Halo dari OpenRouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("provider non-Groq yang 429 tetap memiliki rateLimitKind", async () => {
    fetchMock.mockResolvedValue(
      errorResponse429("token per minute limit", { "retry-after": "0" })
    );

    const provider = new OpenAIAIProvider(
      "key-or",
      "https://openrouter.ai/api/v1",
      "some-model",
      [],
      { providerId: "OPENROUTER" }
    );

    const err = await catchAIError(provider.chat(messages));

    expect(err.rateLimitKind).toBeDefined();
    expect(["TPM", "RPM", "QUOTA", "GENERAL"]).toContain(err.rateLimitKind);
  });
});
