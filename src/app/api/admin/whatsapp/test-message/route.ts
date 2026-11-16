import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getWhatsAppConfig,
  normalizeWhatsAppNumber,
  sendWhatsAppSystemMessage,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/whatsapp/test-message
 *
 * Mengirim pesan percobaan dari nomor Admin. Default tujuan adalah nomor Admin
 * sendiri; Admin boleh mengisi nomor lain untuk verifikasi manual. Hasil
 * dicatat di riwayat pengiriman (kategori TEST).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { target?: unknown; message?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const config = await getWhatsAppConfig();
  if (!config.token || !config.adminNumber) {
    return NextResponse.json(
      {
        error:
          "Konfigurasi belum lengkap: token Fonnte dan nomor WhatsApp Admin wajib diisi.",
      },
      { status: 400 }
    );
  }

  const target =
    typeof body.target === "string" && body.target.trim()
      ? normalizeWhatsAppNumber(body.target)
      : config.adminNumber;
  if (!target) {
    return NextResponse.json({ error: "Nomor tujuan tidak valid." }, { status: 400 });
  }

  const customMessage =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim().slice(0, 1000)
      : null;

  const message =
    customMessage ??
    [
      "*DigiLib SMA — Pesan Percobaan*",
      "",
      "Ini adalah pesan percobaan dari sistem notifikasi WhatsApp DigiLib.",
      "Jika Anda menerima pesan ini, konfigurasi Fonnte berhasil.",
      "",
      `Waktu: ${new Date().toLocaleString("id-ID")}`,
    ].join("\n");

  const result = await sendWhatsAppSystemMessage({
    target,
    title: "Pesan Percobaan WhatsApp",
    message,
    category: "TEST",
    eventKey: `whatsapp:test:${randomUUID()}`,
    userId: session.user.id,
  });

  await prisma.auditLog
    .create({
      data: {
        action: "TEST_WHATSAPP_MESSAGE",
        userId: session.user.id,
        details: `Mengirim pesan percobaan WhatsApp ke ${target.slice(0, 4)}••••${target.slice(-3)}.`,
      },
    })
    .catch(() => undefined);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.error ?? "Pesan percobaan gagal dikirim." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Pesan percobaan berhasil dikirim ke Fonnte.",
  });
}
