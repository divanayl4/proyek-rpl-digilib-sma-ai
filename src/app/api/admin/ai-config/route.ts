import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  clearDraftApiKey,
  discardDraft,
  getPublicConfigState,
  saveDraftConfig,
  type SaveDraftInput,
} from "@/lib/ai/configStore";
import {
  isConfigurationError,
  isValidationError,
  writeConfigAudit,
} from "@/lib/ai/adminConfigApi";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.user.role !== "ADMIN") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session };
}

/**
 * GET /api/admin/ai-config
 * Metadata aman konfigurasi (tanpa API key/ciphertext).
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const state = await getPublicConfigState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("[AI] Gagal memuat status konfigurasi.", {
      name: error instanceof Error ? error.name : "Error",
    });
    return NextResponse.json(
      { error: "Gagal memuat konfigurasi AI." },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/ai-config
 * Simpan DRAFT. Tidak mengubah konfigurasi aktif.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const session = auth.session;

  let body: SaveDraftInput;
  try {
    body = (await req.json()) as SaveDraftInput;
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  try {
    const saved = await saveDraftConfig(body, {
      updatedBy: session.user.name || session.user.id,
    });
    await writeConfigAudit(
      session.user.id,
      "UPDATE_AI_CONFIG_DRAFT",
      `Menyimpan draft konfigurasi AI (provider=${saved.provider}, model=${saved.model}).`
    );
    const state = await getPublicConfigState();
    return NextResponse.json({
      message: "Draft konfigurasi AI disimpan. Konfigurasi aktif belum berubah.",
      draft: saved,
      state,
    });
  } catch (error) {
    if (isValidationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isConfigurationError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 }
      );
    }
    console.error("[AI] Gagal menyimpan draft konfigurasi.", {
      name: error instanceof Error ? error.name : "Error",
    });
    return NextResponse.json(
      { error: "Gagal menyimpan konfigurasi AI." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/ai-config
 * body: { scope: "key" | "draft" }
 * - key   → hapus API key draft saja.
 * - draft → buang seluruh draft (kembali ke konfigurasi aktif/.env).
 * Konfigurasi aktif dan API key aktif TIDAK pernah dihapus di sini.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const session = auth.session;

  let body: { scope?: unknown } = {};
  try {
    body = (await req.json()) as { scope?: unknown };
  } catch {
    body = {};
  }

  const scope = body.scope === "key" ? "key" : "draft";

  try {
    if (scope === "key") {
      await clearDraftApiKey();
      await writeConfigAudit(
        session.user.id,
        "CLEAR_AI_CONFIG_DRAFT_KEY",
        "Menghapus API key draft konfigurasi AI. Konfigurasi aktif tidak diubah."
      );
    } else {
      await discardDraft();
      await writeConfigAudit(
        session.user.id,
        "DISCARD_AI_CONFIG_DRAFT",
        "Membuang draft konfigurasi AI. Konfigurasi aktif tidak diubah."
      );
    }

    const state = await getPublicConfigState();
    return NextResponse.json({
      message:
        scope === "key"
          ? "API key draft dihapus. API key aktif tetap tersimpan."
          : "Draft konfigurasi dibuang. Konfigurasi aktif tetap digunakan.",
      state,
    });
  } catch (error) {
    if (isConfigurationError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 }
      );
    }
    console.error("[AI] Gagal menghapus draft konfigurasi.", {
      name: error instanceof Error ? error.name : "Error",
    });
    return NextResponse.json(
      { error: "Gagal menghapus draft konfigurasi." },
      { status: 500 }
    );
  }
}
