/**
 * Adapter Google Gemini native — format request/response, function calling,
 * timeout, fallback model, dan redaksi API key. Tidak memanggil jaringan nyata.
 */

import { GeminiAIProvider } from "@/lib/ai/gemini";
import { AIProviderError, type AIChatMessage, type AIToolDefinition } from "@/lib/ai/types";

const API_KEY = "AIza-super-secret-gemini-key";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const messages: AIChatMessage[] = [{ role: "user", content: "Halo" }];

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function textResponse(text: string) {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  });
}

function functionCallResponse(name: string, args: Record<string, unknown>) {
  return jsonResponse({
    candidates: [
      {
        content: { parts: [{ functionCall: { name, args } }] },
        finishReason: "STOP",
      },
    ],
  });
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

function requestBody(callIndex = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[callIndex][1] as { body: string }).body);
}

describe("GeminiAIProvider — format request", () => {
  it("memakai generateContent, header x-goog-api-key, dan tanpa key pada URL", async () => {
    fetchMock.mockResolvedValue(textResponse("Hai!"));

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");
    await expect(provider.chat(messages)).resolves.toBe("Hai!");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${BASE_URL}/models/gemini-2.0-flash:generateContent`
    );
    expect(String(url)).not.toContain(API_KEY);
    expect(String(url)).not.toContain("key=");
    expect((init as { headers: Record<string, string> }).headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY,
    });
  });

  it("memisahkan system prompt ke systemInstruction dan memetakan role", async () => {
    fetchMock.mockResolvedValue(textResponse("ok"));

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "models/gemini-2.0-flash");
    await provider.chat([
      { role: "system", content: "Kamu asisten perpustakaan." },
      { role: "user", content: "Halo" },
      { role: "assistant", content: "Hai, ada yang bisa dibantu?" },
      { role: "user", content: "Buku apa saja?" },
    ]);

    const body = requestBody();
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "Kamu asisten perpustakaan." }],
    });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Halo" }] },
      { role: "model", parts: [{ text: "Hai, ada yang bisa dibantu?" }] },
      { role: "user", parts: [{ text: "Buku apa saja?" }] },
    ]);
    expect(body.generationConfig).toMatchObject({
      temperature: expect.any(Number),
      maxOutputTokens: expect.any(Number),
    });
  });

  it("membuang prefix models/ dari nama model", async () => {
    fetchMock.mockResolvedValue(textResponse("ok"));

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "models/gemini-2.0-flash");
    await provider.chat(messages);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/models/gemini-2.0-flash:generateContent`
    );
  });
});

describe("GeminiAIProvider — function calling", () => {
  const tools: AIToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "catalog_stats",
        description: "Statistik katalog",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  it("mengirim functionDeclarations lalu mengembalikan hasil tool sebagai functionResponse", async () => {
    fetchMock
      .mockResolvedValueOnce(
        functionCallResponse("catalog_stats", { category: "buku" })
      )
      .mockResolvedValueOnce(textResponse("Ada 4 judul buku."));

    const execute = jest.fn(async () => JSON.stringify({ totalTitles: 4 }));
    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");

    await expect(provider.chatWithTools(messages, tools, execute)).resolves.toBe(
      "Ada 4 judul buku."
    );

    expect(execute).toHaveBeenCalledWith("catalog_stats", { category: "buku" });

    const first = requestBody(0);
    expect(first.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "catalog_stats",
            description: "Statistik katalog",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
    ]);
    expect(first.toolConfig).toEqual({
      functionCallingConfig: { mode: "AUTO" },
    });

    const second = requestBody(1);
    const contents = second.contents as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
    expect(contents).toHaveLength(3);
    expect(contents[1]).toMatchObject({
      role: "model",
      parts: [{ functionCall: { name: "catalog_stats", args: { category: "buku" } } }],
    });
    expect(contents[2]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: "catalog_stats",
            response: { totalTitles: 4 },
          },
        },
      ],
    });
  });

  it("mengubah error executor menjadi functionResponse error, bukan crash", async () => {
    fetchMock
      .mockResolvedValueOnce(functionCallResponse("catalog_stats", {}))
      .mockResolvedValueOnce(textResponse("Maaf, data gagal dimuat."));

    const execute = jest.fn(async () => {
      throw new Error("DB down");
    });
    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");

    await provider.chatWithTools(messages, tools, execute);

    const contents = requestBody(1).contents as Array<{
      parts: Array<Record<string, unknown>>;
    }>;
    expect(contents[2].parts[0]).toMatchObject({
      functionResponse: { name: "catalog_stats", response: { error: "DB down" } },
    });
  });

  it("menolak functionCall pada chat tanpa tools", async () => {
    fetchMock.mockResolvedValue(functionCallResponse("catalog_stats", {}));

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");

    await expect(provider.chat(messages)).rejects.toMatchObject({
      name: "AIProviderError",
      category: "invalid-response",
      status: 502,
    });
  });
});

describe("GeminiAIProvider — error, fallback, timeout", () => {
  it("memetakan 401 ke pesan API key tanpa membocorkan key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: `bad key ${API_KEY}` } }, 401)
    );

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");
    try {
      await provider.chat(messages);
      throw new Error("harusnya gagal");
    } catch (error) {
      const e = error as AIProviderError;
      expect(e).toMatchObject({
        name: "AIProviderError",
        status: 502,
        upstreamStatus: 401,
        category: "http",
      });
      expect(e.message).toContain("API key");
      expect(e.detail).not.toContain(API_KEY);
      expect(e.detail).toContain("[REDACTED]");
    }
  });

  it("berpindah ke model fallback saat 404", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: "not found" } }, 404))
      .mockResolvedValueOnce(textResponse("Halo dari fallback"));

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-utama", [
      "gemini-cadangan",
    ]);

    await expect(provider.chat(messages)).resolves.toBe("Halo dari fallback");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${BASE_URL}/models/gemini-utama:generateContent`,
      `${BASE_URL}/models/gemini-cadangan:generateContent`,
    ]);
  });

  it("TIDAK memakai fallback saat API key ditolak", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "unauthorized" } }, 401));

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-utama", [
      "gemini-cadangan",
    ]);

    await expect(provider.chat(messages)).rejects.toMatchObject({
      upstreamStatus: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("memetakan timeout transport ke 503 category timeout", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(
      Object.assign(new Error("timed out"), {
        name: "TimeoutError",
        cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
      })
    );

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");

    await expect(provider.chat(messages)).rejects.toMatchObject({
      name: "AIProviderError",
      status: 503,
      category: "timeout",
    });
  });

  it("menolak respons tanpa teks/functionCall", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
      })
    );

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");

    await expect(provider.chat(messages)).rejects.toMatchObject({
      name: "AIProviderError",
      status: 502,
      category: "empty-response",
    });
  });

  it("menolak prompt yang diblokir kebijakan provider", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ promptFeedback: { blockReason: "SAFETY" } })
    );

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");

    await expect(provider.chat(messages)).rejects.toMatchObject({
      name: "AIProviderError",
      category: "blocked",
    });
  });

  it("testConnection hanya mengirim prompt ping dengan token kecil dan tanpa tools", async () => {
    fetchMock.mockResolvedValue(textResponse("pong"));

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");
    await provider.testConnection();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = requestBody(0);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "ping" }] }]);
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 2048 });
    expect(body.tools).toBeUndefined();
  });

  it("retry 429 sementara lalu berhasil pada model yang sama", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message: "tokens per minute rate limit exceeded",
              status: "RESOURCE_EXHAUSTED",
            },
          },
          429,
          { "retry-after": "0" }
        )
      )
      .mockResolvedValueOnce(textResponse("Halo setelah retry"));

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");

    await expect(provider.chat(messages)).resolves.toBe("Halo setelah retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${BASE_URL}/models/gemini-2.0-flash:generateContent`,
      `${BASE_URL}/models/gemini-2.0-flash:generateContent`,
    ]);
  });

  it("tidak me-retry 429 kuota/billing yang permanen", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "billing quota exceeded for this project",
            status: "RESOURCE_EXHAUSTED",
          },
        },
        429
      )
    );

    const provider = new GeminiAIProvider(API_KEY, BASE_URL, "gemini-2.0-flash");

    await expect(provider.chat(messages)).rejects.toMatchObject({
      upstreamStatus: 429,
      rateLimitKind: "QUOTA",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
