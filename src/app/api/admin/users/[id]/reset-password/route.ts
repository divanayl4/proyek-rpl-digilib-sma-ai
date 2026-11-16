import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

// POST /api/admin/users/[id]/reset-password
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Hanya ADMIN (diperiksa dari sesi server, bukan dari payload/UI).
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let newPassword: unknown;
  try {
    const body = (await req.json()) as { newPassword?: unknown };
    newPassword = body?.newPassword;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
  }

  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return NextResponse.json({ error: "Password minimal 6 karakter" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: params.id },
    data: { passwordHash },
  });

  // Audit hanya mencatat aksi & target; password/hash TIDAK pernah dicatat.
  await prisma.auditLog.create({
    data: {
      action: "RESET_PASSWORD",
      userId: session.user.id,
      details: `Reset password untuk: ${target.email}`,
    },
  });

  // Respons tidak pernah memuat password lama, hash, maupun password baru.
  return NextResponse.json({ message: "Password berhasil direset" });
}
