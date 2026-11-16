/**
 * Telegram Bot API – modul pengiriman terpusat (server-only).
 *
 * Prinsip desain:
 * - Telegram HANYA saluran tambahan. Semua kegagalan ditelan di sini sehingga
 *   tidak pernah menggagalkan transaksi DigiLib.
 * - Hanya role peminjam (TEACHER/Guru, STUDENT/Siswa, STAFF/Staf Sekolah) yang
 *   dapat menerima pesan. ADMIN dan LIBRARIAN tidak pernah menerima Telegram.
 * - Bot token dibaca murni dari environment dan tidak pernah di-log atau
 *   dikirim ke klien. chatId privat tidak pernah di-log.
 * - Anti-duplikat memakai tabel TelegramDelivery(eventKey unik): klaim dulu,
 *   lalu kirim; klaim dilepas kembali bila pengiriman gagal.
 */

import { prisma } from "@/lib/prisma";

export const TELEGRAM_RECIPIENT_ROLES = ["TEACHER", "STUDENT", "STAFF"] as const;

/** Hanya peminjam (Guru, Siswa, Staf Sekolah) yang boleh menerima Telegram. */
export function isTelegramRecipientRole(role: string | null | undefined): boolean {
  return role != null && (TELEGRAM_RECIPIENT_ROLES as readonly string[]).includes(role);
}

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token && token.trim() ? token.trim() : null;
}

/** Username bot publik (untuk membangun deep-link pengaitan), tanpa "@". */
export function getTelegramBotUsername(): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username || !username.trim()) return null;
  return username.trim().replace(/^@/, "");
}

/**
 * Fitur aktif bila token tersedia dan TIDAK dimatikan lewat TELEGRAM_ENABLED.
 * Dapat dinonaktifkan tanpa memengaruhi notifikasi in-app.
 */
export function isTelegramEnabled(): boolean {
  if (!getTelegramBotToken()) return false;
  return process.env.TELEGRAM_ENABLED !== "false";
}

const TELEGRAM_API_TIMEOUT_MS = 8000;

/**
 * Panggilan mentah ke Bot API. Mengembalikan true hanya bila HTTP 2xx.
 * Tidak pernah melempar. Tidak pernah mencatat token/chatId.
 */
async function callTelegramApi(
  method: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const token = getTelegramBotToken();
  if (!token) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kirim pesan ke satu chatId tertentu. Dipakai HANYA oleh alur pengaitan
 * (membalas pengguna yang menghubungi bot). Tidak melakukan dedupe/role.
 */
export async function sendTelegramChatMessage(
  chatId: string | number,
  text: string
): Promise<boolean> {
  if (!isTelegramEnabled()) return false;
  return callTelegramApi("sendMessage", {
    chat_id: String(chatId),
    text,
    disable_web_page_preview: true,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

export interface TelegramDeliveryInput {
  userId: string;
  title: string;
  /** Isi pesan, PERSIS sama dengan notifikasi in-app. */
  message: string;
  /** Kunci peristiwa unik, mis. "borrow:approve:<borrowId>". */
  eventKey: string;
}

export type TelegramDeliveryReason =
  | "DISABLED"
  | "NOT_RECIPIENT"
  | "DUPLICATE"
  | "FAILED";

export interface TelegramDeliveryResult {
  sent: boolean;
  reason?: TelegramDeliveryReason;
}

/**
 * Kirim notifikasi Telegram ke pemilik `userId` dengan teks identik dengan
 * notifikasi in-app. Tidak pernah melempar.
 *
 * Alur anti-duplikat:
 *  1. Klaim baris TelegramDelivery(eventKey unik). Bila sudah ada (P2002) →
 *     peristiwa ini sudah/pernah dikirim → berhenti (mencegah pesan ganda,
 *     termasuk saat dua permintaan berjalan bersamaan).
 *  2. Kirim ke Bot API.
 *  3. Bila gagal → hapus klaim agar tidak ditandai "terkirim" dan bisa diulang.
 */
export async function deliverTelegramNotification(
  input: TelegramDeliveryInput
): Promise<TelegramDeliveryResult> {
  const { userId, title, message, eventKey } = input;

  try {
    if (!isTelegramEnabled()) return { sent: false, reason: "DISABLED" };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, telegramChatId: true, isActive: true },
    });

    if (!user || !user.isActive) return { sent: false, reason: "NOT_RECIPIENT" };
    if (!isTelegramRecipientRole(user.role)) {
      return { sent: false, reason: "NOT_RECIPIENT" };
    }
    if (!user.telegramChatId) return { sent: false, reason: "NOT_RECIPIENT" };

    try {
      await prisma.telegramDelivery.create({ data: { eventKey, userId } });
    } catch (error) {
      if (isUniqueViolation(error)) return { sent: false, reason: "DUPLICATE" };
      return { sent: false, reason: "FAILED" };
    }

    const text = `${title}\n\n${message}`;
    const ok = await callTelegramApi("sendMessage", {
      chat_id: user.telegramChatId,
      text,
      disable_web_page_preview: true,
    });

    if (!ok) {
      await prisma.telegramDelivery
        .deleteMany({ where: { eventKey } })
        .catch(() => undefined);
      return { sent: false, reason: "FAILED" };
    }

    return { sent: true };
  } catch {
    return { sent: false, reason: "FAILED" };
  }
}
