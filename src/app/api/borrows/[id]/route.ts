import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  LIBRARY_CONFIG,
  BORROW_STATUS,
  ACTIVE_BORROW_STATUSES,
  OPEN_BORROW_STATUSES,
  calculateDueDate,
  calculateLateDays,
  calculateFine,
  getReturnTimeliness,
  getDamageCondition,
  isDamageCondition,
  isValidDamageCondition,
} from "@/lib/config/library";
import {
  getFinePerDayIDR,
  getDamageFineIDR,
  getDamageFineConfig,
} from "@/lib/config/settings";
import {
  notifyReturnSuccess,
  notifyBorrowSuccess,
  notifyBorrowRejected,
  sendInAppNotification,
  buildFinePaymentNotification,
} from "@/lib/notifications";

export const dynamic = "force-dynamic";

const FINE_METHODS = ["CASH", "TRANSFER", "LAINNYA"];

/**
 * GET /api/borrows/[id]
 * Detail satu transaksi. Menyertakan status efektif dan rincian denda.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const borrow = await prisma.borrowRecord.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, class: true, identityNumber: true } },
      book: { select: { id: true, title: true, author: true, isbn: true, coverUrl: true, publisher: true } },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      finePaidBy: { select: { id: true, name: true } },
      finePayments: {
        orderBy: { createdAt: "desc" },
        include: { recordedBy: { select: { id: true, name: true } } },
      },
    },
  });

  if (!borrow) {
    return NextResponse.json({ error: "Transaksi tidak ditemukan" }, { status: 404 });
  }

  const isLibrarian = LIBRARY_CONFIG.librarianRoles.includes(session.user.role);
  if (!isLibrarian && borrow.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const effectiveStatus =
    borrow.status === BORROW_STATUS.BORROWED && now > borrow.dueDate
      ? BORROW_STATUS.OVERDUE
      : borrow.status;

  const totalPaid = borrow.finePayments.reduce((sum, p) => sum + p.amount, 0);

  // Denda yang sudah dibekukan (transaksi RETURNED) memakai snapshot.
  // Denda berjalan (belum dikembalikan) dihitung dengan tarif yang berlaku kini
  // dan TIDAK disimpan – hanya untuk ditampilkan.
  let fineInfo: {
    daysLate: number;
    ratePerDay: number;
    amount: number;
    paid: number;
    outstanding: number;
    isFinal: boolean;
    lateAmount: number;
    damageAmount: number;
    paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  };

  const paymentStatusOf = (amount: number, paid: number): "UNPAID" | "PARTIAL" | "PAID" =>
    paid <= 0 ? "UNPAID" : paid < amount ? "PARTIAL" : "PAID";

  if (borrow.status === BORROW_STATUS.RETURNED) {
    const daysLate = calculateLateDays(borrow.dueDate, borrow.returnDate ?? now);
    const amount = borrow.fineAmount;
    fineInfo = {
      daysLate,
      ratePerDay: borrow.fineRate ?? LIBRARY_CONFIG.finePerDayIDR,
      amount,
      paid: totalPaid,
      outstanding: Math.max(0, amount - totalPaid),
      isFinal: true,
      lateAmount: borrow.lateFineAmount,
      damageAmount: borrow.damageFineAmount,
      paymentStatus: paymentStatusOf(amount, totalPaid),
    };
  } else if (effectiveStatus === BORROW_STATUS.OVERDUE) {
    const rate = await getFinePerDayIDR();
    const daysLate = calculateLateDays(borrow.dueDate, now);
    const amount = calculateFine(borrow.dueDate, now, rate);
    fineInfo = {
      daysLate,
      ratePerDay: rate,
      amount,
      paid: 0,
      outstanding: amount,
      isFinal: false,
      lateAmount: amount,
      damageAmount: 0,
      paymentStatus: "UNPAID",
    };
  } else {
    fineInfo = {
      daysLate: 0,
      ratePerDay: await getFinePerDayIDR(),
      amount: 0,
      paid: totalPaid,
      outstanding: Math.max(0, borrow.fineAmount - totalPaid),
      isFinal: false,
      lateAmount: borrow.lateFineAmount,
      damageAmount: borrow.damageFineAmount,
      paymentStatus: paymentStatusOf(borrow.fineAmount, totalPaid),
    };
  }

  // Tarif kondisi buku (dapat diubah Admin) disertakan untuk pustakawan agar
  // dialog pengembalian memakai tarif efektif yang sama dengan server.
  const damageConditions = isLibrarian ? await getDamageFineConfig() : [];

  return NextResponse.json({
    ...borrow,
    effectiveStatus,
    fine: fineInfo.amount,
    fineInfo,
    damageConditions,
  });
}

/**
 * PATCH /api/borrows/[id]
 * Aksi siklus hidup transaksi:
 *   approve | reject  – Pustakawan/Admin menyetujui/menolak pengajuan (REQUESTED)
 *   return            – Pustakawan/Admin mengonfirmasi pengembalian + snapshot denda
 *   cancel            – batalkan (pustakawan, atau pemilik untuk pengajuan sendiri)
 *   pay-fine          – Pustakawan/Admin mencatat pembayaran denda
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isLibrarian = LIBRARY_CONFIG.librarianRoles.includes(session.user.role);

  let body: {
    action?: string;
    notes?: string;
    reason?: string;
    method?: string;
    amount?: number | string;
    condition?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const action = body.action;
  if (!["approve", "reject", "return", "cancel", "pay-fine"].includes(action || "")) {
    return NextResponse.json(
      { error: "action tidak valid. Gunakan approve, reject, return, cancel, atau pay-fine" },
      { status: 400 }
    );
  }

  try {
    if (action === "pay-fine") {
      if (!isLibrarian) {
        return NextResponse.json({ error: "Forbidden – hanya pustakawan yang dapat mencatat pembayaran denda" }, { status: 403 });
      }
      return await recordFinePayment(params.id, session.user.id, body);
    }

    if (action === "approve" || action === "reject") {
      if (!isLibrarian) {
        return NextResponse.json({ error: "Forbidden – hanya pustakawan yang dapat memproses pengajuan" }, { status: 403 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const borrow = await tx.borrowRecord.findUnique({
        where: { id: params.id },
        include: { book: true, user: true },
      });
      if (!borrow) throw new Error("Transaksi tidak ditemukan");

      if (action === "approve") {
        if (borrow.status !== BORROW_STATUS.REQUESTED) {
          throw new Error("Hanya pengajuan berstatus menunggu yang dapat disetujui");
        }
        // Re-check stok sebelum menyerahkan (stok berkurang saat disetujui).
        const activeBooksOnLoan = await tx.borrowRecord.count({
          where: { bookId: borrow.bookId, status: { in: ACTIVE_BORROW_STATUSES } },
        });
        if (borrow.book.stock - activeBooksOnLoan <= 0) {
          throw new Error("Stok buku tidak tersedia untuk disetujui");
        }
        const now = new Date();
        const dueDate = calculateDueDate(borrow.user.role, now);
        const updated = await tx.borrowRecord.update({
          where: { id: params.id },
          data: {
            status: BORROW_STATUS.BORROWED,
            borrowDate: now,
            dueDate,
            approvedAt: now,
            approvedById: session.user.id,
          },
          include: {
            user: { select: { id: true, name: true } },
            book: { select: { id: true, title: true } },
          },
        });
        await tx.auditLog.create({
          data: {
            action: "APPROVE_BORROW",
            userId: session.user.id,
            details: `Persetujuan: ${updated.user.name} – "${updated.book.title}" (ID: ${params.id})`,
          },
        });
        return { kind: "approve" as const, updated };
      }

      if (action === "reject") {
        if (borrow.status !== BORROW_STATUS.REQUESTED) {
          throw new Error("Hanya pengajuan berstatus menunggu yang dapat ditolak");
        }
        const reason = body.reason?.trim() || null;
        const updated = await tx.borrowRecord.update({
          where: { id: params.id },
          data: {
            status: BORROW_STATUS.REJECTED,
            rejectReason: reason,
            notes: reason ? `${borrow.notes ?? ""}\n[Alasan tolak]: ${reason}`.trim() : borrow.notes,
          },
          include: {
            user: { select: { id: true, name: true } },
            book: { select: { id: true, title: true } },
          },
        });
        await tx.auditLog.create({
          data: {
            action: "REJECT_BORROW",
            userId: session.user.id,
            details: `Penolakan: pengajuan ${updated.user.name} – "${updated.book.title}" (ID: ${params.id})${reason ? ` – ${reason}` : ""}`,
          },
        });
        return { kind: "reject" as const, updated };
      }

      if (action === "cancel") {
        // Pemilik boleh membatalkan pengajuannya sendiri; pustakawan boleh membatalkan semua.
        if (!isLibrarian && borrow.userId !== session.user.id) {
          throw new Error("Anda tidak berhak membatalkan transaksi ini");
        }
        if (!isLibrarian && borrow.status !== BORROW_STATUS.REQUESTED) {
          throw new Error("Anda hanya dapat membatalkan pengajuan yang belum diproses");
        }
        if (borrow.status === BORROW_STATUS.RETURNED) {
          throw new Error("Tidak dapat membatalkan transaksi yang sudah dikembalikan");
        }
        if (borrow.status === BORROW_STATUS.CANCELLED) {
          throw new Error("Transaksi sudah dibatalkan");
        }
        const updated = await tx.borrowRecord.update({
          where: { id: params.id },
          data: {
            status: BORROW_STATUS.CANCELLED,
            notes: body.notes ? `${borrow.notes ?? ""}\n[Alasan batal]: ${body.notes}`.trim() : borrow.notes,
          },
          include: {
            user: { select: { id: true, name: true } },
            book: { select: { id: true, title: true } },
          },
        });
        await tx.auditLog.create({
          data: {
            action: "CANCEL_BORROW",
            userId: session.user.id,
            details: `Pembatalan: peminjaman ${updated.user.name} – "${updated.book.title}" (ID: ${params.id})`,
          },
        });
        return { kind: "cancel" as const, updated };
      }

      // action === "return"
      if (!isLibrarian) {
        throw new Error("Forbidden – hanya pustakawan yang dapat memproses pengembalian");
      }
      if (borrow.status === BORROW_STATUS.RETURNED) {
        throw new Error("Buku ini sudah dikembalikan sebelumnya");
      }
      if (borrow.status === BORROW_STATUS.CANCELLED) {
        throw new Error("Transaksi telah dibatalkan");
      }
      if (borrow.status === BORROW_STATUS.REQUESTED) {
        throw new Error("Pengajuan belum disetujui; setujui dulu sebelum pengembalian");
      }

      const now = new Date();
      const rate = await getFinePerDayIDR();
      const daysLate = calculateLateDays(borrow.dueDate, now);
      const lateFine = daysLate * rate;
      // Status tepat waktu/terlambat ditentukan dari TANGGAL (dueDate vs waktu
      // pengembalian aktual `now`), bukan dari status transaksi.
      const timeliness = getReturnTimeliness(borrow.dueDate, now);

      // Kondisi buku wajib salah satu kategori resmi. Default "GOOD" agar
      // pustakawan tidak lupa; kategori tidak dikenal ditolak (tidak ada tarif
      // teks bebas). Denda kerusakan diambil HANYA dari tarif kategori.
      const condition = (body.condition ?? "GOOD").trim().toUpperCase();
      if (!isValidDamageCondition(condition)) {
        throw new Error("Kategori kondisi buku tidak valid");
      }
      const damageRate = isDamageCondition(condition) ? await getDamageFineIDR(condition) : 0;
      const damageFine = damageRate;
      const fineAmount = lateFine + damageFine;

      const conditionLabel = getDamageCondition(condition)?.label ?? condition;

      const updated = await tx.borrowRecord.update({
        where: { id: params.id },
        data: {
          status: BORROW_STATUS.RETURNED,
          returnDate: now,
          // Snapshot denda: denda lama tidak ikut berubah saat tarif diubah.
          fineAmount,
          fineRate: rate,
          lateFineAmount: lateFine,
          damageFineAmount: damageFine,
          damageFineRate: damageFine > 0 ? damageRate : null,
          returnCondition: condition,
          finePaid: fineAmount === 0,
          finePaidAt: fineAmount === 0 ? now : null,
          notes: body.notes
            ? `${borrow.notes ?? ""}\n[Catatan kembali]: ${body.notes}`.trim()
            : borrow.notes,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          book: { select: { id: true, title: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: "RETURN_BOOK",
          userId: session.user.id,
          details:
            `Pengembalian: ${updated.user.name} mengembalikan "${updated.book.title}" (ID: ${params.id}, kondisi: ${conditionLabel})` +
            (fineAmount > 0
              ? ` – denda Rp${fineAmount.toLocaleString("id-ID")}` +
                ` (keterlambatan ${daysLate} hari × Rp${rate.toLocaleString("id-ID")} = Rp${lateFine.toLocaleString("id-ID")}` +
                (damageFine > 0 ? `; kerusakan Rp${damageFine.toLocaleString("id-ID")}` : "") +
                ")"
              : " – tanpa denda"),
        },
      });

      return {
        kind: "return" as const,
        updated,
        fineAmount,
        daysLate,
        lateFine,
        damageFine,
        conditionLabel,
        timeliness,
      };
    });

    // Notifikasi pasca-transaksi (di luar transaksi DB).
    if (result.kind === "approve") {
      await notifyBorrowSuccess(
        result.updated.userId,
        result.updated.book.title,
        result.updated.id,
        (result.updated as { dueDate?: Date }).dueDate ?? new Date(),
        { eventKey: `borrow:approve:${result.updated.id}` }
      ).catch(() => undefined);
    } else if (result.kind === "reject") {
      await notifyBorrowRejected(
        result.updated.userId,
        result.updated.book.title,
        result.updated.id,
        { eventKey: `borrow:reject:${result.updated.id}` }
      ).catch(() => undefined);
    } else if (result.kind === "return") {
      // SATU notifikasi pengembalian untuk kedua kanal (in-app & WhatsApp).
      // Rincian keterlambatan/kerusakan memakai snapshot yang sama dengan yang
      // disimpan di BorrowRecord — tidak dihitung ulang di sini, sehingga isi
      // kedua kanal selalu konsisten dan tidak ada biaya yang terhitung ganda.
      await notifyReturnSuccess(
        result.updated.userId,
        result.updated.book.title,
        result.updated.id,
        {
          daysLate: result.daysLate,
          lateFine: result.lateFine,
          conditionLabel: result.conditionLabel,
          damageFine: result.damageFine,
          totalFine: result.fineAmount,
          timeliness: result.timeliness,
        },
        { eventKey: `borrow:return:${result.updated.id}` }
      ).catch(() => undefined);
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Gagal memproses transaksi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * Mencatat pembayaran denda (mendukung pembayaran bertahap).
 * Total pembayaran tidak boleh melebihi denda yang dibekukan.
 */
async function recordFinePayment(
  borrowId: string,
  actorId: string,
  body: { amount?: number | string; method?: string; notes?: string; note?: string }
) {
  const borrow = await prisma.borrowRecord.findUnique({
    where: { id: borrowId },
    include: { book: { select: { title: true } }, user: { select: { id: true, name: true } }, finePayments: true },
  });
  if (!borrow) return NextResponse.json({ error: "Transaksi tidak ditemukan" }, { status: 404 });
  if (borrow.status !== BORROW_STATUS.RETURNED) {
    return NextResponse.json({ error: "Denda hanya dapat dibayar setelah buku dikembalikan" }, { status: 400 });
  }
  if (borrow.fineAmount <= 0) {
    return NextResponse.json({ error: "Transaksi ini tidak memiliki denda" }, { status: 400 });
  }

  const paid = borrow.finePayments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = borrow.fineAmount - paid;
  if (outstanding <= 0) {
    return NextResponse.json({ error: "Denda sudah lunas" }, { status: 400 });
  }

  const requestedAmount =
    body.amount === undefined || body.amount === ""
      ? null
      : Number.parseInt(String(body.amount), 10);
  if (requestedAmount !== null && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) {
    return NextResponse.json({ error: "Jumlah pembayaran tidak valid" }, { status: 400 });
  }
  // Tolak lebih awal bila jelas melebihi saldo yang terbaca. Pemeriksaan final
  // tetap diulang di dalam transaksi untuk menutup race antar-request.
  if (requestedAmount !== null && requestedAmount > outstanding) {
    return NextResponse.json(
      { error: `Jumlah melebihi sisa denda (Rp${outstanding.toLocaleString("id-ID")})` },
      { status: 400 }
    );
  }

  const method = body.method && FINE_METHODS.includes(body.method) ? body.method : "CASH";

  let result: {
    updated: unknown;
    paid: number;
    fullyPaid: boolean;
    paymentId: string;
    amount: number;
  };
  try {
    result = await prisma.$transaction(async (tx) => {
      // Baca ulang total pembayaran DI DALAM transaksi. Dua request bersamaan
      // tidak boleh sama-sama lolos berdasarkan saldo lama lalu membuat total
      // pembayaran melebihi denda yang dibekukan.
      const paidAggregate = await tx.finePayment.aggregate({
        where: { borrowId },
        _sum: { amount: true },
      });
      const paidNow = paidAggregate._sum.amount ?? 0;
      const outstandingNow = borrow.fineAmount - paidNow;
      if (outstandingNow <= 0) {
        throw new Error("Denda sudah lunas");
      }
      const amount = requestedAmount ?? outstandingNow;
      if (amount > outstandingNow) {
        throw new Error(
          `Jumlah melebihi sisa denda (Rp${outstandingNow.toLocaleString("id-ID")})`
        );
      }

      const newPaid = paidNow + amount;
      const fullyPaid = newPaid >= borrow.fineAmount;
      const payment = await tx.finePayment.create({
        data: {
          borrowId,
          amount,
          method,
          note: (body.notes ?? body.note)?.trim() || null,
          recordedById: actorId,
        },
      });
      const updated = await tx.borrowRecord.update({
        where: { id: borrowId },
        data: {
          finePaid: fullyPaid,
          finePaidAt: fullyPaid ? new Date() : null,
          finePaidById: fullyPaid ? actorId : borrow.finePaidById,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "PAY_FINE",
          userId: actorId,
          details: `Pembayaran denda Rp${amount.toLocaleString("id-ID")} untuk ${borrow.user.name} – "${borrow.book.title}" (ID: ${borrowId})`,
        },
      });
      return { updated, paid: newPaid, fullyPaid, paymentId: payment?.id ?? borrowId, amount };
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Gagal mencatat pembayaran denda";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Notifikasi sukses HANYA setelah transaksi pembayaran benar-benar tersimpan.
  // Sisa denda memakai perhitungan resmi (fineAmount - totalPaid); penanda LUNAS
  // ditambahkan di builder hanya bila sisa tepat nol.
  const outstandingAfterPayment = Math.max(0, borrow.fineAmount - result.paid);
  const paymentNotice = buildFinePaymentNotification(
    borrow.book.title,
    result.amount,
    outstandingAfterPayment
  );
  await sendInAppNotification(
    borrow.userId,
    paymentNotice.title,
    paymentNotice.message,
    paymentNotice.type,
    "/student/borrows",
    { eventKey: `fine:payment:${result.paymentId}`, category: "FINE_PAYMENT" }
  );

  return NextResponse.json({
    message: "Pembayaran denda dicatat",
    fineAmount: borrow.fineAmount,
    totalPaid: result.paid,
    outstanding: outstandingAfterPayment,
    finePaid: result.fullyPaid,
  });
}
