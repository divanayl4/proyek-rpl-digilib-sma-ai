/**
 * Konstanta kategori notifikasi WhatsApp yang aman dipakai di server maupun
 * komponen klien (tanpa dependensi Node/Prisma).
 */

export const WHATSAPP_CATEGORIES = [
  "ACCOUNT",
  "BORROW",
  "RETURN",
  "DUE_REMINDER",
  "OVERDUE",
  "FINE",
  "FINE_PAYMENT",
  "EBOOK",
  "BOOK",
  "ANNOUNCEMENT",
  "MAINTENANCE",
  "OUTAGE",
  "TEST",
] as const;

export type WhatsAppCategory = (typeof WHATSAPP_CATEGORIES)[number];

export const WHATSAPP_CATEGORY_LABELS: Record<WhatsAppCategory, string> = {
  ACCOUNT: "Akun & Registrasi",
  BORROW: "Peminjaman Buku",
  RETURN: "Pengembalian Buku",
  DUE_REMINDER: "Pengingat Jatuh Tempo",
  OVERDUE: "Keterlambatan",
  FINE: "Informasi Denda",
  FINE_PAYMENT: "Pembayaran Denda",
  EBOOK: "Ebook",
  BOOK: "Koleksi Buku Baru",
  ANNOUNCEMENT: "Pengumuman Admin",
  MAINTENANCE: "Pemeliharaan Sistem",
  OUTAGE: "Gangguan Sistem",
  TEST: "Pesan Percobaan",
};

/** Kategori yang boleh dipilih untuk broadcast dari dashboard. */
export const WHATSAPP_BROADCAST_CATEGORIES = [
  "ANNOUNCEMENT",
  "MAINTENANCE",
  "OUTAGE",
] as const;

export type WhatsAppBroadcastCategory =
  (typeof WHATSAPP_BROADCAST_CATEGORIES)[number];

export function isWhatsAppCategory(value: unknown): value is WhatsAppCategory {
  return (
    typeof value === "string" &&
    (WHATSAPP_CATEGORIES as readonly string[]).includes(value)
  );
}
