/**
 * Uji koneksi & daftar model — klasifikasi error provider dan keamanan request.
 * Tidak ada panggilan jaringan nyata.
 */

const mockBuildAIProvider = jest.fn();

jest.mock("@/lib/ai/index", () => ({
  buildAIProvider: (...args: unknown[]) => mockBuildAIProvider(...args),
}));

import {
  listProviderModels,
  ModelListError,
  testProviderConnection,
} from "@/lib/ai/connection";
import { AIProviderError } from "@/lib/ai/types";
import type { AIConfigValues } from "@/lib/ai/configStore";

const values: AIConfigValues = {
  provider: "NVIDIA",
  model: "meta/llama-3.1-8b-instruct",
  fallbackModels: [],
  disableThinking: true,
  baseUrl: "https://integrate.api.nvidia.com/v1",
};

const API_KEY = "nvapi-connection-secret";

function providerThatRejects(error: unknown) {
  return { testConnection: jest.fn(async () => Promise.reject(error)) };
}

beforeEach(() => {
  mockBuildAIProvider.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("testProviderConnection — klasifikasi", () => {
  it("mengembalikan SUCCESS dan tidak memakai fallback/tools", async () => {
    const testConnection = jest.fn(async () => undefined);
    mockBuildAIProvider.mockReturnValue({ testConnection });

    const outcome = await testProviderConnection(values, API_KEY);

    expect(outcome).toMatchObject({
      ok: true,
      category: "SUCCESS",
      provider: "NVIDIA",
      model: values.model,
    });
    expect(mockBuildAIProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "NVIDIA",
        fallbackModels: [],
        apiKey: API_KEY,
      })
    );
  });

  it.each([
    [new AIProviderError("x", 502, "HTTP 401", 401, { category: "http" }), "AUTH"],
    [new AIProviderError("x", 502, "HTTP 403", 403, { category: "http" }), "AUTH"],
    [new AIProviderError("x", 502, "HTTP 404", 404, { category: "http" }), "MODEL"],
    [
      new AIProviderError("x", 502, "HTTP 400", 400, { category: "http" }),
      "INVALID_REQUEST",
    ],
    [
      new AIProviderError(
        "x",
        502,
        "HTTP 400 API key not valid. Please pass a valid API key.",
        400,
        { category: "http" }
      ),
      "AUTH",
    ],
    [new AIProviderError("x", 402, "HTTP 402 payment required", 402, { category: "http" }), "QUOTA"],
    [new AIProviderError("x", 429, "HTTP 429", 429, { category: "http" }), "RATE_LIMIT"],
    [
      new AIProviderError("x", 429, "HTTP 429 insufficient quota", 429, {
        category: "http",
      }),
      "QUOTA",
    ],
    [
      new AIProviderError("x", 502, "HTTP 500", 500, { category: "http" }),
      "PROVIDER_UNAVAILABLE",
    ],
    [
      new AIProviderError("x", 503, "TimeoutError", undefined, {
        category: "timeout",
      }),
      "TIMEOUT",
    ],
    [
      new AIProviderError("x", 503, "ECONNRESET", undefined, {
        category: "transport",
      }),
      "NETWORK",
    ],
    [
      new AIProviderError("x", 502, "body bukan JSON", undefined, {
        category: "invalid-response",
      }),
      "INVALID_RESPONSE",
    ],
    [
      new AIProviderError("x", 502, "content kosong", undefined, {
        category: "empty-response",
      }),
      "INVALID_RESPONSE",
    ],
  ])("memetakan error %# ke kategori yang tepat", async (error, category) => {
    mockBuildAIProvider.mockReturnValue(providerThatRejects(error));

    const outcome = await testProviderConnection(values, API_KEY);

    expect(outcome.ok).toBe(false);
    expect(outcome.category).toBe(category);
    expect(outcome.message).not.toContain(API_KEY);
  });

  it.each([
    [
      new AIProviderError("x", 502, "HTTP 400 — API key not valid", 400, {
        category: "http",
        providerCode: "API_KEY_INVALID",
        providerType: "INVALID_ARGUMENT",
      }),
      "AUTH",
    ],
    [
      new AIProviderError("x", 429, "HTTP 429 — RESOURCE_EXHAUSTED", 429, {
        category: "http",
        providerStatus: "RESOURCE_EXHAUSTED",
      }),
      "QUOTA",
    ],
    [
      new AIProviderError("x", 502, "HTTP 400 — model_not_found", 400, {
        category: "http",
        providerCode: "model_not_found",
      }),
      "MODEL",
    ],
    [
      new AIProviderError("x", 502, "HTTP 400 — invalid_request_error", 400, {
        category: "http",
        providerType: "invalid_request_error",
      }),
      "INVALID_REQUEST",
    ],
    [
      new AIProviderError("x", 429, "HTTP 429 — rate_limit_exceeded", 429, {
        category: "http",
        providerType: "rate_limit_exceeded",
      }),
      "RATE_LIMIT",
    ],
    [
      new AIProviderError("x", 502, "HTTP 200 — model_not_found", undefined, {
        category: "invalid-response",
        providerCode: "model_not_found",
      }),
      "MODEL",
    ],
    [
      new AIProviderError("x", 503, "DEADLINE_EXCEEDED", undefined, {
        category: "transport",
        providerStatus: "DEADLINE_EXCEEDED",
      }),
      "TIMEOUT",
    ],
    [
      new AIProviderError(
        "x",
        502,
        "HTTP 200 — content kosong, finish_reason=MAX_TOKENS",
        undefined,
        { category: "empty-response" }
      ),
      "INVALID_RESPONSE",
    ],
  ])("memakai kode/status provider untuk klasifikasi %#", async (error, category) => {
    mockBuildAIProvider.mockReturnValue(providerThatRejects(error));

    const outcome = await testProviderConnection(values, API_KEY);

    expect(outcome.ok).toBe(false);
    expect(outcome.category).toBe(category);
    expect(outcome.message).not.toContain(API_KEY);
  });

  it("tidak memberi label AUTH untuk timeout", async () => {
    mockBuildAIProvider.mockReturnValue(
      providerThatRejects(
        new AIProviderError("x", 503, "TimeoutError", undefined, {
          category: "timeout",
        })
      )
    );

    const outcome = await testProviderConnection(values, API_KEY);
    expect(outcome.category).toBe("TIMEOUT");
    expect(outcome.message.toLowerCase()).toContain("bukan bukti api key salah");
  });

  it("menolak API key kosong tanpa memanggil provider", async () => {
    const outcome = await testProviderConnection(values, "   ");
    expect(outcome).toMatchObject({ ok: false, category: "INVALID_CONFIG" });
    expect(mockBuildAIProvider).not.toHaveBeenCalled();
  });

  it("log kegagalan tidak memuat API key", async () => {
    mockBuildAIProvider.mockReturnValue(
      providerThatRejects(
        new AIProviderError(`gagal ${API_KEY}`, 502, `detail ${API_KEY}`, 401)
      )
    );

    await testProviderConnection(values, API_KEY);

    const logText = (console.warn as unknown as jest.Mock).mock.calls
      .flat()
      .join(" ");
    expect(logText).not.toContain(API_KEY);
  });
});

describe("listProviderModels", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("Gemini memakai header x-goog-api-key dan memfilter generateContent", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          models: [
            { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
            { name: "models/gemini-1.5-flash" },
          ],
        }),
    } as unknown as Response);

    const result = await listProviderModels(
      {
        ...values,
        provider: "GEMINI",
        model: "gemini-2.0-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
      API_KEY
    );

    expect(result.models).toEqual(["gemini-1.5-flash", "gemini-2.0-flash"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain(API_KEY);
    expect((init as { headers: Record<string, string> }).headers).toEqual({
      "x-goog-api-key": API_KEY,
    });
  });

  it("provider OpenAI-compatible memakai Bearer dan mengurutkan model unik", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [{ id: "b" }, { id: "a" }, { id: "a" }, { id: "" }],
        }),
    } as unknown as Response);

    const result = await listProviderModels(values, API_KEY);

    expect(result.models).toEqual(["a", "b"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://integrate.api.nvidia.com/v1/models");
    expect((init as { headers: Record<string, string> }).headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
    });
  });

  it("memetakan 401 ke ModelListError AUTH", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    } as unknown as Response);

    await expect(listProviderModels(values, API_KEY)).rejects.toMatchObject({
      name: "ModelListError",
      category: "AUTH",
    });
  });

  it("menolak API key kosong", async () => {
    await expect(listProviderModels(values, "")).rejects.toBeInstanceOf(
      ModelListError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
