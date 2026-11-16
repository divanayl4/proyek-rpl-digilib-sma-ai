import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  AIConfigurationError,
  deactivateActiveConfig,
  getPublicConfigState,
} from "@/lib/ai/configStore";
import { writeConfigAudit } from "@/lib/ai/adminConfigApi";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ai-config/deactivate
 *
 * Menghapus konfigurasi aktif di database. Runtime kembali ke fallback .env
 * (bila tersedia). Draft dan API key draft tetap disimpan agar Admin dapat
 * mengaktifkan kembali tanpa mengetik ulang API key.
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
    await deactivateActiveConfig();
    await writeConfigAudit(
      session.user.id,
      "DEACTIVATE_AI_CONFIG",
      "Menonaktifkan konfigurasi AI aktif. Runtime kembali ke fallback .env bila tersedia."
    );
    const state = await getPublicConfigState();
    return NextResponse.json({
      message:
        "Konfigurasi AI aktif dinonaktifkan. Runtime kembali ke konfigurasi .env bila tersedia.",
      state,
    });
  } catch (error) {
    if (error instanceof AIConfigurationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 }
      );
    }
    console.error("[AI] Gagal menonaktifkan konfigurasi.", {
      name: error instanceof Error ? error.name : "Error",
    });
    return NextResponse.json(
      { error: "Gagal menonaktifkan konfigurasi AI." },
      { status: 500 }
    );
  }
}
