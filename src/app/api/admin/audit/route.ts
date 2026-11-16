import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;

/**
 * GET /api/admin/audit
 *
 * Menampilkan audit log aktivitas sistem. Hanya ADMIN yang boleh mengakses.
 * Log ini mencatat tindakan administratif (pengguna, koleksi, transaksi, profil)
 * beserta pelakunya untuk keperluan penelusuran.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = (searchParams.get("search") || "").trim();
  const action = (searchParams.get("action") || "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );

  const where: Record<string, unknown> = {};

  if (action) {
    where.action = action;
  }

  if (search) {
    where.OR = [
      { action: { contains: search } },
      { details: { contains: search } },
      { user: { name: { contains: search } } },
      { user: { email: { contains: search } } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Daftar jenis aksi yang benar-benar ada, untuk dropdown filter di UI.
  const actionGroups = await prisma.auditLog.groupBy({
    by: ["action"],
    _count: { _all: true },
    orderBy: { action: "asc" },
  });

  return NextResponse.json({
    logs,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    actions: actionGroups.map((g) => ({ action: g.action, count: g._count._all })),
  });
}
