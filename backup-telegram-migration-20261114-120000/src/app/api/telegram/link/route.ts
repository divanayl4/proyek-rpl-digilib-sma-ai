import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import {
  getTelegramBotUsername,
  isTelegramEnabled,
  isTelegramRecipientRole,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * POST /api/telegram/link
 *
 * Membuat kode pengaitan sekali-pakai untuk akun yang sedang login. Kode hanya
 * dipakai untuk menautkan akun Telegram ke akun DigiLib milik sendiri; tidak
 * ada tindakan administratif.
 */
export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Notifikasi Telegram hanya untuk peminjam (Siswa, Guru, Staf Sekolah).
  if (!isTelegramRecipientRole(session.user.role)) {
    return NextResponse.json(
      {
        error:
          "Fitur Telegram hanya tersedia bagi peminjam (Siswa, Guru, dan Staf Sekolah).",
      },
      { status: 403 }
    );
  }

  if (!isTelegramEnabled()) {
    return NextResponse.json(
      { error: "Fitur Telegram belum dikonfigurasi oleh admin." },
      { status: 503 }
    );
  }

  const code = crypto.randomBytes(4).toString("hex");
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);

  // Identitas selalu dari sesi – pengguna hanya dapat menautkan akunnya sendiri.
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      telegramLinkCode: code,
      telegramLinkCodeExpiresAt: expiresAt,
    },
  });

  const botUsername = getTelegramBotUsername();

  return NextResponse.json({
    code,
    expiresAt,
    botUsername,
    deepLink: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
  });
}

/**
 * DELETE /api/telegram/link
 *
 * Memutuskan koneksi Telegram milik akun yang sedang login. Pemilik selalu
 * diambil dari sesi server; tidak ada userId/chatId yang dibaca dari request
 * sehingga pengguna tidak dapat memutuskan koneksi akun lain. Hanya kolom
 * koneksi Telegram yang dikosongkan — akun, riwayat, dan data lain tidak
 * tersentuh. Konfigurasi bot/webhook global juga tidak diubah.
 */
export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { telegramChatId: true, telegramLinkCode: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });
  }

  // Belum pernah terhubung / sudah terputus: tidak ada yang perlu diubah.
  if (!user.telegramChatId && !user.telegramLinkCode) {
    return NextResponse.json({
      telegramLinked: false,
      message: "Akun Telegram Anda belum terhubung.",
    });
  }

  await prisma.user.update({
    // Kepemilikan akun hanya dari sesi, bukan dari parameter request.
    where: { id: session.user.id },
    data: {
      telegramChatId: null,
      telegramLinkCode: null,
      telegramLinkCodeExpiresAt: null,
      telegramLinkedAt: null,
    },
  });

  return NextResponse.json({
    telegramLinked: false,
    message: "Koneksi Telegram berhasil diputuskan.",
  });
}
