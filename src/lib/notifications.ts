import { prisma } from "@/lib/prisma";
import { EBOOK_CONFIG } from "@/lib/config/ebook";
import type { ReturnTimeliness } from "@/lib/config/library";
import {
  deliverWhatsAppNotification,
  type WhatsAppCategory,
} from "@/lib/whatsapp";

export type NotificationType = "INFO" | "SUCCESS" | "WARNING" | "ERROR";

/**
 * Opsi penerusan ke WhatsApp. `eventKey` deterministik per peristiwa agar
 * WhatsApp tidak pernah mengirim pesan ganda. Notifikasi in-app tetap identik
 * dan WhatsApp hanya saluran tambahan; pengguna tanpa nomor terverifikasi
 * otomatis dilewati di src/lib/whatsapp.ts.
 *
 * `title`/`message` opsional untuk kasus yang memang butuh format khusus di
 * WhatsApp (mis. pengembalian buku rusak). Bila tidak diisi, WhatsApp memakai
 * teks in-app yang sama seperti sebelumnya.
 */
export interface WhatsAppForward {
  eventKey: string;
  category?: WhatsAppCategory;
  title?: string;
  message?: string;
}

/**
 * Core function to send an in-app notification to a specific user.
 *
 * Bila `whatsapp` diberikan, teks (judul + isi) yang SAMA juga dikirim ke
 * WhatsApp. Ini murni aditif: kegagalan WhatsApp tidak pernah mengganggu
 * notifikasi in-app maupun transaksi pemanggil.
 */
export async function sendInAppNotification(
  userId: string,
  title: string,
  message: string,
  type: NotificationType = "INFO",
  link?: string,
  whatsapp?: WhatsAppForward
) {
  try {
    await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
        link,
      },
    });
  } catch (error) {
    console.error(`Failed to send notification to ${userId}:`, error);
  }

  if (whatsapp) {
    // Pertahanan berlapis: meskipun deliverWhatsAppNotification sudah menelan
    // error, pastikan kegagalan WhatsApp tidak pernah merambat ke pemanggil.
    await deliverWhatsAppNotification({
      userId,
      // Default: teks identik dengan in-app. Override hanya bila pemanggil
      // memang butuh format WhatsApp yang berbeda.
      title: whatsapp.title ?? title,
      message: whatsapp.message ?? message,
      eventKey: whatsapp.eventKey,
      category: whatsapp.category ?? "ACCOUNT",
    }).catch(() => undefined);
  }
}

/**
 * Broadcast a notification to all users with ADMIN or LIBRARIAN roles.
 * Bila `whatsapp` diberikan, notifikasi yang sama juga diteruskan ke WhatsApp
 * masing-masing pustakawan/admin (yang nomornya sudah terverifikasi).
 */
export async function notifyLibrarians(
  title: string,
  message: string,
  type: NotificationType = "INFO",
  link?: string,
  whatsapp?: { eventKeyPrefix: string; category: WhatsAppCategory }
) {
  try {
    const librarians = await prisma.user.findMany({
      where: {
        role: { in: ["ADMIN", "LIBRARIAN"] },
        isActive: true,
      },
      select: { id: true },
    });

    const notifications = librarians.map((user) => ({
      userId: user.id,
      title,
      message,
      type,
      link,
    }));

    if (notifications.length > 0) {
      await prisma.notification.createMany({
        data: notifications,
      });
    }

    if (whatsapp) {
      for (const librarian of librarians) {
        await deliverWhatsAppNotification({
          userId: librarian.id,
          title,
          message,
          eventKey: `${whatsapp.eventKeyPrefix}:${librarian.id}`,
          category: whatsapp.category,
        }).catch(() => undefined);
      }
    }
  } catch (error) {
    console.error("Failed to notify librarians:", error);
  }
}

/**
 * Helper to notify a user about a successful borrow.
 */
export async function notifyBorrowSuccess(
  userId: string,
  bookTitle: string,
  borrowId: string,
  dueDate: Date,
  whatsapp?: WhatsAppForward
) {
  const formattedDate = dueDate.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await sendInAppNotification(
    userId,
    "Peminjaman Berhasil",
    `Buku "${bookTitle}" berhasil dipinjam. Harap kembalikan paling lambat ${formattedDate}.`,
    "SUCCESS",
    `/student/borrows`,
    whatsapp ? { ...whatsapp, category: whatsapp.category ?? "BORROW" } : undefined
  );

  // Notify librarians (in-app + WhatsApp bila nomornya terverifikasi)
  await notifyLibrarians(
    "Aktivitas Peminjaman Baru",
    `Buku "${bookTitle}" dipinjam.`,
    "INFO",
    `/librarian/borrows`,
    { eventKeyPrefix: `librarian:borrow:${borrowId}`, category: "BORROW" }
  );
}

/** Format rupiah ringkas yang konsisten dengan laporan lain di aplikasi. */
function formatIDR(amount: number): string {
  return `Rp${Math.round(amount).toLocaleString("id-ID")}`;
}

/**
 * Rincian denda pengembalian buku yang di-*snapshot* saat pengembalian.
 * Semua nilai berasal dari SATU perhitungan (route pengembalian) dan dipakai
 * apa adanya oleh kedua kanal notifikasi (in-app & WhatsApp) — tidak dihitung
 * ulang agar tidak ada selisih maupun biaya ganda.
 */
export interface ReturnFines {
  /** Jumlah hari keterlambatan sebenarnya (0 bila tepat waktu/lebih awal). */
  daysLate: number;
  /** Denda keterlambatan = daysLate × tarif harian yang berlaku. */
  lateFine: number;
  /** Label kategori kerusakan yang tercatat (mis. "Halaman sobek"), atau null. */
  conditionLabel: string | null;
  /** Biaya kerusakan sesuai tarif kategori yang berlaku (0 bila tidak rusak). */
  damageFine: number;
  /** Total denda = lateFine + damageFine (sudah dijumlahkan sekali). */
  totalFine: number;
  /**
   * Status ketepatan waktu dari TANGGAL (bukan status transaksi). Bila tidak
   * diisi, diturunkan dari `daysLate` agar pemanggil lama tetap kompatibel.
   */
  timeliness?: ReturnTimeliness;
}

const ZERO_FINES: ReturnFines = {
  daysLate: 0,
  lateFine: 0,
  conditionLabel: null,
  damageFine: 0,
  totalFine: 0,
};

/**
 * Status tepat waktu/terlambat yang dipakai builder. Menghormati `timeliness`
 * eksplisit (hasil perbandingan tanggal); hanya bila tidak ada, diturunkan dari
 * `daysLate`.
 */
function resolveTimeliness(fines: ReturnFines): ReturnTimeliness {
  if (fines.timeliness) return fines.timeliness;
  return fines.daysLate > 0 ? "LATE" : "ONTIME";
}

/**
 * Susun judul & isi notifikasi pengembalian buku (kanal in-app) berdasarkan
 * kondisi nyata:
 *  - terlambat + rusak  → hari terlambat, denda, kategori & biaya kerusakan, total;
 *  - rusak (tepat waktu) → kategori & biaya kerusakan saja (tanpa klaim terlambat);
 *  - terlambat saja      → hari terlambat & denda saja (tanpa baris kerusakan);
 *  - normal              → teks pengembalian berhasil yang sudah ada.
 *
 * Fungsi ini MURNI (tanpa I/O). Untuk kondisi rusak, WhatsApp memakai format
 * tersendiri (lihat buildReturnWhatsAppNotification); kanal lain memakai teks ini.
 */
export function buildReturnNotification(
  bookTitle: string,
  fines: ReturnFines
): { title: string; message: string; type: NotificationType } {
  const hasLate = resolveTimeliness(fines) === "LATE";
  const hasDamage = fines.damageFine > 0;

  // D. Tidak terlambat dan tidak rusak → pertahankan alur notifikasi normal.
  if (!hasLate && !hasDamage) {
    return {
      title: "Pengembalian Berhasil",
      message: `Terima kasih telah mengembalikan buku "${bookTitle}".`,
      type: "SUCCESS",
    };
  }

  const lines: string[] = [];
  if (hasLate) {
    lines.push(`Buku terlambat dikembalikan selama ${fines.daysLate} hari.`);
    lines.push(`Denda keterlambatan: ${formatIDR(fines.lateFine)}.`);
  } else {
    // B. Rusak tetapi tepat waktu/lebih awal → JANGAN menyatakan terlambat.
    lines.push("Buku dikembalikan tepat waktu.");
  }

  if (hasDamage) {
    lines.push(`Kategori kerusakan: ${fines.conditionLabel ?? "Kerusakan tercatat"}.`);
    lines.push(`Biaya kerusakan: ${formatIDR(fines.damageFine)}.`);
    // Total hanya bermakna bila ada denda keterlambatan + kerusakan sekaligus.
    if (hasLate) {
      lines.push(`Total biaya: ${formatIDR(fines.totalFine)}.`);
    }
  }

  return {
    title: `Pengembalian Buku — ${bookTitle}`,
    message: lines.join("\n"),
    type: "WARNING",
  };
}

/**
 * Susun pesan WhatsApp KHUSUS untuk pengembalian buku RUSAK (struktur Bagian B).
 * Mengembalikan null bila tidak ada kerusakan — dalam hal itu WhatsApp memakai
 * teks in-app yang sama seperti sebelumnya.
 *
 * Struktur (paragraf dipisah baris kosong, persis urutan Bagian B):
 *   [Buku dikembalikan tepat waktu.|Buku dikembalikan terlambat.]
 *
 *   Peringatan!
 *
 *   Kategori kerusakan: <label>.
 *   Biaya kerusakan: Rp<n>.
 *   [Denda keterlambatan: Rp<n>.]   ← hanya bila terlambat
 *   [Total denda: Rp<n>.]           ← hanya bila terlambat
 *
 *   Dimohon untuk segera membayar denda. Untuk pembayaran diharap hubungi pustakawan terlebih dahulu.
 *
 * Biaya kerusakan dan denda keterlambatan SELALU baris terpisah (tidak dicampur).
 * Bila status tidak bisa ditentukan dari tanggal (UNKNOWN), baris status
 * dihilangkan agar tidak menebak.
 */
export function buildReturnWhatsAppNotification(
  bookTitle: string,
  fines: ReturnFines
): { title: string; message: string } | null {
  // Hanya kondisi rusak yang punya format WhatsApp tersendiri.
  if (fines.damageFine <= 0) return null;

  const timeliness = resolveTimeliness(fines);
  const blocks: string[] = [];

  if (timeliness === "LATE") blocks.push("Buku dikembalikan terlambat.");
  else if (timeliness === "ONTIME") blocks.push("Buku dikembalikan tepat waktu.");
  // UNKNOWN → baris status dihilangkan (jangan menebak).

  blocks.push("Peringatan!");

  const detail: string[] = [
    `Kategori kerusakan: ${fines.conditionLabel ?? "Kerusakan tercatat"}.`,
    `Biaya kerusakan: ${formatIDR(fines.damageFine)}.`,
  ];
  if (timeliness === "LATE") {
    detail.push(`Denda keterlambatan: ${formatIDR(fines.lateFine)}.`);
    detail.push(`Total denda: ${formatIDR(fines.totalFine)}.`);
  }
  blocks.push(detail.join("\n"));

  blocks.push(
    "Dimohon untuk segera membayar denda. Untuk pembayaran diharap hubungi pustakawan terlebih dahulu."
  );

  return {
    title: `Pengembalian Buku — ${bookTitle}`,
    message: blocks.join("\n\n"),
  };
}

/**
 * Helper to notify a user about a successful return.
 *
 * `fines` membawa hasil perhitungan denda dari route pengembalian. Bila tidak
 * diberikan, dipakai kasus normal (tanpa denda). Satu notifikasi per
 * pengembalian (in-app + WhatsApp) untuk menghindari pesan ganda. Untuk buku
 * rusak, hanya kanal WhatsApp yang memakai format Bagian B; notifikasi in-app
 * tetap memakai teks lama.
 */
export async function notifyReturnSuccess(
  userId: string,
  bookTitle: string,
  borrowId: string,
  fines: ReturnFines = ZERO_FINES,
  whatsapp?: WhatsAppForward
) {
  const { title, message, type } = buildReturnNotification(bookTitle, fines);

  const whatsappOverride = buildReturnWhatsAppNotification(bookTitle, fines);
  const forward: WhatsAppForward | undefined = whatsapp
    ? {
        eventKey: whatsapp.eventKey,
        category: whatsapp.category ?? "RETURN",
        ...(whatsappOverride ?? {}),
      }
    : undefined;

  await sendInAppNotification(userId, title, message, type, `/student/borrows`, forward);
}

/** Judul tetap notifikasi pembayaran denda. */
export const FINE_PAYMENT_TITLE = "Pembayaran Denda Dicatat";

/**
 * Susun notifikasi pembayaran denda (in-app & WhatsApp memakai teks sama).
 *
 * `outstanding` adalah SISA denda SETELAH pembayaran berdasarkan perhitungan
 * resmi (bukan nominal pembayaran). Penanda `LUNAS` hanya ditambahkan bila sisa
 * denda benar-benar nol — pembayaran sebagian tidak pernah ditandai lunas.
 */
export function buildFinePaymentNotification(
  bookTitle: string,
  paidAmount: number,
  outstanding: number
): { title: string; message: string; type: NotificationType } {
  const base =
    `Pembayaran denda ${formatIDR(paidAmount)} untuk "${bookTitle}" telah dicatat. ` +
    `Sisa: ${formatIDR(outstanding)}.`;
  const settled = outstanding === 0;

  return {
    title: FINE_PAYMENT_TITLE,
    message: settled ? `${base}\n\nLUNAS` : base,
    type: "SUCCESS",
  };
}

/** Judul tetap notifikasi penolakan pengajuan peminjaman. */
export const BORROW_REJECTED_TITLE = "Pengajuan Peminjaman Ditolak";

/** Isi tetap notifikasi penolakan pengajuan peminjaman (judul buku apa adanya). */
export function buildBorrowRejectedMessage(bookTitle: string): string {
  return `Pengajuan peminjaman "${bookTitle}" tidak disetujui. Silakan hubungi pustakawan.`;
}

/**
 * Beri tahu peminjam bahwa pengajuan peminjamannya ditolak. Judul & isi yang
 * sama persis dipakai notifikasi in-app dan WhatsApp.
 */
export async function notifyBorrowRejected(
  userId: string,
  bookTitle: string,
  borrowId: string,
  whatsapp?: WhatsAppForward
) {
  await sendInAppNotification(
    userId,
    BORROW_REJECTED_TITLE,
    buildBorrowRejectedMessage(bookTitle),
    "WARNING",
    `/student/borrows`,
    whatsapp ? { ...whatsapp, category: whatsapp.category ?? "BORROW" } : undefined
  );
}

/**
 * Helper to notify a user about a successful ebook loan.
 */
export async function notifyEbookBorrowed(
  userId: string,
  bookTitle: string,
  expiresAt: Date,
  whatsapp?: WhatsAppForward
) {
  const formatted = expiresAt.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await sendInAppNotification(
    userId,
    "Ebook Berhasil Dipinjam",
    `Ebook "${bookTitle}" siap dibaca. Masa akses berakhir pada ${formatted}.`,
    "SUCCESS",
    "/ebooks/saya",
    whatsapp ? { ...whatsapp, category: whatsapp.category ?? "EBOOK" } : undefined
  );
}

/**
 * Helper to notify a user that an ebook loan reached its deadline.
 */
export async function notifyEbookExpired(
  userId: string,
  bookTitle: string,
  expiresAt?: Date,
  whatsapp?: WhatsAppForward
) {
  const formatted = expiresAt
    ? expiresAt.toLocaleString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const message = formatted
    ? `Akses e-book "${bookTitle}" telah kedaluwarsa pada ${formatted}.\n\nSilakan periksa sistem DigiLib untuk informasi peminjaman berikutnya.`
    : `Akses baca ebook "${bookTitle}" telah kedaluwarsa. Kembalikan agar dapat meminjam kembali.`;

  await sendInAppNotification(
    userId,
    "Masa Akses E-Book Habis",
    message,
    "WARNING",
    "/ebooks/saya",
    whatsapp ? { ...whatsapp, category: whatsapp.category ?? "EBOOK" } : undefined
  );
}

/**
 * Helper to notify a user about a successful ebook return.
 */
export async function notifyEbookReturned(
  userId: string,
  bookTitle: string,
  whatsapp?: WhatsAppForward
) {
  await sendInAppNotification(
    userId,
    "Ebook Dikembalikan",
    `Terima kasih telah mengembalikan ebook "${bookTitle}".`,
    "SUCCESS",
    "/ebooks/saya",
    whatsapp ? { ...whatsapp, category: whatsapp.category ?? "EBOOK" } : undefined
  );
}

/**
 * Checks for upcoming-due books and sends notifications.
 * Designed to be called by a cron job or a lazy trigger.
 */
export async function processUpcomingDueNotifications(daysAhead: number = 2) {
  const now = new Date();
  const upper = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  try {
    const upcomingBorrows = await prisma.borrowRecord.findMany({
      where: {
        status: "BORROWED",
        dueDate: { gte: now, lte: upper },
      },
      include: { book: true, user: true },
    });

    if (upcomingBorrows.length === 0) return 0;

    let count = 0;
    for (const borrow of upcomingBorrows) {
      await sendInAppNotification(
        borrow.userId,
        "Batas Pengembalian Mendekati",
        `Buku "${borrow.book.title}" akan jatuh tempo pada ${borrow.dueDate.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}. Harap persiapkan pengembalian.`,
        "WARNING",
        `/student/borrows`,
        { eventKey: `borrow:upcoming:${borrow.id}`, category: "DUE_REMINDER" }
      );
      count++;
    }
    return count;
  } catch (error) {
    console.error("Failed to process upcoming due notifications:", error);
    return 0;
  }
}

/**
 * Checks for overdue books, updates their status to OVERDUE,
 * and sends notifications to both users and librarians.
 * Designed to be called by a cron job or a lazy trigger.
 */
export async function processOverdueNotifications() {
  const now = new Date();

  try {
    // Find borrows that are BORROWED (not yet marked OVERDUE) and past due date
    const overdueBorrows = await prisma.borrowRecord.findMany({
      where: {
        status: "BORROWED",
        dueDate: { lt: now },
      },
      include: { book: true, user: true },
    });

    if (overdueBorrows.length === 0) return 0;

    let count = 0;
    for (const borrow of overdueBorrows) {
      // 1. Update status to OVERDUE
      await prisma.borrowRecord.update({
        where: { id: borrow.id },
        data: { status: "OVERDUE" },
      });

      // 2. Notify the user
      await sendInAppNotification(
        borrow.userId,
        "Peringatan Buku Terlambat",
        `Buku "${borrow.book.title}" sudah melewati batas waktu pengembalian. Harap segera kembalikan ke perpustakaan.`,
        "ERROR",
        `/student/borrows`,
        { eventKey: `borrow:overdue:${borrow.id}`, category: "OVERDUE" }
      );

      // 3. Notify Librarians
      await notifyLibrarians(
        "Buku Terlambat (Overdue)",
        `Pengguna ${borrow.user.name} terlambat mengembalikan buku "${borrow.book.title}".`,
        "WARNING",
        `/librarian/borrows`,
        { eventKeyPrefix: `librarian:overdue:${borrow.id}`, category: "OVERDUE" }
      );

      count++;
    }

    return count;
  } catch (error) {
    console.error("Failed to process overdue notifications:", error);
    return 0;
  }
}

/**
 * Memproses e-book yang masa aksesnya telah berakhir.
 *
 * Pemicu lazy untuk notifyEbookExpired (sebelumnya teks ini ada tetapi tidak
 * pernah dipanggil). Hanya memproses loan yang:
 *   - belum dikembalikan (returnedAt null),
 *   - masih berstatus ACTIVE, dan
 *   - expiresAt <= sekarang (benar-benar kedaluwarsa).
 *
 * Transisi status dilakukan atomik (updateMany dengan guard), sehingga bila dua
 * proses berjalan bersamaan hanya satu yang menandai EXPIRED dan mengirim
 * notifikasi. Setelah itu status bukan ACTIVE lagi sehingga tidak berulang.
 */
export async function processEbookExpiryNotifications() {
  const now = new Date();

  try {
    const expiredLoans = await prisma.ebookLoan.findMany({
      where: {
        returnedAt: null,
        status: EBOOK_CONFIG.loanStatuses.ACTIVE,
        expiresAt: { lte: now },
      },
      include: { book: { select: { title: true } } },
    });

    if (expiredLoans.length === 0) return 0;

    let count = 0;
    for (const loan of expiredLoans) {
      // Guard atomik: hanya prosesor yang benar-benar mengubah status yang
      // mengirim notifikasi (mencegah pesan ganda saat concurrent).
      const flipped = await prisma.ebookLoan.updateMany({
        where: {
          id: loan.id,
          returnedAt: null,
          status: EBOOK_CONFIG.loanStatuses.ACTIVE,
        },
        data: { status: EBOOK_CONFIG.loanStatuses.EXPIRED },
      });

      if (flipped.count === 0) continue;

      await notifyEbookExpired(loan.userId, loan.book.title, loan.expiresAt, {
        eventKey: `ebook:expire:${loan.id}`,
        category: "EBOOK",
      });
      count++;
    }

    return count;
  } catch (error) {
    console.error("Failed to process ebook expiry notifications:", error);
    return 0;
  }
}

/**
 * Kirim pengingat 1-2 hari sebelum masa akses e-book berakhir.
 * Satu pengingat per loan (anti-duplikat via eventKey + cek WhatsAppDelivery).
 * Tidak mengirim untuk loan RETURNED/EXPIRED atau yang waktunya sudah lewat.
 */
export async function processEbookExpiryReminders() {
  const now = new Date();
  const lower = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const upper = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  try {
    const loans = await prisma.ebookLoan.findMany({
      where: {
        returnedAt: null,
        status: EBOOK_CONFIG.loanStatuses.ACTIVE,
        expiresAt: { gt: lower, lte: upper },
      },
      include: { book: { select: { title: true } } },
    });

    if (loans.length === 0) return 0;

    let count = 0;
    for (const loan of loans) {
      const eventKey = `ebook:expiry-reminder:${loan.id}`;

      const already = await prisma.whatsAppDelivery.findUnique({
        where: { eventKey },
        select: { id: true },
      });
      if (already) continue;

      const formatted = loan.expiresAt.toLocaleString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      await sendInAppNotification(
        loan.userId,
        "Pengingat Masa Akses E-Book",
        `Akses e-book "${loan.book.title}" akan berakhir pada ${formatted}.\n\nSilakan selesaikan aktivitas membaca sebelum masa akses berakhir.`,
        "WARNING",
        "/ebooks/saya",
        { eventKey, category: "EBOOK" }
      );
      count++;
    }

    return count;
  } catch (error) {
    console.error("Failed to process ebook expiry reminders:", error);
    return 0;
  }
}

/**
 * Umumkan penambahan koleksi buku baru kepada seluruh pengguna aktif.
 * Notifikasi in-app selalu dibuat; WhatsApp hanya untuk nomor terverifikasi.
 */
export async function notifyNewBook(book: {
  id: string;
  title: string;
  author: string;
}): Promise<number> {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    if (users.length === 0) return 0;

    const title = "Koleksi Buku Baru";
    const message = `Buku baru telah ditambahkan ke katalog: "${book.title}" oleh ${book.author}. Cek katalog untuk melihat ketersediaan.`;

    await prisma.notification.createMany({
      data: users.map((user) => ({
        userId: user.id,
        title,
        message,
        type: "INFO",
        link: "/catalog",
      })),
    });

    for (const user of users) {
      await deliverWhatsAppNotification({
        userId: user.id,
        title,
        message,
        eventKey: `book:new:${book.id}:${user.id}`,
        category: "BOOK",
      }).catch(() => undefined);
    }

    return users.length;
  } catch (error) {
    console.error("Failed to notify new book:", error);
    return 0;
  }
}
