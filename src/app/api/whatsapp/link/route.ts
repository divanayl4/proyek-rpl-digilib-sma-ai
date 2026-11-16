import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maskPhoneNumber } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/whatsapp/link
 *
 * Mengaktifkan/mematikan preferensi notifikasi WhatsApp milik akun sendiri.
 * Nomor tetap tersimpan; hanya pengiriman yang dihentikan.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Nilai enabled harus boolean" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { whatsappNumber: true, whatsappVerified: true },
  });

  if (!user?.whatsappNumber || !user.whatsappVerified) {
    return NextResponse.json(
      { error: "Verifikasi nomor WhatsApp terlebih dahulu." },
      { status: 400 }
    );
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: { whatsappNotificationsEnabled: body.enabled },
    select: { whatsappNotificationsEnabled: true, whatsappNumber: true },
  });

  await prisma.auditLog
    .create({
      data: {
        action: "UPDATE_WHATSAPP_PREFERENCE",
        userId: session.user.id,
        details: `Notifikasi WhatsApp ${body.enabled ? "diaktifkan" : "dimatikan"}.`,
      },
    })
    .catch(() => undefined);

  return NextResponse.json({
    ok: true,
    notificationsEnabled: updated.whatsappNotificationsEnabled,
    maskedNumber: maskPhoneNumber(updated.whatsappNumber),
  });
}

/**
 * DELETE /api/whatsapp/link
 *
 * Memutuskan nomor WhatsApp milik akun sendiri. Hanya kolom WhatsApp yang
 * dikosongkan; akun, riwayat transaksi, dan data lain tidak tersentuh.
 */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      whatsappNumber: true,
      whatsappVerificationCodeHash: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });
  }

  if (!user.whatsappNumber && !user.whatsappVerificationCodeHash) {
    return NextResponse.json({
      whatsappVerified: false,
      message: "Nomor WhatsApp Anda belum terhubung.",
    });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      whatsappNumber: null,
      whatsappVerified: false,
      whatsappVerifiedAt: null,
      whatsappNotificationsEnabled: true,
      whatsappVerificationCodeHash: null,
      whatsappVerificationExpiresAt: null,
      whatsappVerificationAttempts: 0,
      whatsappVerificationSentAt: null,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        action: "UNLINK_WHATSAPP",
        userId: session.user.id,
        details: "Memutuskan nomor WhatsApp sendiri.",
      },
    })
    .catch(() => undefined);

  return NextResponse.json({
    whatsappVerified: false,
    message: "Nomor WhatsApp berhasil diputuskan.",
  });
}
