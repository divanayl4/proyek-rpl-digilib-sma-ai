import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  AIConfigValidationError,
  AIDraftChangedError,
  commitDraftAsActive,
  fingerprintAIConfig,
  getPublicConfigState,
  readDraftRuntimeConfig,
  recordTestResult,
  type AITestResult,
} from "@/lib/ai/configStore";
import {
  isConfigurationError,
  writeConfigAudit,
} from "@/lib/ai/adminConfigApi";
import { testProviderConnection } from "@/lib/ai/connection";

export const dynamic = "force-dynamic";

/**
 * Status publik untuk respons gagal. Kegagalan membaca status tidak boleh
 * menutupi error utama, jadi hasilnya null bila gagal.
 */
async function readPublicStateSafely() {
  try {
    return await getPublicConfigState();
  } catch {
    return null;
  }
}

/**
 * POST /api/admin/ai-config/activate
 *
 * Aktivasi atomik:
 * 1. Ambil snapshot draft + API key.
 * 2. Uji koneksi live ke model utama (tanpa fallback/tools).
 * 3. Bila gagal → konfigurasi aktif TIDAK berubah.
 * 4. Bila berhasil → salin config + secret ke baris aktif dalam satu transaksi.
 *
 * Draft yang berubah sejak snapshot pengujian membatalkan aktivasi.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const draft = await readDraftRuntimeConfig();
    if (!draft) {
      console.warn("[AI] Aktivasi ditolak: draft tidak tersedia.", {
        code: "DRAFT_MISSING",
      });
      return NextResponse.json(
        {
          error:
            "Belum ada draft konfigurasi. Pilih provider, isi API key dan model, lalu simpan draft terlebih dahulu.",
          code: "DRAFT_MISSING",
          state: await readPublicStateSafely(),
        },
        { status: 400 }
      );
    }
    if (!draft.apiKey) {
      console.warn("[AI] Aktivasi ditolak: secret draft tidak tersedia.", {
        code: "DRAFT_SECRET_MISSING",
        provider: draft.config.provider,
      });
      return NextResponse.json(
        {
          error:
            "API key draft belum tersimpan. Masukkan API key lalu simpan draft sebelum aktivasi.",
          code: "DRAFT_SECRET_MISSING",
          state: await readPublicStateSafely(),
        },
        { status: 400 }
      );
    }
    if (!draft.rawConfig) {
      return NextResponse.json(
        {
          error: "Draft konfigurasi tidak dapat dibaca.",
          code: "DRAFT_INVALID",
          state: await readPublicStateSafely(),
        },
        { status: 400 }
      );
    }

    const outcome = await testProviderConnection(draft.config, draft.apiKey);
    const result: AITestResult = {
      ...outcome,
      at: new Date().toISOString(),
      testedBy: session.user.name || session.user.id,
      configFingerprint: fingerprintAIConfig(draft.config),
    };
    await recordTestResult(result);

    if (!outcome.ok) {
      await writeConfigAudit(
        session.user.id,
        "ACTIVATE_AI_CONFIG_FAILED",
        `Aktivasi AI dibatalkan karena uji koneksi gagal (provider=${draft.config.provider}, model=${draft.config.model}, kategori=${outcome.category}). Konfigurasi aktif tidak diubah.`
      );
      // Diagnostik aman: hanya status/boolean/kategori, tanpa key/ciphertext.
      console.warn("[AI] Aktivasi ditolak: uji koneksi gagal.", {
        code: "CONNECTION_TEST_FAILED",
        provider: draft.config.provider,
        category: outcome.category,
        httpStatus: outcome.httpStatus,
        latencyMs: outcome.latencyMs,
        runtimeSourceBeforeActivation: (await readPublicStateSafely())?.source ?? null,
      });
      return NextResponse.json(
        {
          error:
            "Aktivasi dibatalkan karena uji koneksi gagal. Konfigurasi aktif sebelumnya tetap digunakan.",
          code: "CONNECTION_TEST_FAILED",
          category: outcome.category,
          test: result,
          state: await readPublicStateSafely(),
        },
        { status: 409 }
      );
    }

    const active = await commitDraftAsActive({
      updatedBy: session.user.name || session.user.id,
      expectedRawConfig: draft.rawConfig,
      expectedSecretRaw: draft.secretRaw,
    });

    await writeConfigAudit(
      session.user.id,
      "ACTIVATE_AI_CONFIG",
      `Mengaktifkan konfigurasi AI (provider=${active.provider}, model=${active.model}).`
    );

    const state = await getPublicConfigState();
    console.info("[AI] Aktivasi berhasil.", {
      code: "ACTIVATED",
      provider: active.provider,
      model: active.model,
      runtimeSource: state.source,
    });
    return NextResponse.json({
      message:
        "Konfigurasi AI berhasil diaktifkan. Request AI berikutnya memakai konfigurasi baru tanpa restart server.",
      code: "ACTIVATED",
      active: {
        provider: active.provider,
        model: active.model,
        fallbackModels: active.fallbackModels,
        activatedAt: active.activatedAt ?? active.updatedAt,
      },
      test: result,
      state,
    });
  } catch (error) {
    if (error instanceof AIDraftChangedError) {
      return NextResponse.json(
        { error: error.message, code: "DRAFT_CHANGED", state: await readPublicStateSafely() },
        { status: 409 }
      );
    }
    if (error instanceof AIConfigValidationError) {
      return NextResponse.json(
        { error: error.message, code: "DRAFT_INVALID", state: await readPublicStateSafely() },
        { status: 400 }
      );
    }
    if (isConfigurationError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          state: await readPublicStateSafely(),
        },
        { status: 503 }
      );
    }
    console.error("[AI] Gagal mengaktifkan konfigurasi.", {
      name: error instanceof Error ? error.name : "Error",
    });
    return NextResponse.json(
      { error: "Gagal mengaktifkan konfigurasi AI. Konfigurasi aktif tidak diubah." },
      { status: 500 }
    );
  }
}
