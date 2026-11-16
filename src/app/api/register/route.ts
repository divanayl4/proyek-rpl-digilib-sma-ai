import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendInAppNotification } from "@/lib/notifications";
import {
  normalizeWhatsAppNumber,
  requestWhatsAppVerification,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const ALLOWED_SELF_REGISTER_ROLES = ["STUDENT", "TEACHER", "STAFF"] as const;

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (session?.user) {
      return NextResponse.json(
        { error: "Sudah punya akun. Silakan login." },
        { status: 409 }
      );
    }

    const body = await req.json();
    const { name, email, password, phone, role, nis, class: userClass } = body;

    // Validasi wajib
    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: "Nama dan email wajib diisi" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password minimal 6 karakter" }, { status: 400 });
    }
    if (!phone?.trim()) {
      return NextResponse.json({ error: "Nomor HP wajib diisi" }, { status: 400 });
    }
    const normalizedPhone = normalizeWhatsAppNumber(phone);
    if (!normalizedPhone) {
      return NextResponse.json({ error: "Nomor HP tidak valid. Contoh: 081234567890." }, { status: 400 });
    }
    if (!role || !ALLOWED_SELF_REGISTER_ROLES.includes(role)) {
      return NextResponse.json({ error: "Role tidak valid." }, { status: 400 });
    }
    if (!nis?.trim()) {
      return NextResponse.json({ error: "NIS wajib diisi" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Cek duplikat email
    const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingEmail) {
      return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });
    }

    // Cek duplikat nomor HP
    const existingPhone = await prisma.user.findUnique({ where: { whatsappNumber: normalizedPhone } });
    if (existingPhone) {
      return NextResponse.json({ error: "Nomor HP sudah digunakan akun lain" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Akun dibuat dalam keadaan nonaktif sampai nomor WhatsApp diverifikasi
    // lewat OTP. Ini memakai alur verifikasi yang sama dengan /api/whatsapp/verify
    // (tanpa duplikasi logika). Akun tidak dapat login sebelum verifikasi.
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        role,
        identityNumber: nis.trim(),
        class: userClass?.trim() || null,
        whatsappNumber: normalizedPhone,
        whatsappVerified: false,
        isActive: false,
        whatsappNotificationsEnabled: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        identityNumber: true,
        class: true,
      },
    });

    // Klaim nomor & kirim OTP 6 digit via Fonnte (alur verifikasi yang sama).
    const verification = await requestWhatsAppVerification(user.id, normalizedPhone);
    if (!verification.ok) {
      // Rollback agar tidak ada akun tak-terverifikasi yang menggantung.
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      return NextResponse.json(
        { error: verification.message || "Gagal mengirim kode verifikasi." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        user: { ...user, whatsappNumber: normalizedPhone },
        verificationRequired: true,
        message: verification.message,
        expiresAt: verification.expiresAt,
        maskedNumber: verification.maskedNumber,
      },
      { status: 201 }
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Nomor WhatsApp sudah digunakan oleh akun lain." }, { status: 409 });
    }
    console.error("[REGISTER] Gagal registrasi:", error);
    return NextResponse.json({ error: "Gagal terhubung ke server" }, { status: 500 });
  }
}