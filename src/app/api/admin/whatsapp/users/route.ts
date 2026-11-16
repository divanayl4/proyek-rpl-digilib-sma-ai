import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maskPhoneNumber } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const ROLES = ["ADMIN", "LIBRARIAN", "STUDENT", "TEACHER", "STAFF"];

/**
 * GET /api/admin/whatsapp/users
 * Daftar pengguna + status nomor WhatsApp (tersamarkan) untuk Administrator.
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
  const role = searchParams.get("role") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10) || 20)
  );

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { email: { contains: search } },
      { identityNumber: { contains: search } },
    ];
  }
  if (ROLES.includes(role)) where.role = role;

  const [users, total, verifiedCount, unverifiedCount] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        whatsappNumber: true,
        whatsappVerified: true,
        whatsappVerifiedAt: true,
        whatsappNotificationsEnabled: true,
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { whatsappVerified: true } }),
    prisma.user.count({
      where: { whatsappNumber: null },
    }),
  ]);

  return NextResponse.json({
    users: users.map((user) => ({
      ...user,
      whatsappNumber: undefined,
      whatsappNumberMasked: maskPhoneNumber(user.whatsappNumber),
      hasWhatsappNumber: Boolean(user.whatsappNumber),
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      verified: verifiedCount,
      withoutNumber: unverifiedCount,
    },
  });
}
