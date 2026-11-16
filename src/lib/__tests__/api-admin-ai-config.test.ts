/**
 * Endpoint Konfigurasi AI — RBAC ADMIN-only, pemisahan draft/aktif, dan
 * jaminan tidak ada API key/ciphertext yang bocor ke respons HTTP.
 */

const mockSettings = new Map<string, string>();
const mockAuditCreate = jest.fn(async () => ({}));
const mockGetServerSession = jest.fn();
const mockTestProviderConnection = jest.fn();
const mockListProviderModels = jest.fn();

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

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/ai/connection", () => {
  class ModelListError extends Error {
    category: string;
    constructor(message: string, category: string) {
      super(message);
      this.name = "ModelListError";
      this.category = category;
    }
  }
  return {
    testProviderConnection: (...args: unknown[]) =>
      mockTestProviderConnection(...args),
    listProviderModels: (...args: unknown[]) => mockListProviderModels(...args),
    ModelListError,
  };
});

import {
  GET as getConfig,
  PUT as putConfig,
  DELETE as deleteConfig,
} from "@/app/api/admin/ai-config/route";
import { POST as testConfig } from "@/app/api/admin/ai-config/test/route";
import { POST as listModels } from "@/app/api/admin/ai-config/models/route";
import { POST as activateConfig } from "@/app/api/admin/ai-config/activate/route";
import { POST as deactivateConfig } from "@/app/api/admin/ai-config/deactivate/route";
import {
  AI_CONFIG_KEYS,
  commitDraftAsActive,
  getRuntimeAIConfig,
  saveDraftConfig,
} from "@/lib/ai/configStore";
import { resetEncryptionKeyCache } from "@/lib/ai/configCrypto";

const TEST_KEY = "nvapi-secret-key-should-never-leak-123456";

const originalEnv = {
  AI_CONFIG_ENCRYPTION_KEY: process.env.AI_CONFIG_ENCRYPTION_KEY,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
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

function signInAs(role: string) {
  mockGetServerSession.mockResolvedValue({
    user: { id: "admin-1", name: "Admin Uji", role },
  });
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as never;
}

const baseDraft = {
  provider: "NVIDIA",
  model: "meta/llama-3.1-8b-instruct",
  fallbackModels: ["nvidia/nemotron-test"],
  disableThinking: true,
};

beforeEach(() => {
  mockSettings.clear();
  mockAuditCreate.mockClear();
  mockTestProviderConnection.mockReset();
  mockListProviderModels.mockReset();
  mockGetServerSession.mockReset();
  process.env.AI_CONFIG_ENCRYPTION_KEY = "34".repeat(32);
  delete process.env.NEXTAUTH_SECRET;
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

describe("RBAC semua endpoint Konfigurasi AI", () => {
  const endpoints: Array<[string, (req?: unknown) => Promise<Response>]> = [
    ["GET config", () => getConfig()],
    ["PUT config", () => putConfig(jsonRequest("http://x/api/admin/ai-config", "PUT", baseDraft))],
    ["DELETE config", () => deleteConfig(jsonRequest("http://x/api/admin/ai-config", "DELETE", { scope: "key" }))],
    ["POST test", () => testConfig(jsonRequest("http://x/api/admin/ai-config/test", "POST", baseDraft))],
    ["POST models", () => listModels(jsonRequest("http://x/api/admin/ai-config/models", "POST", baseDraft))],
    ["POST activate", () => activateConfig()],
    ["POST deactivate", () => deactivateConfig()],
  ];

  it.each(endpoints)("%s menolak request tanpa sesi (401)", async (_name, call) => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
  });

  it.each(endpoints)("%s menolak non-ADMIN (403)", async (_name, call) => {
    for (const role of ["LIBRARIAN", "STUDENT", "TEACHER", "STAFF"]) {
      signInAs(role);
      const res = await call();
      expect(res.status).toBe(403);
    }
  });

  it("tidak memakai role dari body request", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "student-1", role: "STUDENT" },
    });
    const res = await putConfig(
      jsonRequest("http://x/api/admin/ai-config", "PUT", {
        ...baseDraft,
        role: "ADMIN",
      })
    );
    expect(res.status).toBe(403);
    expect(mockSettings.size).toBe(0);
  });
});

describe("GET /api/admin/ai-config", () => {
  it("mengembalikan status aman tanpa secret", async () => {
    signInAs("ADMIN");
    await saveDraftConfig({ ...baseDraft, apiKey: TEST_KEY }, { updatedBy: "Admin" });

    const res = await getConfig();
    expect(res.status).toBe(200);
    const body = await res.json();
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain("aes-256-gcm");
    expect(body.state.draft).toMatchObject({
      provider: "NVIDIA",
      hasApiKey: true,
      apiKeyValid: true,
    });
    expect(body.state.draft.apiKey).toBeUndefined();
    expect(body.state.diagnostics.draft).toMatchObject({
      present: true,
      secretPresent: true,
      secretValid: true,
    });
    expect(body.state.diagnostics.active.present).toBe(false);
    expect(body.state.diagnostics.nextAction.code).toBe("TEST_DRAFT");
    expect(body.state.diagnostics.encryption.source).toBe(
      "AI_CONFIG_ENCRYPTION_KEY"
    );
  });
});

describe("PUT /api/admin/ai-config", () => {
  it("menyimpan draft tanpa mengubah konfigurasi aktif dan tanpa membocorkan key", async () => {
    signInAs("ADMIN");

    const res = await putConfig(
      jsonRequest("http://x/api/admin/ai-config", "PUT", {
        ...baseDraft,
        apiKey: TEST_KEY,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain("aes-256-gcm");
    expect(body.draft.hasApiKey).toBe(true);
    expect(mockSettings.has(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(false);
    expect(mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT)).toBeTruthy();

    const auditText = JSON.stringify(mockAuditCreate.mock.calls);
    expect(auditText).not.toContain(TEST_KEY);
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "UPDATE_AI_CONFIG_DRAFT" }) })
    );
  });

  it("menolak body JSON yang rusak (400)", async () => {
    signInAs("ADMIN");
    const req = new Request("http://x/api/admin/ai-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{bukan-json",
    }) as never;
    const res = await putConfig(req);
    expect(res.status).toBe(400);
  });

  it("menolak provider tidak dikenal (400)", async () => {
    signInAs("ADMIN");
    const res = await putConfig(
      jsonRequest("http://x/api/admin/ai-config", "PUT", {
        provider: "UNKNOWN",
        model: "x",
      })
    );
    expect(res.status).toBe(400);
  });

  it("mengabaikan baseUrl arbitrer dari body (anti-SSRF)", async () => {
    signInAs("ADMIN");
    const res = await putConfig(
      jsonRequest("http://x/api/admin/ai-config", "PUT", {
        ...baseDraft,
        baseUrl: "http://169.254.169.254/latest/meta-data",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(JSON.stringify(body)).not.toContain("169.254.169.254");
  });

  it("menyimpan dan mengaktifkan konfigurasi pertama memakai API key .env", async () => {
    process.env.AI_API_KEY = "env-first-time-key";
    process.env.AI_PROVIDER = "NVIDIA";
    signInAs("ADMIN");

    const saveRes = await putConfig(
      jsonRequest("http://x/api/admin/ai-config", "PUT", baseDraft)
    );
    expect(saveRes.status).toBe(200);
    const saved = await saveRes.json();
    expect(saved.draft.hasApiKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("env-first-time-key");

    mockTestProviderConnection.mockResolvedValue({
      ok: true,
      category: "SUCCESS",
      message: "Koneksi berhasil.",
      latencyMs: 10,
      httpStatus: null,
      provider: "NVIDIA",
      model: baseDraft.model,
    });

    const activateRes = await activateConfig();
    expect(activateRes.status).toBe(200);
    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("active");
    if (runtime.status === "active") {
      expect(runtime.source).toBe("DATABASE");
      expect(runtime.apiKey).toBe("env-first-time-key");
    }
  });

  it("menghapus API key draft tidak menyentuh API key aktif", async () => {
    signInAs("ADMIN");
    await saveDraftConfig({ ...baseDraft, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    await commitDraftAsActive({
      updatedBy: "Admin",
      expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
    });
    const activeSecret = mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE);

    const res = await deleteConfig(
      jsonRequest("http://x/api/admin/ai-config", "DELETE", { scope: "key" })
    );
    expect(res.status).toBe(200);
    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(false);
    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(activeSecret);
  });
});

describe("POST /api/admin/ai-config/test", () => {
  it("menguji dengan API key dari body tanpa menyimpannya", async () => {
    signInAs("ADMIN");
    mockTestProviderConnection.mockResolvedValue({
      ok: true,
      category: "SUCCESS",
      message: "Koneksi berhasil.",
      latencyMs: 12,
      httpStatus: null,
      provider: "NVIDIA",
      model: baseDraft.model,
    });

    const res = await testConfig(
      jsonRequest("http://x/api/admin/ai-config/test", "POST", {
        ...baseDraft,
        apiKey: TEST_KEY,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, category: "SUCCESS" });
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
    expect(body.state).toBeDefined();
    expect(body.state.diagnostics.nextAction.code).toBe("SAVE_DRAFT");
    expect(mockTestProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "NVIDIA", model: baseDraft.model }),
      TEST_KEY
    );
    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_DRAFT)).toBe(false);
    expect(JSON.stringify(mockAuditCreate.mock.calls)).not.toContain(TEST_KEY);
  });

  it("memakai API key draft bila body tidak berisi key", async () => {
    signInAs("ADMIN");
    await saveDraftConfig({ ...baseDraft, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    mockTestProviderConnection.mockResolvedValue({
      ok: false,
      category: "AUTH",
      message: "API key tidak valid.",
      latencyMs: 5,
      httpStatus: 401,
      provider: "NVIDIA",
      model: baseDraft.model,
    });

    const res = await testConfig(
      jsonRequest("http://x/api/admin/ai-config/test", "POST", baseDraft)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, category: "AUTH" });
    expect(mockTestProviderConnection).toHaveBeenCalledWith(
      expect.anything(),
      TEST_KEY
    );
  });

  it("memakai API key .env bila provider sama dan belum ada key tersimpan", async () => {
    process.env.AI_API_KEY = "env-connection-key";
    process.env.AI_PROVIDER = "NVIDIA";
    signInAs("ADMIN");
    mockTestProviderConnection.mockResolvedValue({
      ok: true,
      category: "SUCCESS",
      message: "Koneksi berhasil.",
      latencyMs: 9,
      httpStatus: null,
      provider: "NVIDIA",
      model: baseDraft.model,
    });

    const res = await testConfig(
      jsonRequest("http://x/api/admin/ai-config/test", "POST", baseDraft)
    );
    expect(res.status).toBe(200);
    expect(mockTestProviderConnection).toHaveBeenCalledWith(
      expect.anything(),
      "env-connection-key"
    );
    expect(JSON.stringify(await res.json())).not.toContain("env-connection-key");
  });

  it("menolak bila tidak ada API key untuk provider tersebut (400)", async () => {
    signInAs("ADMIN");
    const res = await testConfig(
      jsonRequest("http://x/api/admin/ai-config/test", "POST", baseDraft)
    );
    expect(res.status).toBe(400);
    expect(mockTestProviderConnection).not.toHaveBeenCalled();
  });

  it("menolak API key milik provider lain tanpa request jaringan (400)", async () => {
    signInAs("ADMIN");
    await saveDraftConfig(
      { ...baseDraft, apiKey: TEST_KEY },
      { updatedBy: "Admin" }
    );
    await commitDraftAsActive({
      updatedBy: "Admin",
      expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
    });
    const activeBefore = mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE);
    const secretBefore = mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE);

    const res = await testConfig(
      jsonRequest("http://x/api/admin/ai-config/test", "POST", {
        ...baseDraft,
        provider: "GEMINI",
        model: "gemini-2.5-flash",
        apiKey: TEST_KEY,
      })
    );

    expect(res.status).toBe(400);
    expect(mockTestProviderConnection).not.toHaveBeenCalled();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
    expect(mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(activeBefore);
    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(secretBefore);
  });

  it("uji provider lain tidak menyimpan draft atau mengubah konfigurasi aktif", async () => {
    signInAs("ADMIN");
    await saveDraftConfig(
      { ...baseDraft, apiKey: TEST_KEY },
      { updatedBy: "Admin" }
    );
    await commitDraftAsActive({
      updatedBy: "Admin",
      expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
    });
    const activeBefore = mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE);
    const secretBefore = mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE);
    const draftBefore = mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT);
    mockTestProviderConnection.mockResolvedValue({
      ok: true,
      category: "SUCCESS",
      message: "Koneksi berhasil.",
      latencyMs: 11,
      httpStatus: null,
      provider: "GROQ",
      model: "llama-3.3-70b-versatile",
    });

    const res = await testConfig(
      jsonRequest("http://x/api/admin/ai-config/test", "POST", {
        provider: "GROQ",
        model: "llama-3.3-70b-versatile",
        fallbackModels: [],
        disableThinking: false,
        apiKey: "gsk_groq-request-key",
      })
    );

    expect(res.status).toBe(200);
    expect(mockTestProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "GROQ" }),
      "gsk_groq-request-key"
    );
    expect(mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(activeBefore);
    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(secretBefore);
    expect(mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT)).toBe(draftBefore);

    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("active");
    if (runtime.status === "active") {
      expect(runtime.provider).toBe("NVIDIA");
      expect(runtime.apiKey).toBe(TEST_KEY);
    }
  });
});

describe("POST /api/admin/ai-config/activate", () => {
  it("membatalkan aktivasi saat uji gagal dan konfigurasi aktif lama tetap utuh", async () => {
    signInAs("ADMIN");
    await saveDraftConfig({ ...baseDraft, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    await commitDraftAsActive({
      updatedBy: "Admin",
      expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
    });
    const activeBefore = mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE);
    const secretBefore = mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE);

    await saveDraftConfig(
      {
        provider: "GEMINI",
        model: "gemini-2.0-flash",
        fallbackModels: [],
        disableThinking: false,
        apiKey: "AIza-new-secret-key",
      },
      { updatedBy: "Admin" }
    );
    mockTestProviderConnection.mockResolvedValue({
      ok: false,
      category: "MODEL",
      message: "Model tidak ditemukan.",
      latencyMs: 20,
      httpStatus: 404,
      provider: "GEMINI",
      model: "gemini-2.0-flash",
    });

    const res = await activateConfig();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.category).toBe("MODEL");
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
    expect(JSON.stringify(body)).not.toContain("AIza-new-secret-key");
    expect(mockSettings.get(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(activeBefore);
    expect(mockSettings.get(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(secretBefore);

    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("active");
    if (runtime.status === "active") expect(runtime.provider).toBe("NVIDIA");
  });

  it("TIMEOUT uji koneksi tidak dianggap API key salah dan tidak mengaktifkan apa pun", async () => {
    process.env.AI_API_KEY = "env-timeout-key";
    process.env.AI_PROVIDER = "NVIDIA";
    process.env.AI_MODEL = baseDraft.model;
    signInAs("ADMIN");
    await saveDraftConfig({ ...baseDraft, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    mockTestProviderConnection.mockResolvedValue({
      ok: false,
      category: "TIMEOUT",
      message:
        "Koneksi ke provider melebihi batas waktu. Timeout BUKAN bukti API key salah.",
      latencyMs: 90_000,
      httpStatus: null,
      provider: "NVIDIA",
      model: baseDraft.model,
    });

    const res = await activateConfig();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONNECTION_TEST_FAILED");
    expect(body.category).toBe("TIMEOUT");
    expect(body.state.source).toBe("ENV");
    expect(body.state.diagnostics.nextAction.code).toBe("RETRY_TEST");
    expect(body.state.active).toBeNull();
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
    expect(mockSettings.has(AI_CONFIG_KEYS.CONFIG_ACTIVE)).toBe(false);
    expect(mockSettings.has(AI_CONFIG_KEYS.SECRET_ACTIVE)).toBe(false);

    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("env");
  });

  it("mengaktifkan draft setelah uji sukses dan runtime langsung memakainya", async () => {
    signInAs("ADMIN");
    await saveDraftConfig(
      {
        provider: "GEMINI",
        model: "gemini-2.0-flash",
        fallbackModels: ["gemini-1.5-flash"],
        disableThinking: false,
        apiKey: "AIza-gemini-secret",
      },
      { updatedBy: "Admin" }
    );
    mockTestProviderConnection.mockResolvedValue({
      ok: true,
      category: "SUCCESS",
      message: "Koneksi berhasil.",
      latencyMs: 30,
      httpStatus: null,
      provider: "GEMINI",
      model: "gemini-2.0-flash",
    });

    const res = await activateConfig();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("AIza-gemini-secret");
    expect(body.active.provider).toBe("GEMINI");

    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("active");
    if (runtime.status === "active") {
      expect(runtime.provider).toBe("GEMINI");
      expect(runtime.apiKey).toBe("AIza-gemini-secret");
      expect(runtime.baseUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta"
      );
    }
  });

  it("menolak aktivasi bila belum ada draft (400)", async () => {
    signInAs("ADMIN");
    const res = await activateConfig();
    expect(res.status).toBe(400);
    expect(mockTestProviderConnection).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/ai-config/models", () => {
  it("mengembalikan daftar model tanpa API key", async () => {
    signInAs("ADMIN");
    mockListProviderModels.mockResolvedValue({
      models: ["gemini-2.0-flash", "gemini-1.5-flash"],
      source: "provider",
    });
    const geminiKey = "AIzaSy-gemini-list-key";

    const res = await listModels(
      jsonRequest("http://x/api/admin/ai-config/models", "POST", {
        ...baseDraft,
        provider: "GEMINI",
        model: "gemini-2.0-flash",
        apiKey: geminiKey,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual(["gemini-2.0-flash", "gemini-1.5-flash"]);
    expect(JSON.stringify(body)).not.toContain(geminiKey);
  });

  it("menolak API key provider lain tanpa memanggil provider (400)", async () => {
    signInAs("ADMIN");

    const res = await listModels(
      jsonRequest("http://x/api/admin/ai-config/models", "POST", {
        ...baseDraft,
        provider: "GEMINI",
        model: "gemini-2.0-flash",
        apiKey: TEST_KEY,
      })
    );
    expect(res.status).toBe(400);
    expect(mockListProviderModels).not.toHaveBeenCalled();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
  });

  it("memetakan kegagalan daftar model ke 502 tanpa detail mentah", async () => {
    signInAs("ADMIN");
    const { ModelListError } = jest.requireMock("@/lib/ai/connection") as {
      ModelListError: new (message: string, category: string) => Error;
    };
    mockListProviderModels.mockRejectedValue(
      new ModelListError("API key tidak valid atau ditolak provider.", "AUTH")
    );

    const res = await listModels(
      jsonRequest("http://x/api/admin/ai-config/models", "POST", {
        ...baseDraft,
        apiKey: TEST_KEY,
      })
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.category).toBe("AUTH");
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
  });
});

describe("POST /api/admin/ai-config/deactivate", () => {
  it("menghapus konfigurasi aktif dan kembali ke .env", async () => {
    process.env.AI_API_KEY = "env-key";
    process.env.AI_MODEL = "env-model";
    process.env.AI_PROVIDER = "GROQ";
    signInAs("ADMIN");

    await saveDraftConfig({ ...baseDraft, apiKey: TEST_KEY }, { updatedBy: "Admin" });
    await commitDraftAsActive({
      updatedBy: "Admin",
      expectedRawConfig: mockSettings.get(AI_CONFIG_KEYS.CONFIG_DRAFT) as string,
    });

    const res = await deactivateConfig();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.source).toBe("ENV");
    expect(body.state.effective.provider).toBe("GROQ");

    const runtime = await getRuntimeAIConfig();
    expect(runtime.status).toBe("env");
    if (runtime.status === "env") expect(runtime.apiKey).toBe("env-key");
  });
});
