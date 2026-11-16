/**
 * Konfigurasi AI — penyimpanan, draft/active separation, enkripsi, dan runtime.
 * Prisma dimock dengan penyimpanan Setting in-memory; tidak menyentuh DB asli.
 */

const mockSettings = new Map<string, string>();
const mockAuditCreate = jest.fn(async () => ({}));

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
      async ({
        where,
      }: {
        where: { key: string | { in: string[] } };
      }) => {
        const keys =
          typeof where.key === "string" ? [where.key] : where.key.in;
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
    auditLog: { create: mockAuditCreate },
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
  AI_CONFIG_KEYS,
  AIConfigurationError,
  AIDraftChangedError,
  clearDraftApiKey,
  commitDraftAsActive,
  deactivateActiveConfig,
  getPublicConfigState,
  getRuntimeAIConfig,
  readActiveConfig,
  readDraftConfig,
  saveDraftConfig,
} from "@/lib/ai/configStore";
import { decryptSecret, resetEncryptionKeyCache } from "@/lib/ai/configCrypto";

const TEST_KEY = "nvapi-test-secret-key-1234567890";

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

beforeEach(() => {
  mockSettings.clear();
  mockAuditCreate.mockClear();
  process.env.AI_CONFIG_ENCRYPTION_KEY = "12".repeat(32);
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_FALLBACK_MODELS;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_DISABLE_THINKING;
  resetEncryptionKeyCache();
});

afterAll(() => {
  restoreEnv();
  resetEncryptionKeyCache();
});

const baseInput = {
  provider: "NVIDIA",
  model: "meta/llama-3.1-8b-instruct",
  fallbackModels: ["nvidia/nemotron-test"],
  disableThinking: true,
};

describe("saveDraftConfig", () => {
  it("menyimpan API key dalam bentuk terenkripsi, bukan plaintext", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });

    const rawSecret = mockSettings.get(AI_CONFIG_KEYS.SECRET_DRAFT);
    expect(rawSecret).toBeTruthy();
    expect(rawSecret).not.toContain(TEST_KEY);
    expect(decryptSecret(rawSecret as string)).toBe(TEST_KEY);

    const draft = await readDraftConfig();
    expect(draft).toMatchObject({
      provider: "NVIDIA",
      model: baseInput.model,
      fallbackModels: baseInput.fallbackModels,
    });
  });

  it("tidak mengembalikan API key/ciphertext pada state publik", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    const state = await getPublicConfigState();
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain("aes-256-gcm");
    expect(state.draft?.hasApiKey).toBe(true);
    expect(state.draft?.apiKeyValid).toBe(true);
  });

  it("mempertahankan API key draft bila field apiKey kosong", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    const before = mockSettings.get(AI_CONFIG_KEYS.SECRET_DRAFT);

    await saveDraftConfig(
      { ...baseInput, model: "meta/llama-3.1-70b-instruct" },
      { updatedBy: "Admin" }
    );

    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(before);
    expect((await readDraftConfig())?.model).toBe("meta/llama-3.1-70b-instruct");
  });

  it("tidak memakai ulang API key draft saat provider berubah", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(true);

    await saveDraftConfig(
      {
        provider: "GROQ",
        model: "llama-3.1-8b-instant",
        fallbackModels: [],
        disableThinking: false,
      },
      { updatedBy: "Admin" }
    );

    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(false);
  });

  it("tidak menghapus API key draft lama bila enkripsi API key baru gagal", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    const before = mockSettings.get(AI_CONFIG_KEYS.SECRET_DRAFT);

    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    delete process.env.NEXTAUTH_SECRET;
    resetEncryptionKeyCache();

    await expect(
      saveDraftConfig({ ...baseInput, apiKey: "new-key" }, { updatedBy: "Admin" })
    ).rejects.toBeInstanceOf(AIConfigurationError);

    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(before);
  });

  it("menolak konfigurasi tidak valid", async () => {
    await expect(
      saveDraftConfig(
        { provider: "TIDAK_ADA", model: "x", fallbackModels: [] },
        { updatedBy: "Admin" }
      )
    ).rejects.toThrow("Provider AI tidak dikenal");
  });

  it("mengadopsi API key .env server untuk provider yang sama tanpa plaintext di DB", async () => {
    process.env.AI_API_KEY = "env-secret-key";
    process.env.AI_PROVIDER = "NVIDIA";

    const saved = await saveDraftConfig(baseInput, { updatedBy: "Admin" });

    expect(saved.hasApiKey).toBe(true);
    expect(saved.apiKeyValid).toBe(true);
    const raw = mockSettings.get(AI_CONFIG_KEYS.SECRET_DRAFT) as string;
    expect(raw).not.toContain("env-secret-key");
    expect(decryptSecret(raw)).toBe("env-secret-key");
    expect((await getRuntimeAIConfig()).status).toBe("env");
    expect(mockSettings.has(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(false);
  });

  it("tidak mengadopsi API key .env bila provider berbeda", async () => {
    process.env.AI_API_KEY = "env-secret-key";
    process.env.AI_PROVIDER = "GROQ";

    const saved = await saveDraftConfig(baseInput, { updatedBy: "Admin" });

    expect(saved.hasApiKey).toBe(false);
    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(false);
  });

  it("clearApiKey tidak mengadopsi ulang API key .env", async () => {
    process.env.AI_API_KEY = "env-secret-key";
    process.env.AI_PROVIDER = "NVIDIA";
    await saveDraftConfig(baseInput, { updatedBy: "Admin" });
    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(true);

    await saveDraftConfig(
      { ...baseInput, clearApiKey: true },
      { updatedBy: "Admin" }
    );

    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(false);
  });

  it("normalisasi prefix models/ untuk Gemini", async () => {
    const saved = await saveDraftConfig(
      {
        provider: "GEMINI",
        model: "models/gemini-2.0-flash",
        fallbackModels: "models/gemini-2.0-flash-lite, gemini-1.5-flash",
        disableThinking: true,
      },
      { updatedBy: "Admin" }
    );
    expect(saved.model).toBe("gemini-2.0-flash");
    expect(saved.fallbackModels).toEqual(["gemini-2.0-flash-lite", "gemini-1.5-flash"]);
    expect(saved.disableThinking).toBe(false);
  });
});

describe("aktivasi dan runtime", () => {
  it("menyalin draft+secret ke aktif secara atomik dan runtime langsung memakainya", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    const rawDraft = mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string;

    const active = await commitDraftAsActive({
      updatedBy: "Admin",
      expectedRawConfig: rawDraft,
    });

    expect(active.provider).toBe("NVIDIA");
    expect(active.activatedAt).toBeTruthy();
    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(
      mockSettings.get(AI_CONFIG_KEYS.SECRET_DRAFT)
    );

    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("active");
    if (runtime.status === "active") {
      expect(runtime.source).toBe("DATABASE");
      expect(runtime.provider).toBe("NVIDIA");
      expect(runtime.model).toBe(baseInput.model);
      expect(runtime.apiKey).toBe(TEST_KEY);
      expect(runtime.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    }
  });

  it("menolak aktivasi bila draft berubah setelah diuji", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    const oldRaw = mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string;

    await saveDraftConfig(
      { ...baseInput, model: "model-lain" },
      { updatedBy: "Admin" }
    );

    await expect(
      commitDraftAsActive({ updatedBy: "Admin", expectedRawConfig: oldRaw })
    ).rejects.toBeInstanceOf(AIDraftChangedError);
    expect(mockSettings.has(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(false);
  });

  it("konfigurasi aktif TIDAK berubah bila draft diganti dan aktivasi gagal", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    const firstRaw = mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string;
    await commitDraftAsActive({ updatedBy: "Admin", expectedRawConfig: firstRaw });
    const activeBefore = mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE);
    const secretBefore = mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE);

    await saveDraftConfig(
      {
        provider: "GEMINI",
        model: "gemini-2.0-flash",
        fallbackModels: [],
        disableThinking: false,
      },
      { updatedBy: "Admin" }
    );

    await expect(
      commitDraftAsActive({ updatedBy: "Admin", expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string })
    ).rejects.toThrow("API key belum tersimpan");

    expect(mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(activeBefore);
    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(secretBefore);
    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("active");
    if (runtime.status === "active") expect(runtime.provider).toBe("NVIDIA");
  });

  it("menolak aktivasi bila secret draft berubah setelah diuji", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    const raw = mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string;
    const secret = mockSettings.get(AI_CONFIG_KEYS.SECRET_DRAFT) as string;

    await expect(
      commitDraftAsActive({
        updatedBy: "Admin",
        expectedRawConfig: raw,
        expectedSecretRaw: secret + "-berbeda",
      })
    ).rejects.toBeInstanceOf(AIDraftChangedError);
    expect(mockSettings.has(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(false);
  });

  it("menonaktifkan konfigurasi aktif dan kembali ke .env", async () => {
    process.env.AI_API_KEY = "env-key";
    process.env.AI_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.AI_MODEL = "llama-env";

    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    await commitDraftAsActive({
      updatedBy: "Admin",
      expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
    });

    await deactivateActiveConfig();

    expect(mockSettings.has(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(false);
    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(false);
    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("env");
    if (runtime.status === "env") {
      expect(runtime.provider).toBe("GROQ");
      expect(runtime.model).toBe("llama-env");
      expect(runtime.apiKey).toBe("env-key");
    }
  });

  it("konfigurasi aktif rusak TIDAK diam-diam beralih ke .env", async () => {
    process.env.AI_API_KEY = "env-key";
    mockSettings.set(AI_CONFIG_KEYS.CONFIG_ACTIVE, "{bukan-json");
    mockSettings.set(AI_CONFIG_KEYS.SECRET_ACTIVE, "rusak");

    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("invalid");

    const state = await getPublicConfigState();
    expect(state.source).toBe("INVALID");
    expect(state.configured).toBe(false);
  });

  it("menghapus API key draft tidak mengubah API key aktif", async () => {
    await saveDraftConfig({ ...baseInput, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    await commitDraftAsActive({
      updatedBy: "Admin",
      expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
    });
    const activeSecret = mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE);

    await clearDraftApiKey();

    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(false);
    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(activeSecret);
    expect((await readActiveConfig())?.provider).toBe("NVIDIA");
  });
});
