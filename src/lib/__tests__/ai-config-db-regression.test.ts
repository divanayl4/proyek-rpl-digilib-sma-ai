/**
 * Regresi dengan database SQLite SEMENTARA (bukan database aplikasi).
 *
 * Mereproduksi kondisi nyata:
 * - draft ada tetapi belum diaktifkan → runtime tetap .env;
 * - uji koneksi gagal (TIMEOUT) → tidak ada konfigurasi aktif, runtime tetap .env;
 * - aktivasi gagal karena draft berubah → konfigurasi aktif tidak berubah;
 * - aktivasi berhasil → runtime membaca DATABASE tanpa restart;
 * - pembacaan status berikutnya menunjukkan sumber dan diagnostik yang benar.
 *
 * File DB dibuat di direktori temp OS lalu dihapus setelah tes. Database asli
 * (prisma/dev.db) tidak disentuh.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

type StoreModule = typeof import("@/lib/ai/configStore");

jest.setTimeout(30_000);

const dbPath = path.join(
  os.tmpdir(),
  `digilib-ai-regression-${process.pid}-${Date.now()}.db`
);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

let client: PrismaClient;
let store: StoreModule;

const PROVIDER_CONFIG = {
  provider: "NVIDIA" as const,
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  fallbackModels: ["nvidia/nemotron-3-ultra-550b-a55b"],
  disableThinking: true,
};

function successfulTest() {
  const values = store.validateAIConfigInput(PROVIDER_CONFIG).values!;
  return {
    ok: true,
    category: "SUCCESS" as const,
    message: "Koneksi berhasil.",
    at: new Date().toISOString(),
    provider: values.provider,
    model: values.model,
    latencyMs: 12,
    httpStatus: null,
    testedBy: "Admin Regresi",
    configFingerprint: store.fingerprintAIConfig(values),
  };
}

function timeoutTest() {
  const values = store.validateAIConfigInput(PROVIDER_CONFIG).values!;
  return {
    ok: false,
    category: "TIMEOUT" as const,
    message: "Koneksi melebihi batas waktu. Timeout bukan bukti API key salah.",
    at: new Date().toISOString(),
    provider: values.provider,
    model: values.model,
    latencyMs: 25_000,
    httpStatus: null,
    testedBy: "Admin Regresi",
    configFingerprint: store.fingerprintAIConfig(values),
  };
}

beforeAll(async () => {
  process.env.AI_CONFIG_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.AI_API_KEY = "env-regression-key";
  process.env.AI_PROVIDER = "NVIDIA";
  process.env.AI_BASE_URL = "https://integrate.api.nvidia.com/v1";
  process.env.AI_MODEL = PROVIDER_CONFIG.model;

  client = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  await client.$executeRawUnsafe(
    'CREATE TABLE "Setting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  );

  jest.resetModules();
  jest.doMock("@/lib/prisma", () => ({ prisma: client }));
  store = await import("@/lib/ai/configStore");
});

beforeEach(async () => {
  await client.setting.deleteMany();
  process.env.AI_CONFIG_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.AI_API_KEY = "env-regression-key";
  process.env.AI_PROVIDER = "NVIDIA";
  process.env.AI_BASE_URL = "https://integrate.api.nvidia.com/v1";
  process.env.AI_MODEL = PROVIDER_CONFIG.model;
});

afterAll(async () => {
  await client.$disconnect();
  for (const file of [dbPath, `${dbPath}-journal`]) {
    fs.rmSync(file, { force: true });
  }
});

describe("regresi Konfigurasi AI (database sementara)", () => {
  it("sebelum aktivasi: draft tersimpan, tidak ada konfigurasi aktif, runtime .env", async () => {
    await store.saveDraftConfig(
      { ...PROVIDER_CONFIG, apiKey: "draft-regression-key" },
      { updatedBy: "Admin Regresi" }
    );

    // Pastikan modul benar-benar memakai PrismaClient database SEMENTARA.
    expect(await client.setting.count()).toBeGreaterThan(0);
    expect(
      await client.setting.findUnique({
        where: { key: store.AI_CONFIG_KEYS.CONFIG_DRAFT },
      })
    ).not.toBeNull();

    const state = await store.getPublicConfigState();
    const runtime = await store.getRuntimeAIConfig();

    expect(state.source).toBe("ENV");
    expect(state.message).toContain("Belum ada konfigurasi AI aktif di database");
    expect(state.active).toBeNull();
    expect(state.draft).not.toBeNull();
    expect(state.draft?.hasApiKey).toBe(true);
    expect(state.diagnostics.draft.present).toBe(true);
    expect(state.diagnostics.draft.secretValid).toBe(true);
    expect(state.diagnostics.active.present).toBe(false);
    expect(state.diagnostics.runtimeSource).toBe("ENV");
    expect(state.diagnostics.nextAction.code).toBe("TEST_DRAFT");
    expect(runtime.status).toBe("env");
    if (runtime.status === "env") {
      expect(runtime.source).toBe("ENV");
      expect(runtime.apiKey).toBe("env-regression-key");
    }
  });

  it("uji TIMEOUT tidak mengaktifkan konfigurasi dan runtime tetap .env", async () => {
    await store.saveDraftConfig(
      { ...PROVIDER_CONFIG, apiKey: "draft-regression-key" },
      { updatedBy: "Admin Regresi" }
    );
    await store.recordTestResult(timeoutTest());

    const state = await store.getPublicConfigState();
    const runtime = await store.getRuntimeAIConfig();

    expect(state.active).toBeNull();
    expect(state.source).toBe("ENV");
    expect(state.lastTest?.category).toBe("TIMEOUT");
    expect(state.lastTest?.ok).toBe(false);
    expect(state.diagnostics.lastTest).toMatchObject({
      ok: false,
      category: "TIMEOUT",
    });
    expect(state.diagnostics.nextAction.code).toBe("RETRY_TEST");
    expect(state.diagnostics.nextAction.message).toMatch(/TIMEOUT/i);
    expect(state.diagnostics.nextAction.message).toMatch(/bukan bukti API key salah/i);
    expect(runtime.status).toBe("env");
    expect(await store.readActiveConfig()).toBeNull();
  });

  it("aktivasi gagal (draft berubah) tidak menulis konfigurasi aktif", async () => {
    await store.saveDraftConfig(
      { ...PROVIDER_CONFIG, apiKey: "draft-regression-key" },
      { updatedBy: "Admin Regresi" }
    );
    const snapshot = await store.readDraftRuntimeConfig();

    // Simulasikan draft berubah setelah snapshot pengujian.
    await store.saveDraftConfig(
      { ...PROVIDER_CONFIG, model: "model-lain" },
      { updatedBy: "Admin Regresi" }
    );

    await expect(
      store.commitDraftAsActive({
        updatedBy: "Admin Regresi",
        expectedRawConfig: snapshot!.rawConfig!,
        expectedSecretRaw: snapshot!.secretRaw,
      })
    ).rejects.toBeInstanceOf(store.AIDraftChangedError);

    const state = await store.getPublicConfigState();
    expect(state.active).toBeNull();
    expect(state.diagnostics.active.present).toBe(false);
    expect(state.source).toBe("ENV");
    expect((await store.getRuntimeAIConfig()).status).toBe("env");
  });

  it("aktivasi berhasil: runtime berikutnya membaca DATABASE, status ikut berubah", async () => {
    await store.saveDraftConfig(
      { ...PROVIDER_CONFIG, apiKey: "draft-regression-key" },
      { updatedBy: "Admin Regresi" }
    );
    await store.recordTestResult(successfulTest());
    const snapshot = await store.readDraftRuntimeConfig();

    const beforeActivation = await store.getPublicConfigState();
    expect(beforeActivation.diagnostics.nextAction.code).toBe("ACTIVATE_DRAFT");

    await store.commitDraftAsActive({
      updatedBy: "Admin Regresi",
      expectedRawConfig: snapshot!.rawConfig!,
      expectedSecretRaw: snapshot!.secretRaw,
    });

    // Pembacaan ulang (setara request AI berikutnya) tanpa restart proses.
    const runtime = await store.getRuntimeAIConfig();
    expect(runtime.status).toBe("active");
    if (runtime.status === "active") {
      expect(runtime.source).toBe("DATABASE");
      expect(runtime.provider).toBe("NVIDIA");
      expect(runtime.model).toBe(PROVIDER_CONFIG.model);
      expect(runtime.apiKey).toBe("draft-regression-key");
    }

    const state = await store.getPublicConfigState();
    expect(state.source).toBe("DATABASE");
    expect(state.active).not.toBeNull();
    expect(state.diagnostics.active.present).toBe(true);
    expect(state.diagnostics.active.secretValid).toBe(true);
    expect(state.diagnostics.runtimeSource).toBe("DATABASE");
    expect(state.diagnostics.nextAction.code).toBe("NONE");
    expect(state.message).toBeNull();
  });

  it("deaktivasi mengembalikan runtime ke .env dan tidak menyentuh draft", async () => {
    await store.saveDraftConfig(
      { ...PROVIDER_CONFIG, apiKey: "draft-regression-key" },
      { updatedBy: "Admin Regresi" }
    );
    const snapshot = await store.readDraftRuntimeConfig();
    await store.commitDraftAsActive({
      updatedBy: "Admin Regresi",
      expectedRawConfig: snapshot!.rawConfig!,
      expectedSecretRaw: snapshot!.secretRaw,
    });

    await store.deactivateActiveConfig();

    const state = await store.getPublicConfigState();
    expect(state.source).toBe("ENV");
    expect(state.active).toBeNull();
    expect(state.draft).not.toBeNull();
    expect((await store.getRuntimeAIConfig()).status).toBe("env");
  });
});
