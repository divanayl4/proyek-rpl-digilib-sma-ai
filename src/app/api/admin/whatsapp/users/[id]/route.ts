import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maskPhoneNumber, normalizeWhatsAppNumber } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/whatsapp/users/[id]
 *
 * Administrator dapat mengelola nomor WhatsApp pengguna:
 * - whatsappNumber: string (62…/08…) untuk menetapkan, null/"" untuk menghapus.
 * - verified: boolean (default true saat nomor baru ditetapkan oleh Admin).
 * - notificationsEnabled: boolean.
 *
 * Nomor tetap unik: satu nomor hanya boleh dipakai satu akun DigiLib.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    whatsappNumber?: unknown;
    verified?: unknown;
    notificationsEnabled?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, email: true, whatsappNumber: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  let auditParts: string[] = [];

  if (body.whatsappNumber !== undefined) {
    if (body.whatsappNumber === null || body.whatsappNumber === "") {
      data.whatsappNumber = null;
      data.whatsappVerified = false;
      data.whatsappVerifiedAt = null;
      data.whatsappVerificationCodeHash = null;
      data.whatsappVerificationExpiresAt = null;
      data.whatsappVerificationAttempts = 0;
      data.whatsappVerificationSentAt = null;
      auditParts.push("menghapus nomor WhatsApp");
    } else if (typeof body.whatsappNumber !== "string") {
      return NextResponse.json({ error: "Nomor WhatsApp tidak valid" }, { status: 400 });
    } else {
      const normalized = normalizeWhatsAppNumber(body.whatsappNumber);
      if (!normalized) {
        return NextResponse.json(
          { error: "Nomor WhatsApp tidak valid. Contoh: 081234567890." },
          { status: 400 }
        );
      }
      const taken = await prisma.user.findFirst({
        where: { whatsappNumber: normalized, NOT: { id: params.id } },
        select: { id: true },
      });
      if (taken) {
        return NextResponse.json(
          { error: "Nomor ini sudah digunakan akun DigiLib lain." },
          { status: 409 }
        );
      }
      const verified =
        typeof body.verified === "boolean" ? body.verified : true;
      data.whatsappNumber = normalized;
      data.whatsappVerified = verified;
      data.whatsappVerifiedAt = verified ? new Date() : null;
      data.whatsappVerificationCodeHash = null;
      data.whatsappVerificationExpiresAt = null;
      data.whatsappVerificationAttempts = 0;
      data.whatsappVerificationSentAt = null;
      auditParts.push(
        `menetapkan nomor ${normalized.slice(0, 4)}••••${normalized.slice(-3)}` +
          (verified ? " (terverifikasi)" : " (belum terverifikasi)")
      );
    }
  }

  if (body.verified !== undefined && body.whatsappNumber === undefined) {
    if (typeof body.verified !== "boolean") {
      return NextResponse.json({ error: "Nilai verified harus boolean" }, { status: 400 });
    }
    if (!target.whatsappNumber) {
      return NextResponse.json(
        { error: "Pengguna belum memiliki nomor WhatsApp" },
        { status: 400 }
      );
    }
    data.whatsappVerified = body.verified;
    data.whatsappVerifiedAt = body.verified ? new Date() : null;
    auditParts.push(body.verified ? "memverifikasi nomor" : "mencabut verifikasi nomor");
  }

  if (body.notificationsEnabled !== undefined) {
    if (typeof body.notificationsEnabled !== "boolean") {
      return NextResponse.json(
        { error: "Nilai notificationsEnabled harus boolean" },
        { status: 400 }
      );
    }
    data.whatsappNotificationsEnabled = body.notificationsEnabled;
    auditParts.push(
      body.notificationsEnabled
        ? "mengaktifkan notifikasi"
        : "mematikan notifikasi"
    );
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Tidak ada perubahan" }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        whatsappNumber: true,
        whatsappVerified: true,
        whatsappVerifiedAt: true,
        whatsappNotificationsEnabled: true,
      },
    });

    await prisma.auditLog
      .create({
        data: {
          action: "ADMIN_UPDATE_WHATSAPP_USER",
          userId: session.user.id,
          details: `Mengelola WhatsApp ${target.email}: ${auditParts.join("; ")}.`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({
      user: {
        ...updated,
        whatsappNumber: undefined,
        whatsappNumberMasked: maskPhoneNumber(updated.whatsappNumber),
        hasWhatsappNumber: Boolean(updated.whatsappNumber),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "Nomor ini sudah digunakan akun DigiLib lain." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Gagal menyimpan nomor WhatsApp" },
      { status: 500 }
    );
  }
}
