/**
 * Katalog provider & format request per provider. Tidak memanggil jaringan nyata.
 */

import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  getAIProviderDefinition,
  resolveEnvProvider,
} from "@/lib/ai/providers";
import { buildAIProvider } from "@/lib/ai";
import { validateAIConfigInput } from "@/lib/ai/configStore";
import { type AIToolDefinition } from "@/lib/ai/types";

const API_KEY = "provider-test-key";

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content } }],
        candidates: [{ content: { parts: [{ text: content }] } }],
      }),
  } as unknown as Response;
}

let fetchMock: jest.Mock;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue(okResponse("ok"));
  global.fetch = fetchMock as unknown as typeof fetch;
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function build(provider: (typeof AI_PROVIDER_IDS)[number]) {
  return buildAIProvider({
    provider,
    apiKey: API_KEY,
    baseUrl: getAIProviderDefinition(provider).baseUrl,
    model: provider === "GEMINI" ? "gemini-2.0-flash" : "test-model",
    fallbackModels: [],
    disableThinking: true,
  });
}

describe("katalog provider", () => {
  it("hanya berisi provider yang didukung dengan endpoint tetap", () => {
    expect(AI_PROVIDER_IDS).toEqual(["NVIDIA", "GEMINI", "GROQ", "OPENROUTER"]);
    expect(AI_PROVIDERS.NVIDIA.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(AI_PROVIDERS.GEMINI.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta"
    );
    expect(AI_PROVIDERS.GROQ.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(AI_PROVIDERS.OPENROUTER.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("menyimpulkan provider .env dari host dan explicit AI_PROVIDER", () => {
    expect(resolveEnvProvider(undefined, "https://api.groq.com/openai/v1").id).toBe(
      "GROQ"
    );
    expect(
      resolveEnvProvider(undefined, "https://integrate.api.nvidia.com/v1").id
    ).toBe("NVIDIA");
    expect(
      resolveEnvProvider(undefined, "https://openrouter.ai/api/v1").id
    ).toBe("OPENROUTER");
    expect(
      resolveEnvProvider(undefined, "https://generativelanguage.googleapis.com/v1beta")
        .id
    ).toBe("GEMINI");
    expect(resolveEnvProvider("NVIDIA", "https://api.openai.com/v1").id).toBe(
      "NVIDIA"
    );
    expect(resolveEnvProvider(undefined, "https://api.openai.com/v1").id).toBe(
      "OPENAI_COMPATIBLE"
    );
  });

  it("menolak baseUrl dari input dan memakai endpoint katalog", () => {
    const result = validateAIConfigInput({
      provider: "NVIDIA",
      model: "model",
      fallbackModels: [],
      baseUrl: "http://169.254.169.254/latest/meta-data",
    });
    expect(result.ok).toBe(true);
    expect(result.values?.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });
});

describe("format request per provider", () => {
  it.each(["NVIDIA", "GROQ", "OPENROUTER"] as const)(
    "%s memakai /chat/completions dan Bearer token",
    async (providerId) => {
      await build(providerId).chat([{ role: "user", content: "Halo" }]);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${AI_PROVIDERS[providerId].baseUrl}/chat/completions`);
      expect((init as { headers: Record<string, string> }).headers).toMatchObject({
        Authorization: `Bearer ${API_KEY}`,
      });
      expect(String(url)).not.toContain(API_KEY);
    }
  );

  it("GEMINI memakai generateContent native dan header x-goog-api-key", async () => {
    await build("GEMINI").chat([{ role: "user", content: "Halo" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${AI_PROVIDERS.GEMINI.baseUrl}/models/gemini-2.0-flash:generateContent`
    );
    expect((init as { headers: Record<string, string> }).headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY,
    });
    expect(String(url)).not.toContain(API_KEY);
  });
});

describe("tool calling per provider", () => {
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

  function toolResponse() {
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "catalog_stats", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
    } as unknown as Response;
  }

  it.each(["NVIDIA", "GROQ", "OPENROUTER"] as const)(
    "%s mengirim tools dan mengeksekusi function call",
    async (providerId) => {
      fetchMock
        .mockResolvedValueOnce(toolResponse())
        .mockResolvedValueOnce(okResponse("Ada 4 judul."));

      const execute = jest.fn(async () => JSON.stringify({ totalTitles: 4 }));
      const answer = await build(providerId).chatWithTools!(
        [{ role: "user", content: "Berapa judul?" }],
        tools,
        execute
      );

      expect(answer).toBe("Ada 4 judul.");
      expect(execute).toHaveBeenCalledWith("catalog_stats", {});
      const firstBody = JSON.parse(
        (fetchMock.mock.calls[0][1] as { body: string }).body
      );
      expect(firstBody.tools).toEqual(tools);
      expect(firstBody.tool_choice).toBe("auto");
      if (providerId === "NVIDIA") {
        expect(firstBody.chat_template_kwargs).toEqual({ enable_thinking: false });
      } else {
        expect(firstBody.chat_template_kwargs).toBeUndefined();
      }
    }
  );

  it("GEMINI mengirim functionDeclarations dan functionResponse", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ functionCall: { name: "catalog_stats", args: {} } }],
                },
              },
            ],
          }),
      } as unknown as Response)
      .mockResolvedValueOnce(okResponse("Ada 4 judul."));

    const execute = jest.fn(async () => JSON.stringify({ totalTitles: 4 }));
    const answer = await build("GEMINI").chatWithTools!(
      [{ role: "user", content: "Berapa judul?" }],
      tools,
      execute
    );

    expect(answer).toBe("Ada 4 judul.");
    const firstBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body
    );
    expect(firstBody.tools).toEqual([
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
    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as { body: string }).body
    );
    expect(secondBody.contents.at(-1)).toMatchObject({
      role: "user",
      parts: [{ functionResponse: { name: "catalog_stats" } }],
    });
  });
});
