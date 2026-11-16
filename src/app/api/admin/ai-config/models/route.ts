import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  AIConfigValidationError,
  validateAIConfigInput,
} from "@/lib/ai/configStore";
import {
  isConfigurationError,
  resolveApiKeyForConfig,
} from "@/lib/ai/adminConfigApi";
import { ModelListError, listProviderModels } from "@/lib/ai/connection";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ai-config/models
 *
 * Memuat daftar model dari endpoint provider bila tersedia. API key tidak
 * pernah dikirim melalui URL/query string. Kegagalan daftar model bukan
 * kegagalan koneksi: UI tetap harus menyediakan input model manual.
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
            "API key belum tersedia untuk provider ini. Masukkan API key terlebih dahulu, atau isi model secara manual.",
        },
        { status: 400 }
      );
    }

    const result = await listProviderModels(values, resolved.apiKey);
    return NextResponse.json({
      models: result.models,
      source: result.source,
      provider: values.provider,
      count: result.models.length,
    });
  } catch (error) {
    if (error instanceof AIConfigValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ModelListError) {
      // Kategori aman; detail provider tidak diteruskan.
      return NextResponse.json(
        { error: error.message, category: error.category },
        {
          status:
            error.category === "INVALID_CONFIG" ||
            error.category === "INVALID_REQUEST"
              ? 400
              : 502,
        }
      );
    }
    if (isConfigurationError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 }
      );
    }
    console.error("[AI] Gagal memuat daftar model.", {
      name: error instanceof Error ? error.name : "Error",
    });
    return NextResponse.json(
      { error: "Gagal memuat daftar model. Gunakan input model manual." },
      { status: 502 }
    );
  }
}
