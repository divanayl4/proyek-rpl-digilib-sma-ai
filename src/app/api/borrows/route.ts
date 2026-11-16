import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTransactionStats } from "@/lib/transactionStats";
import {
  LIBRARY_CONFIG,
  BORROW_STATUS,
  ACTIVE_BORROW_STATUSES,
  OPEN_BORROW_STATUSES,
  calculateDueDate,
} from "@/lib/config/library";
import { EBOOK_FORMAT } from "@/lib/config/ebook";
import { notifyBorrowSuccess, notifyLibrarians } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/borrows
 * - Librarians/Admins: get all borrows (with filters)
 * - Regular users: get their own borrows
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const parsedPage = parseInt(searchParams.get("page") || "1", 10);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const parsedPageSize = parseInt(searchParams.get("pageSize") || "20", 10);
  const validPageSize =
    Number.isInteger(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : 20;
  const pageSize = Math.min(100, validPageSize);
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const userId = searchParams.get("userId") || "";
  const year = searchParams.get("year") || "";
  const type = (searchParams.get("type") || "").toLowerCase();

  if (type && type !== "book" && type !== "ebook") {
    return NextResponse.json(
      { error: "Kategori transaksi tidak valid" },
      { status: 400 }
    );
  }

  const now = new Date();
  const isLibrarian = LIBRARY_CONFIG.librarianRoles.includes(session.user.role);
  const includePhysical = type !== "ebook";
  // Riwayat ebook ikut ditampilkan untuk semua peminjam. Non-librarian hanya
  // melihat EbookLoan miliknya sendiri (lihat `ebookWhere.userId` di bawah).
  const includeEbooks = type !== "book";

  const where: Prisma.BorrowRecordWhereInput = {};

  // Non-librarians can only see their own borrows
  if (!isLibrarian) {
    where.userId = session.user.id;
  } else if (userId) {
    where.userId = userId;
  }

  if (status) {
    if (status === "OVERDUE") {
      // OVERDUE covers rows still stored as BORROWED past their due date and
      // rows already persisted as OVERDUE.
      where.status = { in: ["BORROWED", "OVERDUE"] };
      where.dueDate = { lt: now };
    } else if (status === "BORROWED") {
      // "Dipinjam" is the on-time active state. Rows stored as BORROWED but
      // past due are surfaced through the separate OVERDUE filter/status.
      where.status = "BORROWED";
      where.dueDate = { gte: now };
    } else {
      where.status = status;
    }
  }

  if (search && isLibrarian) {
    where.OR = [
      { user: { name: { contains: search } } },
      { user: { email: { contains: search } } },
      { user: { class: { contains: search } } },
      { user: { identityNumber: { contains: search } } },
      { book: { title: { contains: search } } },
      { book: { isbn: { contains: search } } },
    ];
  }

  if (/^\d{4}$/.test(year)) {
    where.borrowDate = {
      gte: new Date(Date.UTC(Number(year), 0, 1)),
      lt: new Date(Date.UTC(Number(year) + 1, 0, 1)),
    };
  }

  // When the caller asks for the ebook category only, keep the physical
  // queries empty instead of leaking physical counts into the summary.
  const physicalWhere: Prisma.BorrowRecordWhereInput = includePhysical
    ? where
    : { ...where, id: { in: [] } };

  // -------------------------------------------------------------------------
  // Ebook loans (EbookLoan) are merged into the transaction list for every
  // borrower. Staff may see all users (or filter by `userId`); regular users
  // are ALWAYS scoped to their own session id.
  //
  // Status ebook diturunkan dari timestamp (sumber kebenaran yang sama dengan
  // getEbookAccessState), BUKAN dari kolom status yang di-update lazy.
  // -------------------------------------------------------------------------
  const ebookWhere: Prisma.EbookLoanWhereInput = {};
  let includeEbookRows = includeEbooks;

  if (includeEbooks) {
    if (isLibrarian) {
      if (userId) ebookWhere.userId = userId;
    } else {
      ebookWhere.userId = session.user.id;
    }

    if (search) {
      ebookWhere.OR = [
        { user: { name: { contains: search } } },
        { user: { email: { contains: search } } },
        { user: { class: { contains: search } } },
        { user: { identityNumber: { contains: search } } },
        { book: { title: { contains: search } } },
        { book: { isbn: { contains: search } } },
      ];
    }

    if (/^\d{4}$/.test(year)) {
      ebookWhere.borrowedAt = {
        gte: new Date(Date.UTC(Number(year), 0, 1)),
        lt: new Date(Date.UTC(Number(year) + 1, 0, 1)),
      };
    }

    if (status === "BORROWED") {
      ebookWhere.returnedAt = null;
      ebookWhere.expiresAt = { gt: now };
    } else if (status === "RETURNED") {
      ebookWhere.returnedAt = { not: null };
    } else if (status === "EXPIRED") {
      ebookWhere.returnedAt = null;
      ebookWhere.expiresAt = { lte: now };
    } else if (status) {
      // REQUESTED/OVERDUE/CANCELLED/REJECTED are physical-only statuses.
      includeEbookRows = false;
    }
  }

  type EbookRow = {
    id: string;
    borrowedAt: Date;
    expiresAt: Date;
    returnedAt: Date | null;
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
      class: string | null;
      identityNumber: string | null;
    };
    book: {
      id: string;
      title: string;
      author: string;
      isbn: string | null;
      coverUrl: string | null;
      archivedAt: Date | null;
    };
  };

  const ebookQuery: Promise<EbookRow[]> =
    includeEbookRows
      ? prisma.ebookLoan.findMany({
          where: ebookWhere,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                class: true,
                identityNumber: true,
              },
            },
            book: {
              select: {
                id: true,
                title: true,
                author: true,
                isbn: true,
                coverUrl: true,
                archivedAt: true,
              },
            },
          },
          orderBy: { borrowedAt: "desc" },
        })
      : Promise.resolve([]);

  const [records, ebookLoans, stats] = await Promise.all([
    prisma.borrowRecord.findMany({
      where: physicalWhere,
      include: {
        user: { select: { id: true, name: true, email: true, role: true, class: true, identityNumber: true } },
        book: { select: { id: true, title: true, author: true, isbn: true, coverUrl: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { borrowDate: "desc" },
      // When ebook rows are merged in, the full physical set is needed so
      // pagination/sorting across both sources stays consistent. Without
      // ebooks (e.g. `type=book`) physical rows can be paginated in the DB.
      ...(includeEbooks ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
    }),
    ebookQuery,
    getTransactionStats({
      physicalWhere,
      ebookWhere,
      includePhysical,
      includeEbook: includeEbookRows,
      now,
    }),
  ]);

  const physicalBorrows = records.map((r) => ({
    ...r,
    itemType: "book" as const,
    effectiveStatus: r.status === "BORROWED" && now > r.dueDate ? "OVERDUE" : r.status,
  }));

  const ebookBorrows = ebookLoans.map((loan) => {
    const state = loan.returnedAt
      ? "RETURNED"
      : loan.expiresAt.getTime() > now.getTime()
        ? "ACTIVE"
        : "EXPIRED";
    return {
      id: `ebook:${loan.id}`,
      itemType: "ebook" as const,
      borrowDate: loan.borrowedAt,
      dueDate: loan.expiresAt,
      returnDate: loan.returnedAt,
      // ACTIVE here means "masa akses aktif", not "sedang dibaca".
      status: state,
      effectiveStatus: state === "ACTIVE" ? "BORROWED" : state,
      notes: null,
      borrowReason: null,
      fineAmount: 0,
      finePaid: true,
      user: loan.user,
      book: {
        ...loan.book,
        isArchived: loan.book.archivedAt !== null,
      },
      createdBy: null,
    };
  });

  let borrows: Array<(typeof physicalBorrows)[number] | (typeof ebookBorrows)[number]>;
  const responseTotal = stats.total;
  const totalPages = Math.ceil(responseTotal / pageSize);

  if (includeEbooks) {
    const merged = [...physicalBorrows, ...ebookBorrows].sort(
      (a, b) => new Date(b.borrowDate).getTime() - new Date(a.borrowDate).getTime()
    );
    borrows = merged.slice((page - 1) * pageSize, page * pageSize);
  } else {
    borrows = physicalBorrows;
  }

  return NextResponse.json({
    borrows,
    total: responseTotal,
    page,
    totalPages,
    summary: {
      total: stats.total,
      requested: stats.physicalRequested,
      borrowed: stats.physicalBorrowedOnTime,
      overdue: stats.physicalOverdue,
      returned: stats.physicalReturned,
      cancelled: stats.physicalCancelled,
      rejected: stats.physicalRejected,
      physicalTotal: stats.physicalTotal,
      physicalActive: stats.physicalActive,
      ebookTotal: stats.ebookTotal,
      ebookActive: stats.ebookActive,
      ebookReturned: stats.ebookReturned,
      ebookExpired: stats.ebookExpired,
    },
  });
}

/**
 * POST /api/borrows
 * - Pustakawan/Admin (dengan `userId`): membuat transaksi dan langsung
 *   menyerahkan buku (status BORROWED) – dipakai saat penyerahan di meja sirkulasi.
 * - Siswa/Guru/Staf (permintaan mandiri): mengajukan peminjaman online
 *   (status REQUESTED). Stok BELUM berkurang sampai Pustakawan menyetujui.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { bookId, userId: targetUserId, notes } = body;

  if (!bookId) {
    return NextResponse.json({ error: "bookId wajib diisi" }, { status: 400 });
  }

  // Alasan berasal dari input pengguna dan hanya disimpan sebagai teks biasa.
  // Role/identitas peminjam TIDAK diambil dari body – selalu dari sesi/database.
  const borrowReason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (borrowReason.length > LIBRARY_CONFIG.borrowReasonMaxLength) {
    return NextResponse.json(
      { error: `Alasan peminjaman maksimal ${LIBRARY_CONFIG.borrowReasonMaxLength} karakter` },
      { status: 400 }
    );
  }

  const isLibrarian = LIBRARY_CONFIG.librarianRoles.includes(session.user.role);

  // Penyerahan langsung hanya bila staf perpustakaan membuat untuk anggota lain.
  const directHandover = isLibrarian && !!targetUserId;
  const borrowerId = directHandover ? targetUserId : session.user.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch borrower
      const borrower = await tx.user.findUnique({ where: { id: borrowerId } });
      if (!borrower) {
        throw new Error("Pengguna tidak ditemukan");
      }
      if (!borrower.isActive) {
        throw new Error("Akun pengguna tidak aktif");
      }
      if (!LIBRARY_CONFIG.borrowerRoles.includes(borrower.role)) {
        throw new Error(`Role ${borrower.role} tidak diizinkan untuk meminjam buku`);
      }

      // Semua pengajuan mandiri (termasuk Siswa/Guru) WAJIB menulis alasan.
      // Penyerahan langsung oleh Pustakawan (directHandover) bukan pengajuan
      // online sehingga tidak terikat aturan ini. Spasi saja dianggap kosong
      // karena nilainya sudah di-trim di atas.
      const reasonRequired = !directHandover;
      if (reasonRequired && !borrowReason) {
        throw new Error("Alasan Peminjaman Buku wajib diisi");
      }

      // 2. Quota: hitung peminjaman aktif + pengajuan yang belum selesai.
      const openBorrowCount = await tx.borrowRecord.count({
        where: { userId: borrowerId, status: { in: OPEN_BORROW_STATUSES } },
      });
      const maxBorrows = LIBRARY_CONFIG.maxBorrowsPerRole[borrower.role] ?? 3;
      if (openBorrowCount >= maxBorrows) {
        throw new Error(
          `Pengguna telah mencapai batas maksimal peminjaman (${maxBorrows} buku)`
        );
      }

      // 3. Cegah duplikat: buku yang sama belum selesai dipinjam/diajukan.
      const existingBorrow = await tx.borrowRecord.findFirst({
        where: { userId: borrowerId, bookId, status: { in: OPEN_BORROW_STATUSES } },
      });
      if (existingBorrow) {
        throw new Error("Pengguna sudah meminjam atau mengajukan buku ini");
      }

      // 4. Fetch book + availability
      const book = await tx.book.findUnique({ where: { id: bookId } });
      if (!book) {
        throw new Error("Buku tidak ditemukan");
      }

      // Digital copies are borrowed through /api/ebooks, never the physical
      // circulation desk.
      if (book.format === EBOOK_FORMAT) {
        throw new Error("Ebook dipinjam melalui menu Ebook, bukan peminjaman buku fisik");
      }

      const activeBooksOnLoan = await tx.borrowRecord.count({
        where: { bookId, status: { in: ACTIVE_BORROW_STATUSES } },
      });
      const available = book.stock - activeBooksOnLoan;
      if (available <= 0) {
        throw new Error("Stok buku tidak tersedia");
      }

      const now = new Date();
      const dueDate = calculateDueDate(borrower.role, now);
      const status = directHandover ? BORROW_STATUS.BORROWED : BORROW_STATUS.REQUESTED;

      const borrow = await tx.borrowRecord.create({
        data: {
          userId: borrowerId,
          bookId,
          borrowDate: now,
          dueDate,
          status,
          createdById: session.user.id,
          requestedAt: now,
          ...(directHandover
            ? { approvedAt: now, approvedById: session.user.id }
            : {}),
          notes: notes?.trim() || null,
          borrowReason: borrowReason || null,
        },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          book: { select: { id: true, title: true, author: true, isbn: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: directHandover ? "CREATE_BORROW" : "REQUEST_BORROW",
          userId: session.user.id,
          details: directHandover
            ? `Peminjaman: ${borrow.user.name} meminjam "${borrow.book.title}" (ID: ${borrow.id})`
            : `Pengajuan peminjaman: ${borrow.user.name} mengajukan "${borrow.book.title}" (ID: ${borrow.id})`,
        },
      });

      return borrow;
    });

    // Notifikasi setelah transaksi sukses.
    if (result.status === BORROW_STATUS.REQUESTED) {
      await notifyLibrarians(
        "Pengajuan Peminjaman Baru",
        `${result.user.name} mengajukan peminjaman buku "${result.book.title}". Mohon ditinjau.`,
        "INFO",
        "/librarian/borrows",
        { eventKeyPrefix: `librarian:borrow-request:${result.id}`, category: "BORROW" }
      ).catch(() => undefined);
    } else {
      await notifyBorrowSuccess(
        result.userId,
        result.book.title,
        result.id,
        result.dueDate,
        { eventKey: `borrow:handover:${result.id}` }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Gagal membuat transaksi peminjaman";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
