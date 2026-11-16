import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendInAppNotification } from "@/lib/notifications";
import {
  confirmWhatsAppVerification,
  normalizeWhatsAppNumber,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * POST /api/register/verify
 *
 * Mengonfirmasi OTP WhatsApp untuk pendaftaran. Akun baru dibuat aktif
 * (dan notifikasi WhatsApp dihubungkan) HANYA setelah kode cocok.
 * Memakai alur verifikasi yang sama dengan /api/whatsapp/verify (tanpa
 * duplikasi logika).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, phone, code } = body ?? {};

    if (typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "Email wajib diisi" }, { status: 400 });
    }
    if (typeof code !== "string" || !code.trim()) {
      return NextResponse.json({ error: "Kode verifikasi wajib diisi" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        identityNumber: true,
        class: true,
        whatsappNumber: true,
        isActive: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Akun pendaftaran tidak ditemukan." }, { status: 404 });
    }
    if (user.isActive) {
      return NextResponse.json({ error: "Akun sudah terverifikasi/aktif." }, { status: 409 });
    }

    // Gunakan nomor yang tersimpan pada akun pending (server-side) agar tidak
    // bisa diubah di tengah proses. Body `phone` hanya dipakai bila belum ada.
    const numberToVerify = user.whatsappNumber || (typeof phone === "string" ? phone.trim() : "");
    if (!numberToVerify) {
      return NextResponse.json({ error: "Nomor WhatsApp wajib diisi." }, { status: 400 });
    }

    const result = await confirmWhatsAppVerification(user.id, numberToVerify, code.trim());
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.message }, { status: 400 });
    }

    // Aktifkan akun setelah OTP cocok.
    const activated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        identityNumber: true,
        class: true,
        whatsappNumber: true,
      },
    });

    const auditAction = user.role === "STUDENT" ? "REGISTER_STUDENT" : "REGISTER_USER";
    const auditDetail =
      user.role === "STUDENT"
        ? `Siswa baru terdaftar: ${user.email} (${user.role})`
        : `Pengguna baru terdaftar: ${user.email} (${user.role})`;

    await prisma.auditLog
      .create({
        data: { action: auditAction, userId: user.id, details: auditDetail },
      })
      .catch(() => undefined);

    await sendInAppNotification(
      user.id,
      "Akun Berhasil Dibuat",
      "Akun DigiLib Anda berhasil dibuat.",
      "SUCCESS",
      "/profile",
      { eventKey: `user:created:${user.id}`, category: "ACCOUNT" }
    ).catch(() => undefined);

    return NextResponse.json(
      {
        ok: true,
        user: activated,
        message: result.message || "Akun berhasil diverifikasi dan diaktifkan.",
        maskedNumber: result.maskedNumber,
      },
      { status: 201 }
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Nomor WhatsApp sudah digunakan oleh akun lain." }, { status: 409 });
    }
    console.error("[REGISTER VERIFY] Gagal:", error);
    return NextResponse.json({ error: "Gagal terhubung ke server" }, { status: 500 });
  }
}