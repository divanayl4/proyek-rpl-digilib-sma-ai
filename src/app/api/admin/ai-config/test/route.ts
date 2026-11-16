import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  AIConfigValidationError,
  fingerprintAIConfig,
  getPublicConfigState,
  recordTestResult,
  validateAIConfigInput,
  type AITestResult,
} from "@/lib/ai/configStore";
import {
  isConfigurationError,
  resolveApiKeyForConfig,
  writeConfigAudit,
} from "@/lib/ai/adminConfigApi";
import { testProviderConnection } from "@/lib/ai/connection";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ai-config/test
 *
 * Menguji konfigurasi yang sedang diedit TANPA mengubah konfigurasi aktif.
 * API key boleh dikirim pada body (tidak disimpan) atau memakai key draft/aktif
 * dengan provider yang sama. Hanya satu request minimal yang dikirim.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const validation = validateAIConfigInput(body);
  if (!validation.ok || !validation.values) {
    return NextResponse.json(
      { error: validation.error || "Konfigurasi tidak valid." },
      { status: 400 }
    );
  }
  const values = validation.values;

  try {
    const resolved = await resolveApiKeyForConfig(values, body.apiKey);
    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "API key belum tersedia untuk provider ini. Masukkan API key terlebih dahulu.",
          code: "NO_API_KEY",
        },
        { status: 400 }
      );
    }

    const outcome = await testProviderConnection(values, resolved.apiKey);
    const result: AITestResult = {
      ...outcome,
      at: new Date().toISOString(),
      testedBy: session.user.name || session.user.id,
      configFingerprint: fingerprintAIConfig(values),
    };

    // Hanya metadata aman yang disimpan (tanpa API key/prompt/respons mentah).
    await recordTestResult(result);
    await writeConfigAudit(
      session.user.id,
      "TEST_AI_CONFIG",
      `Uji koneksi AI (provider=${values.provider}, model=${values.model}, hasil=${outcome.ok ? "OK" : outcome.category}).`
    );

    return NextResponse.json({
      ok: outcome.ok,
      category: outcome.category,
      message: outcome.message,
      latencyMs: outcome.latencyMs,
      httpStatus: outcome.httpStatus,
      provider: outcome.provider,
      model: outcome.model,
      testedAt: result.at,
      state: await getPublicConfigState(),
    });
  } catch (error) {
    if (error instanceof AIConfigValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isConfigurationError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 }
      );
    }
    console.error("[AI] Gagal menguji koneksi provider.", {
      name: error instanceof Error ? error.name : "Error",
    });
    return NextResponse.json(
      { error: "Gagal menguji koneksi provider." },
      { status: 500 }
    );
  }
}
