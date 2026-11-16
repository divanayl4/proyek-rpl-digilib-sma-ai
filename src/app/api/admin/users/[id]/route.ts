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

  const auditAction =
    typeof isActive === "boolean" && isActive === false
      ? "USER_DEACTIVATED"
      : typeof isActive === "boolean" && isActive === true && !targetUser.isActive
        ? "USER_ACTIVATED"
        : "UPDATE_USER";

  await prisma.auditLog.create({
    data: {
      action: auditAction,
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
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        whatsappNumber: true,
        _count: {
          select: {
            borrows: true,
            ebookLoans: true,
            finePayments: true,
            auditLogs: true,
            notifications: true,
            ebookReadingSessions: true,
          },
        },
      },
    });

    if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });

    // Hapus permanen. Relasi dependen dibersihkan dalam satu transaksi agar
    // integritas FK tetap terjaga; riwayat audit dilepas (userId=null) tanpa
    // menghapus log-nya. Email & nomor WhatsApp otomatis terlepas karena baris
    // User dihapus (unique constraint tidak lagi terpakai).
    // Urutan penting: hapus data dependen sebelum menghapus User (FK restrict).
    await prisma.notification.deleteMany({ where: { userId: params.id } });
    await prisma.ebookReadingSession.deleteMany({ where: { userId: params.id } });
    await prisma.ebookLoan.deleteMany({ where: { userId: params.id } });
    await prisma.borrowRecord.deleteMany({ where: { userId: params.id } });

    // Lepas referensi opsional agar transaksi yang dibuat/diproses oleh
    // pengguna ini tetap tercatat tanpa user yang sudah dihapus.
    await prisma.borrowRecord.updateMany({
      where: { createdById: params.id },
      data: { createdById: null },
    });
    await prisma.borrowRecord.updateMany({
      where: { approvedById: params.id },
      data: { approvedById: null },
    });
    await prisma.borrowRecord.updateMany({
      where: { finePaidById: params.id },
      data: { finePaidById: null },
    });
    await prisma.finePayment.updateMany({
      where: { recordedById: params.id },
      data: { recordedById: null },
    });
    await prisma.auditLog.updateMany({
      where: { userId: params.id },
      data: { userId: null },
    });

    await prisma.user.delete({ where: { id: params.id } });

    await prisma.auditLog.create({
      data: {
        action: "USER_DELETED",
        userId: session.user.id,
        details: `Menghapus pengguna permanen: ${target.email} (${target.role})`,
      },
    });

    return NextResponse.json({ message: "Pengguna berhasil dihapus permanen", deleted: true });
  } catch (error) {
    console.error("[USER_DELETED] Error:", error);
    return NextResponse.json({ error: "Gagal menghapus pengguna" }, { status: 500 });
  }
}
