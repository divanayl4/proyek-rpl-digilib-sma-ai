import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyEbookReturned } from "@/lib/notifications";
import { EBOOK_CONFIG } from "@/lib/config/ebook";

export const dynamic = "force-dynamic";

/**
 * POST /api/ebooks/return
 * Close an open loan ("Pinjam Kembali").
 *
 * Accepts either `loanId` or `bookId`. The lookup is always scoped to the
 * session user, so passing someone else's loan id returns 404 instead of
 * closing it.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { loanId?: string; bookId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON" }, { status: 400 });
  }

  const loanId = body.loanId?.trim();
  const bookId = body.bookId?.trim();

  if (!loanId && !bookId) {
    return NextResponse.json({ error: "loanId atau bookId wajib diisi" }, { status: 400 });
  }

  const userId = session.user.id;

  const loan = await prisma.ebookLoan.findFirst({
    where: loanId
      ? { id: loanId, userId }
      : { userId, bookId: bookId!, returnedAt: null },
    orderBy: { borrowedAt: "desc" },
    include: { book: { select: { id: true, title: true } } },
  });

  if (!loan) {
    return NextResponse.json(
      { error: "Peminjaman ebook tidak ditemukan" },
      { status: 404 }
    );
  }

  if (loan.returnedAt) {
    return NextResponse.json(
      { error: "Ebook ini sudah pernah dikembalikan" },
      { status: 400 }
    );
  }

  const now = new Date();
  // An expired loan is recorded as EXPIRED, an early return as RETURNED.
  const finalStatus =
    loan.expiresAt.getTime() <= now.getTime()
      ? EBOOK_CONFIG.loanStatuses.EXPIRED
      : EBOOK_CONFIG.loanStatuses.RETURNED;

  const updated = await prisma.ebookLoan.update({
    where: { id: loan.id },
    data: { returnedAt: now, status: finalStatus },
    select: {
      id: true,
      userId: true,
      bookId: true,
      borrowedAt: true,
      expiresAt: true,
      returnedAt: true,
      status: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "RETURN_EBOOK",
      userId,
      details: `Pengembalian ebook: ${loan.book.title} (status: ${finalStatus}, ID: ${loan.id})`,
    },
  });

  await notifyEbookReturned(userId, loan.book.title, {
    eventKey: `ebook:return:${loan.id}`,
  });

  return NextResponse.json({
    loan: updated,
    accessState: finalStatus === EBOOK_CONFIG.loanStatuses.RETURNED ? "RETURNED" : "EXPIRED",
  });
}