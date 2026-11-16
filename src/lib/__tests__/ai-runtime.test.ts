/**
 * Runtime provider factory — konfigurasi DB berlaku tanpa restart, setiap
 * request memakai snapshot sendiri, dan konfigurasi aktif rusak tidak diam-diam
 * beralih ke .env.
 */

const mockSettings = new Map<string, string>();

jest.mock("@/lib/prisma", () => {
  const setting = {
    findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
      if (!mockSettings.has(where.key)) return null;
      return { key: where.key, value: mockSettings.get(where.key) };
    }),
    upsert: jest.fn(
      async ({
        where,
        update,
        create,
      }: {
        where: { key: string };
        update: { value: string };
        create: { key: string; value: string };
      }) => {
        if (mockSettings.has(where.key)) mockSettings.set(where.key, update.value);
        else mockSettings.set(create.key, create.value);
        return { key: where.key, value: mockSettings.get(where.key) };
      }
    ),
    deleteMany: jest.fn(
      async ({ where }: { where: { key: string | { in: string[] } } }) => {
        const keys = typeof where.key === "string" ? [where.key] : where.key.in;
        for (const key of keys) mockSettings.delete(key);
        return { count: 1 };
      }
    ),
  };
  const prisma = {
    setting,
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (arg: unknown): Promise<unknown> => {
      if (typeof arg === "function") {
        return (arg as (tx: { setting: typeof setting }) => Promise<unknown>)({
          setting,
        });
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
  return { prisma };
});

import {
  buildAIProvider,
  getAIProvider,
  isAIConfigured,
} from "@/lib/ai";
import { OpenAIAIProvider } from "@/lib/ai/openai";
import { GeminiAIProvider } from "@/lib/ai/gemini";
import { AI_CONFIG_KEYS, commitDraftAsActive, saveDraftConfig } from "@/lib/ai/configStore";
import { resetEncryptionKeyCache } from "@/lib/ai/configCrypto";
import { AIConfigurationError } from "@/lib/ai/configStore";

const TEST_KEY = "nvapi-runtime-secret-1234567890";

const originalEnv = {
  AI_CONFIG_ENCRYPTION_KEY: process.env.AI_CONFIG_ENCRYPTION_KEY,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  AI_FALLBACK_MODELS: process.env.AI_FALLBACK_MODELS,
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_DISABLE_THINKING: process.env.AI_DISABLE_THINKING,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function activate(input: {
  provider: "NVIDIA" | "GEMINI" | "GROQ" | "OPENROUTER";
  model: string;
  fallbackModels?: string[];
  disableThinking?: boolean;
  apiKey: string;
}) {
  await saveDraftConfig(
    {
      provider: input.provider,
      model: input.model,
      fallbackModels: input.fallbackModels ?? [],
      disableThinking: input.disableThinking ?? false,
      apiKey: input.apiKey,
    },
    { updatedBy: "Admin" }
  );
  await commitDraftAsActive({
    updatedBy: "Admin",
    expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
  });
}

let logSpy: jest.SpyInstance;

beforeEach(() => {
  mockSettings.clear();
  process.env.AI_CONFIG_ENCRYPTION_KEY = "56".repeat(32);
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_FALLBACK_MODELS;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_DISABLE_THINKING;
  resetEncryptionKeyCache();
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => logSpy.mockRestore());

afterAll(() => {
  restoreEnv();
  resetEncryptionKeyCache();
});

describe("buildAIProvider", () => {
  it("memilih adapter Gemini native untuk provider GEMINI", () => {
    const provider = buildAIProvider({
      provider: "GEMINI",
      apiKey: "AIza-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.0-flash",
      fallbackModels: [],
      disableThinking: false,
    });
    expect(provider).toBeInstanceOf(GeminiAIProvider);
  });

  it.each(["NVIDIA", "GROQ", "OPENROUTER"] as const)(
    "memilih adapter OpenAI-compatible untuk %s",
    (providerId) => {
      const provider = buildAIProvider({
        provider: providerId,
        apiKey: "key",
        baseUrl: "https://example.test/v1",
        model: "model",
        fallbackModels: [],
        disableThinking: false,
      });
      expect(provider).toBeInstanceOf(OpenAIAIProvider);
    }
  );
});

describe("runtime tanpa restart", () => {
  it("perubahan konfigurasi aktif langsung dipakai request berikutnya", async () => {
    await activate({
      provider: "NVIDIA",
      model: "meta/llama-3.1-8b-instruct",
      apiKey: TEST_KEY,
    });

    await expect(isAIConfigured()).resolves.toBe(true);
    const first = await getAIProvider();
    expect(first).toBeInstanceOf(OpenAIAIProvider);

    await activate({
      provider: "GEMINI",
      model: "gemini-2.0-flash",
      fallbackModels: ["gemini-1.5-flash"],
      apiKey: "AIza-gemini-runtime",
    });

    const second = await getAIProvider();
    expect(second).toBeInstanceOf(GeminiAIProvider);
    expect(second).not.toBe(first);
  });

  it("instance provider yang sudah dibuat tetap memakai snapshot lamanya", async () => {
    await activate({
      provider: "NVIDIA",
      model: "model-lama",
      apiKey: TEST_KEY,
    });
    const inFlight = await getAIProvider();

    await activate({
      provider: "NVIDIA",
      model: "model-baru",
      apiKey: TEST_KEY,
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await inFlight.chat([{ role: "user", content: "Halo" }]);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body
    );
    expect(body.model).toBe("model-lama");

    const next = await getAIProvider();
    await next.chat([{ role: "user", content: "Halo" }]);
    const nextBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as { body: string }).body
    );
    expect(nextBody.model).toBe("model-baru");
  });

  it("konfigurasi aktif rusak TIDAK memakai .env dan melaporkan invalid", async () => {
    process.env.AI_API_KEY = "env-key";
    process.env.AI_MODEL = "env-model";
    mockSettings.set(AI_CONFIG_KEYS.CONFIG_ACTIVE, "{rusak");
    mockSettings.set(AI_CONFIG_KEYS.SECRET_ACTIVE, "rusak");

    await expect(isAIConfigured()).resolves.toBe(false);
    await expect(getAIProvider()).rejects.toMatchObject({
      name: "AIConfigurationError",
      code: "AI_CONFIG_INVALID",
    });
  });

  it("kegagalan membaca database tidak diam-diam memakai .env", async () => {
    process.env.AI_API_KEY = "env-key";
    process.env.AI_MODEL = "env-model";
    const { prisma } = jest.requireMock("@/lib/prisma") as {
      prisma: { setting: { findUnique: jest.Mock } };
    };
    prisma.setting.findUnique
      .mockRejectedValueOnce(new Error("db down"))
      .mockRejectedValueOnce(new Error("db down"));

    await expect(isAIConfigured()).resolves.toBe(false);
    await expect(getAIProvider()).rejects.toMatchObject({
      code: "AI_CONFIG_INVALID",
    });
  });

  it("konfigurasi aktif yang tidak dapat didekripsi tidak jatuh ke .env", async () => {
    process.env.AI_API_KEY = "env-key";
    await activate({
      provider: "NVIDIA",
      model: "model-db",
      apiKey: TEST_KEY,
    });

    // Simulasikan kunci enkripsi server berubah.
    process.env.AI_CONFIG_ENCRYPTION_KEY = "78".repeat(32);
    resetEncryptionKeyCache();

    await expect(isAIConfigured()).resolves.toBe(false);
    await expect(getAIProvider()).rejects.toBeInstanceOf(AIConfigurationError);
  });
});
