import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { isTelegramEnabled, sendTelegramChatMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Balasan tetap untuk perintah /start tanpa kode pengaitan. */
const START_WELCOME_MESSAGE =
  "Hai, selamat datang di DigiLib SMA Bot. Selamat membaca, enjoy your books! 🫵🤓";

const LINK_SUCCESS_MESSAGE =
  "Akun DigiLib Anda berhasil dihubungkan dengan Telegram.";
const LINK_INVALID_MESSAGE =
  "Kode pengaitan tidak valid atau sudah kedaluwarsa.";
const LINK_FAILED_MESSAGE =
  "Penghubungan akun gagal. Silakan coba lagi.";

/**
 * Kode dibuat server dengan crypto.randomBytes(4).toString("hex"), yaitu tepat
 * 8 karakter heksadesimal. Pesan biasa hanya dianggap kode bila bentuknya
 * persis seperti ini, sehingga obrolan umum tidak diperlakukan sebagai kode.
 */
const LINK_CODE_PATTERN = /^[0-9a-f]{8}$/i;

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
}

type LinkResult = "LINKED" | "INVALID" | "FAILED";

/**
 * Klaim kode sekali-pakai secara atomik. Kepemilikan akun ditentukan oleh kode
 * yang cocok dan belum kedaluwarsa — bukan dari username atau chatId semata.
 */
async function linkTelegramAccount(
  chatId: number | string,
  rawCode: string
): Promise<LinkResult> {
  const code = rawCode.trim().toLowerCase();
  try {
    const now = new Date();
    const claim = await prisma.user.updateMany({
      where: {
        telegramLinkCode: code,
        telegramLinkCodeExpiresAt: { gt: now },
      },
      data: {
        telegramChatId: String(chatId),
        telegramLinkCode: null,
        telegramLinkCodeExpiresAt: null,
        telegramLinkedAt: now,
      },
    });

    return claim.count > 0 ? "LINKED" : "INVALID";
  } catch {
    return "FAILED";
  }
}

/** Kirim satu balasan yang sesuai dengan hasil klaim kode. */
async function replyLinkResult(
  chatId: number | string,
  result: LinkResult
): Promise<void> {
  const message =
    result === "LINKED"
      ? LINK_SUCCESS_MESSAGE
      : result === "INVALID"
        ? LINK_INVALID_MESSAGE
        : LINK_FAILED_MESSAGE;

  await sendTelegramChatMessage(chatId, message);
}

/**
 * Perbandingan string constant-time. Panjang berbeda langsung false tanpa
 * membocorkan selisih posisi. Tidak pernah mencatat nilainya.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/telegram/webhook
 *
 * Menangani tiga hal saja:
 *  1. "/start" tanpa argumen (termasuk spasi tambahan / @namaBot) → balasan
 *     sambutan tetap, tanpa pengaitan akun.
 *  2. Kode pengaitan yang dikirim sebagai pesan biasa (8 karakter heksadesimal,
 *     mis. "a1eaef40") → pengaitan akun.
 *  3. "/start <kode>" (termasuk payload deep-link Telegram) → pengaitan akun;
 *     kode tidak valid/kedaluwarsa dibalas dengan pesan kesalahan.
 *
 * Pesan biasa yang tidak berbentuk kode diabaikan. Tidak ada fungsi persetujuan
 * peminjaman, pengembalian, pembayaran denda, pencarian buku, atau tindakan
 * administratif apa pun di sini.
 *
 * Selalu membalas HTTP 200 agar Telegram tidak mengulang pengiriman. Request
 * yang tidak lolos verifikasi cukup diabaikan (fail-closed) tanpa diproses.
 */
export async function POST(req: NextRequest) {
  try {
    // TELEGRAM_ENABLED=false mematikan endpoint sepenuhnya.
    if (!isTelegramEnabled()) return NextResponse.json({ ok: true });

    // Wajib: bila bot aktif tetapi secret webhook belum dikonfigurasi, endpoint
    // MENOLAK memproses apa pun (fail-closed).
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || !secret.trim()) return NextResponse.json({ ok: true });

    // Verifikasi header webhook Telegram secara constant-time.
    const provided = req.headers.get("x-telegram-bot-api-secret-token");
    if (!provided || !safeEqual(provided, secret)) {
      return NextResponse.json({ ok: true });
    }

    let update: TelegramUpdate;
    try {
      update = await req.json();
    } catch {
      return NextResponse.json({ ok: true });
    }

    const text =
      typeof update?.message?.text === "string" ? update.message.text.trim() : "";
    const chatId = update?.message?.chat?.id;

    if (!text || chatId === undefined) {
      return NextResponse.json({ ok: true });
    }

    // Pisahkan perintah /start (opsional @namaBot) dari payload secara eksplisit.
    // Payload boleh kosong/berisi spasi saja (tombol Start atau deep-link tanpa
    // kode). Kasus itu HARUS menjadi sambutan biasa dan tidak boleh diteruskan
    // ke alur pengaitan, sehingga tidak pernah muncul "kode tidak valid".
    const startMatch = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text);
    if (startMatch) {
      const payload = (startMatch[1] ?? "").trim();
      if (!payload) {
        // Tombol Mulai/Start: satu balasan sambutan, tanpa menu atau pengaitan
        // akun otomatis.
        await sendTelegramChatMessage(chatId, START_WELCOME_MESSAGE);
        return NextResponse.json({ ok: true });
      }

      // Kompatibilitas format lama: "/start <kode>". Payload non-kosong tetap
      // divalidasi lewat klaim atomik (kode valid, belum kedaluwarsa, sekali pakai).
      await replyLinkResult(
        chatId,
        await linkTelegramAccount(chatId, payload)
      );
      return NextResponse.json({ ok: true });
    }

    // Kode pengaitan dikirim sebagai pesan terpisah. Hanya bentuk kode yang
    // valid yang diproses; pesan biasa lainnya tidak dibalas/ditafsirkan.
    if (LINK_CODE_PATTERN.test(text)) {
      await replyLinkResult(
        chatId,
        await linkTelegramAccount(chatId, text)
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    // Jangan pernah menampilkan detail error ke pemanggil / log publik.
    return NextResponse.json({ ok: true });
  }
}
