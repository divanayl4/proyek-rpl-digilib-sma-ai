import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  confirmWhatsAppVerification,
  requestWhatsAppVerification,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/verify
 *
 * Meminta kode verifikasi 6 digit untuk nomor WhatsApp milik akun yang sedang
 * login. Identitas selalu dari sesi; tidak ada nomor/user lain yang dapat
 * didaftarkan. Kode dikirim dari nomor Admin Fonnte.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { number?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  if (typeof body.number !== "string" || !body.number.trim()) {
    return NextResponse.json({ error: "Nomor WhatsApp wajib diisi" }, { status: 400 });
  }

  const result = await requestWhatsAppVerification(session.user.id, body.number);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
    expiresAt: result.expiresAt,
    maskedNumber: result.maskedNumber,
  });
}

/**
 * PUT /api/whatsapp/verify
 *
 * Mengonfirmasi kode. Nomor hanya disimpan setelah kode cocok dan belum
 * digunakan akun lain (unique constraint di database).
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { number?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  if (typeof body.number !== "string" || typeof body.code !== "string") {
    return NextResponse.json(
      { error: "Nomor dan kode verifikasi wajib diisi" },
      { status: 400 }
    );
  }

  const result = await confirmWhatsAppVerification(
    session.user.id,
    body.number,
    body.code
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.message }, { status: 400 });
  }

  await prisma.auditLog
    .create({
      data: {
        action: "VERIFY_WHATSAPP",
        userId: session.user.id,
        details: "Memverifikasi nomor WhatsApp sendiri.",
      },
    })
    .catch(() => undefined);

  return NextResponse.json({
    ok: true,
    message: result.message,
    maskedNumber: result.maskedNumber,
  });
}
