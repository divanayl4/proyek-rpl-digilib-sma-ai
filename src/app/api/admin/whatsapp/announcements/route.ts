import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  broadcastWhatsAppNotification,
  isWhatsAppCategory,
  type WhatsAppAudience,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const ROLES = ["ADMIN", "LIBRARIAN", "STUDENT", "TEACHER", "STAFF"];
const BROADCAST_CATEGORIES = ["ANNOUNCEMENT", "MAINTENANCE", "OUTAGE"] as const;

/**
 * POST /api/admin/whatsapp/announcements
 *
 * Body: { title, message, audience: "ALL"|"ROLE"|"USER", role?, userId?,
 *         category?: "ANNOUNCEMENT"|"MAINTENANCE"|"OUTAGE" }
 *
 * Selalu membuat notifikasi in-app; WhatsApp dikirim hanya ke pengguna dengan
 * nomor terverifikasi dan notifikasi aktif. Khusus Administrator.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    title?: unknown;
    message?: unknown;
    audience?: unknown;
    role?: unknown;
    userId?: unknown;
    category?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  if (typeof body.title !== "string" || body.title.trim().length < 3) {
    return NextResponse.json({ error: "Judul minimal 3 karakter" }, { status: 400 });
  }
  if (body.title.trim().length > 120) {
    return NextResponse.json({ error: "Judul maksimal 120 karakter" }, { status: 400 });
  }
  if (typeof body.message !== "string" || body.message.trim().length < 3) {
    return NextResponse.json({ error: "Isi pesan minimal 3 karakter" }, { status: 400 });
  }
  if (body.message.trim().length > 2000) {
    return NextResponse.json({ error: "Isi pesan maksimal 2000 karakter" }, { status: 400 });
  }

  const audience = body.audience;
  if (audience !== "ALL" && audience !== "ROLE" && audience !== "USER") {
    return NextResponse.json(
      { error: "Audience harus ALL, ROLE, atau USER" },
      { status: 400 }
    );
  }

  let role: string | null = null;
  if (audience === "ROLE") {
    if (typeof body.role !== "string" || !ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Role tujuan tidak valid" }, { status: 400 });
    }
    role = body.role;
  }

  let userId: string | null = null;
  if (audience === "USER") {
    if (typeof body.userId !== "string" || !body.userId.trim()) {
      return NextResponse.json({ error: "Pengguna tujuan wajib dipilih" }, { status: 400 });
    }
    const target = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Pengguna tujuan tidak ditemukan" }, { status: 404 });
    }
    userId = target.id;
  }

  const category =
    isWhatsAppCategory(body.category) &&
    (BROADCAST_CATEGORIES as readonly string[]).includes(body.category)
      ? body.category
      : "ANNOUNCEMENT";

  try {
    const summary = await broadcastWhatsAppNotification({
      title: body.title.trim(),
      message: body.message.trim(),
      audience: audience as WhatsAppAudience,
      role,
      userId,
      category,
      link: "/notifications",
    });

    await prisma.auditLog
      .create({
        data: {
          action: "SEND_WHATSAPP_ANNOUNCEMENT",
          userId: session.user.id,
          details:
            `Mengirim ${category} ke ${audience}` +
            (role ? ` (${role})` : "") +
            (userId ? ` (user ${userId})` : "") +
            `: ${summary.targetedUsers} pengguna, WhatsApp terkirim ${summary.whatsappSent}, ` +
            `dilewati ${summary.whatsappSkipped}, gagal ${summary.whatsappFailed}.`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gagal mengirim pengumuman";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
