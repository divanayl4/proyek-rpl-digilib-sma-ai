import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isWhatsAppCategory } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/whatsapp/deliveries
 * Riwayat pengiriman notifikasi WhatsApp (khusus Administrator).
 * Filter: status, category, search (judul/nomor), page, pageSize.
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
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10) || 20)
  );
  const status = searchParams.get("status") || "";
  const category = searchParams.get("category") || "";
  const search = (searchParams.get("search") || "").trim();

  const where: Record<string, unknown> = {};
  if (["PENDING", "SENT", "FAILED", "SKIPPED"].includes(status)) {
    where.status = status;
  }
  if (isWhatsAppCategory(category)) {
    where.category = category;
  }
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { recipientNumber: { contains: search } },
    ];
  }

  const [deliveries, total, grouped] = await Promise.all([
    prisma.whatsAppDelivery.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.whatsAppDelivery.count({ where }),
    prisma.whatsAppDelivery.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const summary = { PENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 };
  for (const row of grouped) {
    if (row.status in summary) {
      summary[row.status as keyof typeof summary] = row._count._all;
    }
  }

  return NextResponse.json({
    deliveries,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary,
  });
}
