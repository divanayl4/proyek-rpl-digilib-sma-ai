import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LIBRARY_CONFIG } from "@/lib/config/library";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;

/**
 * GET /api/librarian/borrowers — pencarian anggota yang dapat dipinjamkan buku.
 *
 * Dipakai oleh modal "Buat Peminjaman" di meja sirkulasi (Pustakawan/Admin).
 * Endpoint ini sengaja TERPISAH dari administrasi pengguna: hanya mengembalikan
 * role peminjam yang sah, tanpa password/hash, dan tidak dapat dipakai untuk
 * melihat seluruh akun (termasuk Admin/Pustakawan).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!LIBRARY_CONFIG.librarianRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = (searchParams.get("search") || "").trim();
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );

  const where: Record<string, unknown> = {
    role: { in: [...LIBRARY_CONFIG.borrowerRoles] },
  };
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { email: { contains: search } },
      { identityNumber: { contains: search } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      class: true,
      identityNumber: true,
      isActive: true,
      // passwordHash TIDAK pernah dipilih/dikembalikan.
    },
    orderBy: { name: "asc" },
    take: pageSize,
  });

  return NextResponse.json({ users });
}
