/**
 * Resolusi API key untuk uji koneksi / daftar model.
 *
 * Aturan yang dijaga:
 * - Tidak pernah memakai API key milik provider lain sebagai fallback.
 * - Prefix key yang jelas milik provider lain ditolak sebelum request jaringan.
 * - Menguji provider lain tidak mengubah konfigurasi/secret aktif (NVIDIA).
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
        if (mockSettings.has(where.key)) {
          mockSettings.set(where.key, update.value);
        } else {
          mockSettings.set(create.key, create.value);
        }
        return { key: where.key, value: mockSettings.get(where.key) };
      }
    ),
    deleteMany: jest.fn(
      async ({ where }: { where: { key: string | { in: string[] } } }) => {
        const keys = typeof where.key === "string" ? [where.key] : where.key.in;
        let count = 0;
        for (const key of keys) {
          if (mockSettings.delete(key)) count += 1;
        }
        return { count };
      }
    ),
  };
  const prisma = {
    setting,
    auditLog: { create: jest.fn(async () => ({})) },
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
  detectProviderKeyMismatch,
  resolveApiKeyForConfig,
} from "@/lib/ai/adminConfigApi";
import {
  AI_CONFIG_KEYS,
  AIConfigValidationError,
  commitDraftAsActive,
  getRuntimeAIConfig,
  readActiveApiKeyForProvider,
  saveDraftConfig,
  type AIConfigValues,
  type SaveDraftInput,
} from "@/lib/ai/configStore";
import { resetEncryptionKeyCache } from "@/lib/ai/configCrypto";
import { getAIProviderDefinition } from "@/lib/ai/providers";

const NVIDIA_KEY = "nvapi-nvidia-active-secret-1234567890";
const GEMINI_KEY = "AIzaSyGeminiDraftSecret1234567890";
const GROQ_KEY = "gsk_groqSecret1234567890";
const OPENROUTER_KEY = "sk-or-v1-openrouterSecret1234567890";

function configFor(
  provider: AIConfigValues["provider"],
  model: string,
  disableThinking: boolean
): AIConfigValues {
  return {
    provider,
    model,
    fallbackModels: [],
    disableThinking,
    baseUrl: getAIProviderDefinition(provider).baseUrl,
  };
}

const nvidiaConfig = configFor(
  "NVIDIA",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  true
);
const geminiConfig = configFor("GEMINI", "gemini-2.5-flash", false);
const groqConfig = configFor("GROQ", "llama-3.3-70b-versatile", false);
const openRouterConfig = configFor("OPENROUTER", "openai/gpt-4o-mini", false);

function draftInput(
  values: AIConfigValues,
  apiKey: string
): SaveDraftInput {
  return { ...values, apiKey };
}

const originalEnv = {
  AI_CONFIG_ENCRYPTION_KEY: process.env.AI_CONFIG_ENCRYPTION_KEY,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  AI_PROVIDER: process.env.AI_PROVIDER,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  mockSettings.clear();
  process.env.AI_CONFIG_ENCRYPTION_KEY = "56".repeat(32);
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_PROVIDER;
  resetEncryptionKeyCache();
});

afterAll(() => {
  restoreEnv();
  resetEncryptionKeyCache();
});

async function seedActiveNvidia() {
  await saveDraftConfig(
    draftInput(nvidiaConfig, NVIDIA_KEY),
    { updatedBy: "Admin" }
  );
  await commitDraftAsActive({
    updatedBy: "Admin",
    expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
  });
  return {
    config: mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE),
    secret: mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE),
  };
}

describe("detectProviderKeyMismatch", () => {
  it("mendeteksi prefix key milik provider lain", () => {
    expect(detectProviderKeyMismatch("GEMINI", NVIDIA_KEY)).toBe("NVIDIA");
    expect(detectProviderKeyMismatch("NVIDIA", GEMINI_KEY)).toBe("GEMINI");
    expect(detectProviderKeyMismatch("GROQ", OPENROUTER_KEY)).toBe("OPENROUTER");
    expect(detectProviderKeyMismatch("OPENROUTER", GROQ_KEY)).toBe("GROQ");
  });

  it("mengizinkan prefix yang cocok dan format yang tidak dikenal", () => {
    expect(detectProviderKeyMismatch("NVIDIA", NVIDIA_KEY)).toBeNull();
    expect(detectProviderKeyMismatch("GEMINI", GEMINI_KEY)).toBeNull();
    expect(detectProviderKeyMismatch("GROQ", GROQ_KEY)).toBeNull();
    expect(detectProviderKeyMismatch("OPENROUTER", OPENROUTER_KEY)).toBeNull();
    expect(detectProviderKeyMismatch("GEMINI", "custom-format-key")).toBeNull();
    expect(detectProviderKeyMismatch("GEMINI", "   ")).toBeNull();
  });
});

describe("resolveApiKeyForConfig", () => {
  it("memakai key dari request hanya untuk provider yang dipilih", async () => {
    const resolved = await resolveApiKeyForConfig(geminiConfig, GEMINI_KEY);
    expect(resolved).toEqual({ apiKey: GEMINI_KEY, source: "REQUEST" });
  });

  it.each([
    ["GEMINI", geminiConfig, NVIDIA_KEY, "NVIDIA"],
    ["GROQ", groqConfig, NVIDIA_KEY, "NVIDIA"],
    ["OPENROUTER", openRouterConfig, NVIDIA_KEY, "NVIDIA"],
    ["NVIDIA", nvidiaConfig, GEMINI_KEY, "GEMINI"],
    ["GEMINI", geminiConfig, GROQ_KEY, "GROQ"],
    ["GROQ", groqConfig, OPENROUTER_KEY, "OPENROUTER"],
  ])(
    "menolak key %s dari provider %s sebelum request jaringan",
    async (_provider, config, key, owner) => {
      await expect(resolveApiKeyForConfig(config, key)).rejects.toBeInstanceOf(
        AIConfigValidationError
      );
      await expect(resolveApiKeyForConfig(config, key)).rejects.toThrow(
        new RegExp(owner)
      );
    }
  );

  it("tidak memakai API key aktif NVIDIA untuk Gemini walaupun draft Gemini ada", async () => {
    await seedActiveNvidia();
    await saveDraftConfig(draftInput(geminiConfig, ""), {
      updatedBy: "Admin",
    });

    const resolved = await resolveApiKeyForConfig(geminiConfig, undefined);
    expect(resolved).toBeNull();
  });

  it("tidak memakai API key aktif NVIDIA untuk Groq/OpenRouter", async () => {
    await seedActiveNvidia();

    await expect(resolveApiKeyForConfig(groqConfig, undefined)).resolves.toBeNull();
    await expect(
      resolveApiKeyForConfig(openRouterConfig, undefined)
    ).resolves.toBeNull();
  });

  it("tidak memakai key draft Gemini untuk NVIDIA", async () => {
    await saveDraftConfig(
      draftInput(geminiConfig, GEMINI_KEY),
      { updatedBy: "Admin" }
    );

    const resolved = await resolveApiKeyForConfig(nvidiaConfig, undefined);
    expect(resolved).toBeNull();
  });

  it("tidak memakai AI_API_KEY .env untuk provider yang berbeda", async () => {
    process.env.AI_API_KEY = NVIDIA_KEY;
    process.env.AI_PROVIDER = "NVIDIA";

    const resolved = await resolveApiKeyForConfig(geminiConfig, undefined);
    expect(resolved).toBeNull();
  });

  it("memakai AI_API_KEY .env hanya bila provider .env sama", async () => {
    process.env.AI_API_KEY = GROQ_KEY;
    process.env.AI_PROVIDER = "GROQ";

    const resolved = await resolveApiKeyForConfig(groqConfig, undefined);
    expect(resolved).toEqual({ apiKey: GROQ_KEY, source: "ENV" });
  });

  it("memakai key draft Gemini hanya untuk provider Gemini", async () => {
    await saveDraftConfig(
      draftInput(geminiConfig, GEMINI_KEY),
      { updatedBy: "Admin" }
    );

    const resolved = await resolveApiKeyForConfig(geminiConfig, undefined);
    expect(resolved).toEqual({ apiKey: GEMINI_KEY, source: "DRAFT" });
  });

  it("menguji provider lain tidak mengubah konfigurasi/secret aktif NVIDIA", async () => {
    const before = await seedActiveNvidia();

    await resolveApiKeyForConfig(geminiConfig, GEMINI_KEY);
    await resolveApiKeyForConfig(groqConfig, GROQ_KEY);
    await resolveApiKeyForConfig(openRouterConfig, OPENROUTER_KEY);

    expect(mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(before.config);
    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(before.secret);

    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("active");
    if (runtime.status === "active") {
      expect(runtime.provider).toBe("NVIDIA");
      expect(runtime.model).toBe(nvidiaConfig.model);
      expect(runtime.fallbackModels).toEqual([]);
      expect(runtime.disableThinking).toBe(true);
      expect(runtime.apiKey).toBe(NVIDIA_KEY);
    }

    const activeKey = await readActiveApiKeyForProvider("NVIDIA");
    expect(activeKey).toBe(NVIDIA_KEY);
  });
});
