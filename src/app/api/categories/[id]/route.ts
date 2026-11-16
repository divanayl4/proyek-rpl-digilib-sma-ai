import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// PATCH /api/categories/[id]
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!["ADMIN", "LIBRARIAN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nama kategori wajib diisi" }, { status: 400 });
    }

    const target = await prisma.category.findUnique({ where: { id: params.id } });
    if (!target) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 });

    const existing = await prisma.category.findUnique({ where: { name: name.trim() } });
    if (existing && existing.id !== params.id) {
      return NextResponse.json({ error: "Kategori dengan nama tersebut sudah ada" }, { status: 409 });
    }

    const category = await prisma.category.update({
      where: { id: params.id },
      data: { name: name.trim() },
    });

    await prisma.auditLog.create({
      data: {
        action: "UPDATE_CATEGORY",
        userId: session.user.id,
        details: `Mengubah kategori: ${target.name} menjadi ${category.name}`,
      },
    });

    return NextResponse.json(category);
  } catch (error) {
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

// DELETE /api/categories/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!["ADMIN", "LIBRARIAN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const target = await prisma.category.findUnique({
      where: { id: params.id },
      include: { _count: { select: { books: true } } },
    });
    
    if (!target) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 });

    if (target._count.books > 0) {
      return NextResponse.json({ error: "Kategori tidak dapat dihapus karena masih memiliki buku" }, { status: 400 });
    }

    await prisma.category.delete({ where: { id: params.id } });

    await prisma.auditLog.create({
      data: {
        action: "DELETE_CATEGORY",
        userId: session.user.id,
        details: `Menghapus kategori: ${target.name}`,
      },
    });

    return NextResponse.json({ message: "Kategori dihapus" });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
