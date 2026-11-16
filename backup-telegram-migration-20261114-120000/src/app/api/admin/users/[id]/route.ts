import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const ROLES = ["ADMIN", "LIBRARIAN", "STUDENT", "TEACHER", "STAFF"];

// GET /api/admin/users/[id] - Get user detail
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Detail pengguna (termasuk riwayat pinjam) adalah administrasi akun — ADMIN saja.
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, email: true, role: true,
      isActive: true, identityNumber: true, class: true,
      createdAt: true, updatedAt: true,
      borrows: {
        select: {
          id: true, borrowDate: true, dueDate: true, returnDate: true, status: true,
          book: { select: { title: true } },
        },
        orderBy: { borrowDate: "desc" },
        take: 5,
      },
    },
  });

  if (!user) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });

  return NextResponse.json({ user });
}

// PATCH /api/admin/users/[id] - Update user
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cannot edit your own role or deactivate yourself
  const body = await req.json();
  const { name, email, role, isActive, identityNumber, class: userClass } = body;

  const targetUser = await prisma.user.findUnique({ where: { id: params.id } });
  if (!targetUser) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });

  // Prevent self-role-change
  if (params.id === session.user.id && role && role !== targetUser.role) {
    return NextResponse.json({ error: "Anda tidak dapat mengubah role sendiri" }, { status: 400 });
  }
  // Prevent self-deactivation
  if (params.id === session.user.id && isActive === false) {
    return NextResponse.json({ error: "Anda tidak dapat menonaktifkan akun sendiri" }, { status: 400 });
  }

  // Validate role
  if (role && !ROLES.includes(role)) {
    return NextResponse.json({ error: "Role tidak valid" }, { status: 400 });
  }

  // Check email uniqueness if changing
  if (email && email !== targetUser.email) {
    const emailExists = await prisma.user.findUnique({ where: { email } });
    if (emailExists) return NextResponse.json({ error: "Email sudah digunakan" }, { status: 409 });
  }

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: {
      ...(name?.trim() && { name: name.trim() }),
      ...(email?.trim() && { email: email.trim().toLowerCase() }),
      ...(role && { role }),
      ...(typeof isActive === "boolean" && { isActive }),
      identityNumber: identityNumber !== undefined ? identityNumber?.trim() || null : undefined,
      class: userClass !== undefined ? userClass?.trim() || null : undefined,
    },
    select: {
      id: true, name: true, email: true, role: true,
      isActive: true, identityNumber: true, class: true, createdAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "UPDATE_USER",
      userId: session.user.id,
      details: `Memperbarui pengguna: ${updated.email}`,
    },
  });

  return NextResponse.json({ user: updated });
}

// DELETE /api/admin/users/[id] - Delete user (admin only)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (params.id === session.user.id) {
    return NextResponse.json({ error: "Anda tidak dapat menghapus akun sendiri" }, { status: 400 });
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: params.id },
      include: {
        _count: {
          select: {
            borrows: true,
            ebookLoans: true,
            finePayments: true,
            auditLogs: true,
          },
        },
      },
    });

    if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });

    if (
      target._count.borrows > 0 ||
      target._count.ebookLoans > 0 ||
      target._count.finePayments > 0 ||
      target._count.auditLogs > 0
    ) {
      return NextResponse.json({
        error: "Pengguna tidak dapat dihapus karena memiliki riwayat transaksi atau audit di sistem. Silakan nonaktifkan akun sebagai gantinya.",
      }, { status: 400 });
    }

    await prisma.notification.deleteMany({ where: { userId: params.id } });
    await prisma.user.delete({ where: { id: params.id } });

    await prisma.auditLog.create({
      data: {
        action: "DELETE_USER",
        userId: session.user.id,
        details: `Menghapus pengguna: ${target.email} (${target.role})`,
      },
    });

    return NextResponse.json({ message: "Pengguna berhasil dihapus" });
  } catch (error) {
    console.error("[DELETE_USER] Error:", error);
    return NextResponse.json({ error: "Gagal menghapus pengguna" }, { status: 500 });
  }
}
