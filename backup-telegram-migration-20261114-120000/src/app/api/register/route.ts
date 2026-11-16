import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendInAppNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Jika ada sesi yang aktif, tolak permintaan registrasi (hanya siswa tanpa akun)
    if (session?.user) {
      return NextResponse.json(
        { error: "Sudah punya akun. Silakan login." },
        { status: 409 }
      );
    }

    const body = await req.json();
    const { name, email, password, nis, class: userClass } = body;

    // Validasi wajib
    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: "Nama dan email wajib diisi" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password minimal 6 karakter" }, { status: 400 });
    }
    if (!nis?.trim()) {
      return NextResponse.json({ error: "NIS wajib diisi" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Cek duplikat email
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });
    }

    // Hanya siswa boleh mendaftar (role otomatis STUDENT)
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        role: "STUDENT",
        identityNumber: nis.trim(),
        class: userClass?.trim() || null,
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

    
    // Audit log
    await prisma.auditLog.create({
      data: {
        action: "REGISTER_STUDENT",
        userId: user.id,
        details: `Siswa baru terdaftar: ${user.email} (${user.role})`,
      },
    });


    // Notifikasi selamat datang untuk pemilik akun. Sumber teks yang sama
    // dipakai untuk in-app dan Telegram (Telegram hanya untuk STUDENT/TEACHER).
    await sendInAppNotification(
      user.id,
      "Akun Berhasil Dibuat",
      "Akun DigiLib Anda berhasil dibuat.",
      "SUCCESS",
      "/profile",
      { eventKey: `user:created:${user.id}` }
    );

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("[REGISTER] Gagal registrasi:", error);
    return NextResponse.json({ error: "Gagal terhubung ke server" }, { status: 500 });
  }
}