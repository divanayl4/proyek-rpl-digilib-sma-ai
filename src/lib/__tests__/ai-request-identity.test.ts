/**
 * Request-scoped provider/model identity.
 *
 * Identitas model TIDAK disimpan pada global scalar atau Map per pengguna.
 * Setiap respons provider membawa identitasnya sendiri; `FallbackAIProvider`
 * hanya mengembalikan identitas kandidat yang benar-benar menjawab.
 */

import { FallbackAIProvider } from "@/lib/ai";
import { GeminiAIProvider } from "@/lib/ai/gemini";
import { OpenAIAIProvider } from "@/lib/ai/openai";
import type { AIProvider, AIProviderResult } from "@/lib/ai/types";

const messages = [{ role: "user" as const, content: "Halo" }];

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function errorResponse(status: number, message = "boom") {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify({ error: { message } }),
  } as unknown as Response;
}

function geminiText(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      }),
  } as unknown as Response;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

function fakeProvider(
  id: string,
  model: string,
  behavior: "ok" | "fail",
  delayMs = 0
): AIProvider & { calls: number } {
  const provider = {
    calls: 0,
    async chat(): Promise<string> {
      provider.calls += 1;
      throw new Error("not used");
    },
    async chatDetailed(): Promise<AIProviderResult> {
      provider.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (behavior === "fail") throw new Error("primary down");
      return { content: `jawaban ${id}`, provider: id, model };
    },
    async chatWithToolsDetailed(): Promise<AIProviderResult> {
      provider.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (behavior === "fail") throw new Error("primary down");
      return { content: `jawaban ${id}`, provider: id, model };
    },
  };
  return provider;
}

describe("OpenAIAIProvider — identitas model aktual", () => {
  it("mengembalikan provider dan model utama yang menjawab", async () => {
    fetchMock.mockResolvedValue(okResponse("Halo!"));
    const provider = new OpenAIAIProvider("key", "https://x/v1", "model-utama", [], {
      providerId: "NVIDIA",
    });

    await expect(provider.chatDetailed?.(messages)).resolves.toEqual({
      content: "Halo!",
      provider: "NVIDIA",
      model: "model-utama",
    });
    expect(await provider.chat(messages)).toBe("Halo!");
  });

  it("mengembalikan model cadangan saat model utama gagal", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okResponse("Halo dari cadangan"));

    const provider = new OpenAIAIProvider("key", "https://x/v1", "model-utama", ["model-cadangan"], {
      providerId: "NVIDIA",
    });

    const result = await provider.chatDetailed?.(messages);
    expect(result?.model).toBe("model-cadangan");
    expect(result?.provider).toBe("NVIDIA");
    expect(result?.content).toBe("Halo dari cadangan");
  });
});

describe("GeminiAIProvider — identitas model aktual", () => {
  it("mengembalikan provider GEMINI dan model cadangan yang menjawab", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(geminiText("Halo Gemini"));

    const provider = new GeminiAIProvider(
      "AIza-key",
      "https://generativelanguage.googleapis.com/v1beta",
      "gemini-utama",
      ["gemini-cadangan"]
    );

    const result = await provider.chatDetailed?.(messages);
    expect(result).toEqual({
      content: "Halo Gemini",
      provider: "GEMINI",
      model: "gemini-cadangan",
    });
  });
});

describe("FallbackAIProvider — identitas tidak tertukar", () => {
  it("memakai identitas kandidat yang berhasil setelah kandidat utama gagal", async () => {
    const primary = fakeProvider("OPENROUTER", "openai/gpt-4o", "fail");
    const fallback = fakeProvider("NVIDIA", "nvidia/nemotron", "ok");
    const provider = new FallbackAIProvider([
      { provider: primary, providerId: "OPENROUTER", model: "openai/gpt-4o" },
      { provider: fallback, providerId: "NVIDIA", model: "nvidia/nemotron" },
    ]);

    await expect(provider.chatDetailed?.(messages)).resolves.toEqual({
      content: "jawaban NVIDIA",
      provider: "NVIDIA",
      model: "nvidia/nemotron",
      fallbackUsed: true,
      primaryProvider: "OPENROUTER",
      primaryModel: "openai/gpt-4o",
    });
  });

  it("tidak menandai fallback saat kandidat utama berhasil", async () => {
    const primary = fakeProvider("OPENROUTER", "openai/gpt-4o", "ok");
    const provider = new FallbackAIProvider([
      { provider: primary, providerId: "OPENROUTER", model: "openai/gpt-4o" },
    ]);

    const result = await provider.chatDetailed?.(messages);
    expect(result).toMatchObject({
      provider: "OPENROUTER",
      model: "openai/gpt-4o",
    });
    expect(result?.fallbackUsed).toBeUndefined();
  });

  it("dua request bersamaan dari pengguna yang sama tidak saling menimpa identitas", async () => {
    // Request A: primary sukses (lambat). Request B: primary gagal → fallback.
    const primaryA = fakeProvider("OPENROUTER", "openai/gpt-4o", "ok", 30);
    const requestA = new FallbackAIProvider([
      { provider: primaryA, providerId: "OPENROUTER", model: "openai/gpt-4o" },
    ]);

    const primaryB = fakeProvider("OPENROUTER", "openai/gpt-4o", "fail", 5);
    const fallbackB = fakeProvider("NVIDIA", "nvidia/nemotron", "ok", 5);
    const requestB = new FallbackAIProvider([
      { provider: primaryB, providerId: "OPENROUTER", model: "openai/gpt-4o" },
      { provider: fallbackB, providerId: "NVIDIA", model: "nvidia/nemotron" },
    ]);

    const [a, b] = await Promise.all([
      requestA.chatWithToolsDetailed?.(messages, [], async () => "{}"),
      requestB.chatWithToolsDetailed?.(messages, [], async () => "{}"),
    ]);

    expect(a).toMatchObject({ provider: "OPENROUTER", model: "openai/gpt-4o" });
    expect(b).toMatchObject({ provider: "NVIDIA", model: "nvidia/nemotron" });
  });

  it("dua request bersamaan dari pengguna berbeda memakai provider berbeda", async () => {
    const openrouter = fakeProvider("OPENROUTER", "openai/gpt-4o", "ok", 20);
    const gemini = fakeProvider("GEMINI", "gemini-2.0-flash", "ok", 1);

    const request1 = new FallbackAIProvider([
      { provider: openrouter, providerId: "OPENROUTER", model: "openai/gpt-4o" },
    ]);
    const request2 = new FallbackAIProvider([
      { provider: gemini, providerId: "GEMINI", model: "gemini-2.0-flash" },
    ]);

    const [r1, r2] = await Promise.all([
      request1.chatDetailed?.(messages),
      request2.chatDetailed?.(messages),
    ]);

    expect(r1).toMatchObject({ provider: "OPENROUTER", model: "openai/gpt-4o" });
    expect(r2).toMatchObject({ provider: "GEMINI", model: "gemini-2.0-flash" });
  });

  it("semua kandidat gagal → melempar error, bukan mengarang identitas", async () => {
    const primary = fakeProvider("OPENROUTER", "openai/gpt-4o", "fail");
    const provider = new FallbackAIProvider([
      { provider: primary, providerId: "OPENROUTER", model: "openai/gpt-4o" },
    ]);

    await expect(provider.chatDetailed?.(messages)).rejects.toThrow("primary down");
  });
});
