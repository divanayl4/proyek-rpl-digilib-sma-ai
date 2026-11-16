/**
 * Audit koneksi provider/model AI secara AKTUAL (bukan hanya membaca konfigurasi).
 *
 * - Membaca konfigurasi aktif, draft, dan .env.
 * - Menguji koneksi model utama + fallback yang tersimpan.
 * - Memuat daftar model dari provider (bila key tersedia).
 * - Tidak mengubah konfigurasi aktif/draft dan tidak menyimpan hasil uji.
 *
 * Jalankan: npx tsx scripts/audit-providers.ts
 */
import {
  getRuntimeAIConfig,
  readDraftRuntimeConfig,
  readEnvRuntime,
} from "../src/lib/ai/configStore";
import { testProviderConnection, listProviderModels } from "../src/lib/ai/connection";
import type { AIConfigValues } from "../src/lib/ai/configStore";
import { AI_PROVIDER_IDS } from "../src/lib/ai/providers";

type Report = Record<string, unknown>;

async function testModel(
  label: string,
  values: AIConfigValues,
  apiKey: string
): Promise<Report> {
  const outcome = await testProviderConnection(values, apiKey);
  return {
    label,
    provider: outcome.provider,
    model: outcome.model,
    ok: outcome.ok,
    category: outcome.category,
    httpStatus: outcome.httpStatus,
    latencyMs: outcome.latencyMs,
    message: outcome.message,
  };
}

async function main() {
  const reports: Report[] = [];

  const runtime = await getRuntimeAIConfig();
  const draft = await readDraftRuntimeConfig().catch(() => null);
  const env = readEnvRuntime();

  console.log("=== RUNTIME CONFIG ===");
  console.log(
    JSON.stringify(
      runtime.status === "active" || runtime.status === "env"
        ? {
            status: runtime.status,
            source: runtime.source,
            provider: runtime.provider,
            model: runtime.model,
            fallbackModels: runtime.fallbackModels,
            baseUrl: runtime.baseUrl,
            disableThinking: runtime.disableThinking,
            hasApiKey: Boolean(runtime.apiKey),
          }
        : runtime,
      null,
      2
    )
  );

  console.log("\n=== DRAFT CONFIG ===");
  console.log(
    JSON.stringify(
      draft
        ? {
            provider: draft.config.provider,
            model: draft.config.model,
            fallbackModels: draft.config.fallbackModels,
            hasApiKey: Boolean(draft.apiKey),
          }
        : null,
      null,
      2
    )
  );

  console.log("\n=== ENV CONFIG ===");
  console.log(
    JSON.stringify(
      env.status === "env"
        ? {
            provider: env.provider,
            model: env.model,
            fallbackModels: env.fallbackModels,
            baseUrl: env.baseUrl,
            disableThinking: env.disableThinking,
            hasApiKey: Boolean(env.apiKey),
          }
        : env,
      null,
      2
    )
  );

  // 1. Uji model aktif (DB) — provider yang dipilih pengguna.
  if (runtime.status === "active" || runtime.status === "env") {
    const values: AIConfigValues = {
      provider: runtime.provider as AIConfigValues["provider"],
      model: runtime.model,
      fallbackModels: runtime.fallbackModels,
      disableThinking: runtime.disableThinking,
      baseUrl: runtime.baseUrl,
    };
    reports.push(await testModel(`runtime:${runtime.source}`, values, runtime.apiKey));
    for (const fallback of runtime.fallbackModels) {
      reports.push(
        await testModel(`runtime-fallback`, { ...values, model: fallback, fallbackModels: [] }, runtime.apiKey)
      );
    }
  }

  // 2. Uji draft (bila berbeda dari runtime).
  if (draft?.apiKey) {
    reports.push(
      await testModel("draft", draft.config, draft.apiKey)
    );
    for (const fallback of draft.config.fallbackModels) {
      reports.push(
        await testModel(
          "draft-fallback",
          { ...draft.config, model: fallback, fallbackModels: [] },
          draft.apiKey
        )
      );
    }
  }

  // 3. Uji provider .env (bila punya key).
  if (env.status === "env") {
    const values: AIConfigValues = {
      provider: env.provider as AIConfigValues["provider"],
      model: env.model,
      fallbackModels: env.fallbackModels,
      disableThinking: env.disableThinking,
      baseUrl: env.baseUrl,
    };
    reports.push(await testModel("env", values, env.apiKey));
  }

  // 4. Daftar model yang benar-benar tersedia untuk setiap key yang dimiliki.
  console.log("\n=== MODEL LISTS ===");
  const seen = new Set<string>();
  const keys: Array<{ label: string; values: AIConfigValues; apiKey: string }> = [];
  if (runtime.status === "active" || runtime.status === "env") {
    keys.push({
      label: `runtime:${runtime.provider}`,
      values: {
        provider: runtime.provider as AIConfigValues["provider"],
        model: runtime.model,
        fallbackModels: [],
        disableThinking: runtime.disableThinking,
        baseUrl: runtime.baseUrl,
      },
      apiKey: runtime.apiKey,
    });
  }
  if (draft?.apiKey) {
    keys.push({ label: `draft:${draft.config.provider}`, values: draft.config, apiKey: draft.apiKey });
  }
  if (env.status === "env") {
    keys.push({
      label: `env:${env.provider}`,
      values: {
        provider: env.provider as AIConfigValues["provider"],
        model: env.model,
        fallbackModels: [],
        disableThinking: env.disableThinking,
        baseUrl: env.baseUrl,
      },
      apiKey: env.apiKey,
    });
  }

  for (const entry of keys) {
    const key = `${entry.values.provider}:${entry.apiKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const list = await listProviderModels(entry.values, entry.apiKey);
      console.log(
        `${entry.label} -> ${list.models.length} model tersedia. Contoh: ${list.models
          .slice(0, 8)
          .join(", ")}`
      );
      reports.push({
        label: `${entry.label}:model-list`,
        provider: entry.values.provider,
        ok: true,
        count: list.models.length,
      });
    } catch (error) {
      const err = error as { message?: string; category?: string };
      console.log(`${entry.label} -> GAGAL memuat daftar model: ${err.message ?? error}`);
      reports.push({
        label: `${entry.label}:model-list`,
        provider: entry.values.provider,
        ok: false,
        category: err.category ?? "UNKNOWN",
        message: err.message ?? String(error),
      });
    }
  }

  console.log("\n=== CONNECTION RESULTS ===");
  for (const r of reports) {
    const row = r as Record<string, unknown>;
    console.log(
      `${String(row.ok).padEnd(5)} ${String(row.label).padEnd(22)} ${String(
        row.provider ?? "-"
      ).padEnd(12)} ${String(row.model ?? "-").padEnd(48)} ${String(
        row.category ?? "-"
      ).padEnd(10)} ${String(row.httpStatus ?? "-").padEnd(5)} ${String(
        row.latencyMs ?? "-"
      ).padStart(6)}ms  ${row.message ?? ""}`
    );
  }

  console.log("\n=== PROVIDERS YANG TIDAK MEMILIKI KEY ===");
  const configuredProviders = new Set<string>();
  if (runtime.status === "active" || runtime.status === "env") configuredProviders.add(runtime.provider);
  if (draft) configuredProviders.add(draft.config.provider);
  if (env.status === "env") configuredProviders.add(env.provider);
  for (const id of AI_PROVIDER_IDS) {
    if (!configuredProviders.has(id)) {
      console.log(`${id}: tidak dapat diuji — tidak ada API key tersimpan untuk provider ini.`);
    }
  }

  const failed = reports.filter((r) => (r as Record<string, unknown>).ok === false);
  console.log(`\n=== RINGKASAN: ${reports.length - failed.length}/${reports.length} pemeriksaan OK ===`);
  process.exitCode = failed.length > 0 ? 2 : 0;
}

main().catch((error) => {
  console.error("AUDIT_PROVIDER_ERROR", error);
  process.exit(1);
});
