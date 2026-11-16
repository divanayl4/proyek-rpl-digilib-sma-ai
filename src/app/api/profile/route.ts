import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanOptionalText } from "@/lib/books";
import { maskPhoneNumber } from "@/lib/whatsapp";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const GENDERS = ["MALE", "FEMALE"];
const MAX_NAME_LENGTH = 100;
const MAX_TEXT_LENGTH = 100;

/**
 * GET /api/profile
 *
 * Profil milik pengguna yang sedang login. Identitas selalu diambil dari sesi,
 * bukan dari parameter klien, sehingga seorang pengguna tidak dapat membaca
 * profil orang lain.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      gender: true,
      identityNumber: true,
      class: true,
      isActive: true,
      createdAt: true,
      whatsappNumber: true,
      whatsappVerified: true,
      whatsappVerifiedAt: true,
      whatsappNotificationsEnabled: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });
  }

  // Nomor lengkap tidak pernah dikirim ke klien; hanya versi tersamarkan.
  const { whatsappNumber, ...profile } = user;
  return NextResponse.json({
    user: {
      ...profile,
      whatsappNumberMasked: maskPhoneNumber(whatsappNumber),
    },
  });
}

/**
 * PATCH /api/profile
 *
 * Memperbarui profil sendiri. Field yang boleh diubah sengaja dibatasi:
 * role, isActive, dan email TIDAK dapat diubah dari sini. Perubahan role hanya
 * melalui Admin agar tidak terjadi peningkatan hak akses mandiri.
 *
 * Perubahan password memerlukan verifikasi password lama.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });
  }

  const { name, gender, identityNumber, class: userClass, currentPassword, newPassword } = body;

  const data: Record<string, unknown> = {};

  // --- Nama -----------------------------------------------------------
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nama wajib diisi" }, { status: 400 });
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Nama maksimal ${MAX_NAME_LENGTH} karakter` },
        { status: 400 }
      );
    }
    data.name = name.trim();
  }

  // --- Gender ---------------------------------------------------------
  if (gender !== undefined) {
    if (gender === null || gender === "") {
      data.gender = null;
    } else if (typeof gender === "string" && GENDERS.includes(gender)) {
      data.gender = gender;
    } else {
      return NextResponse.json({ error: "Jenis kelamin tidak valid" }, { status: 400 });
    }
  }

  // --- Nomor identitas (NIS/NIP) --------------------------------------
  if (identityNumber !== undefined) {
    const cleaned = cleanOptionalText(identityNumber);
    if (cleaned && cleaned.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: "Nomor identitas terlalu panjang" }, { status: 400 });
    }
    data.identityNumber = cleaned;
  }

  // --- Kelas (khusus siswa) -------------------------------------------
  if (userClass !== undefined) {
    const cleaned = cleanOptionalText(userClass);
    if (cleaned && cleaned.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: "Nama kelas terlalu panjang" }, { status: 400 });
    }
    data.class = cleaned;
  }

  // --- Password (opsional) --------------------------------------------
  const wantsPasswordChange = newPassword !== undefined && newPassword !== "";
  if (wantsPasswordChange) {
    if (typeof currentPassword !== "string" || currentPassword.length === 0) {
      return NextResponse.json(
        { error: "Password lama wajib diisi untuk mengubah password" },
        { status: 400 }
      );
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return NextResponse.json(
        { error: "Password baru minimal 6 karakter" },
        { status: 400 }
      );
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Password lama tidak sesuai" }, { status: 400 });
    }

    data.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Tidak ada perubahan yang dikirim" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      gender: true,
      identityNumber: true,
      class: true,
      isActive: true,
      createdAt: true,
    },
  });

  // Audit log menyimpan ringkasan perubahan saja — bukan password.
  const changedFields = Object.keys(data)
    .map((key) => (key === "passwordHash" ? "password" : key))
    .filter((key) => key !== "password" || wantsPasswordChange);

  await prisma.auditLog.create({
    data: {
      action: "UPDATE_PROFILE",
      userId: session.user.id,
      details: `Memperbarui profil sendiri. Field: ${changedFields.join(", ")}`,
    },
  });

  return NextResponse.json({ user: updated });
}
