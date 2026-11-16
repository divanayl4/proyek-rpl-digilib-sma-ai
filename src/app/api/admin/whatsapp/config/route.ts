import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getWhatsAppConfigSummary,
  isWhatsAppCategory,
  normalizeWhatsAppNumber,
  saveWhatsAppConfig,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: "Unauthorized", status: 401 } as const;
  if (session.user.role !== "ADMIN") return { error: "Forbidden", status: 403 } as const;
  return { session } as const;
}

/** GET /api/admin/whatsapp/config — konfigurasi aman (token tidak utuh). */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const config = await getWhatsAppConfigSummary();
  return NextResponse.json({ config });
}

/**
 * PATCH /api/admin/whatsapp/config
 *
 * Body: { token?, adminNumber?, enabled?, enabledCategories? }
 * Token kosong berarti "pertahankan token lama" dan tidak pernah dikembalikan.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    token?: unknown;
    adminNumber?: unknown;
    enabled?: unknown;
    enabledCategories?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  if (body.token !== undefined && typeof body.token !== "string") {
    return NextResponse.json({ error: "Token Fonnte tidak valid" }, { status: 400 });
  }
  if (
    typeof body.token === "string" &&
    body.token.trim() &&
    body.token.trim().length < 8
  ) {
    return NextResponse.json({ error: "Token Fonnte terlalu pendek" }, { status: 400 });
  }

  let adminNumber: string | null | undefined;
  if (body.adminNumber !== undefined) {
    if (body.adminNumber === null || body.adminNumber === "") {
      adminNumber = null;
    } else if (typeof body.adminNumber !== "string") {
      return NextResponse.json({ error: "Nomor Admin tidak valid" }, { status: 400 });
    } else {
      adminNumber = normalizeWhatsAppNumber(body.adminNumber);
      if (!adminNumber) {
        return NextResponse.json(
          { error: "Nomor WhatsApp Admin tidak valid. Contoh: 081234567890." },
          { status: 400 }
        );
      }
    }
  }

  let enabled: boolean | undefined;
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Nilai enabled harus boolean" }, { status: 400 });
    }
    enabled = body.enabled;
  }

  let enabledCategories: string[] | undefined;
  if (body.enabledCategories !== undefined) {
    if (!Array.isArray(body.enabledCategories)) {
      return NextResponse.json(
        { error: "enabledCategories harus berupa array" },
        { status: 400 }
      );
    }
    const invalid = body.enabledCategories.filter((c) => !isWhatsAppCategory(c));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "Kategori notifikasi tidak dikenal" },
        { status: 400 }
      );
    }
    enabledCategories = body.enabledCategories as string[];
  }

  try {
    const config = await saveWhatsAppConfig({
      token: typeof body.token === "string" ? body.token : undefined,
      adminNumber,
      enabled,
      enabledCategories,
    });

    await prisma.auditLog
      .create({
        data: {
          action: "UPDATE_WHATSAPP_CONFIG",
          userId: auth.session.user.id,
          details: "Memperbarui konfigurasi notifikasi WhatsApp Fonnte (token tidak dicatat).",
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ message: "Konfigurasi WhatsApp disimpan", config });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gagal menyimpan konfigurasi";
    // Jangan pernah bocorkan detail internal/token.
    const safe = message.includes("Kunci enkripsi")
      ? message
      : "Gagal menyimpan konfigurasi WhatsApp.";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
