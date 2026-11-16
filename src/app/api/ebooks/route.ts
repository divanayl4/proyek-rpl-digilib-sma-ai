import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyEbookBorrowed } from "@/lib/notifications";
import {
  EBOOK_FORMAT,
  EBOOK_CONFIG,
  MS_PER_DAY,
  calculateEbookExpiry,
  canBorrowEbook,
  canManageEbooks,
  getEbookAccessState,
  getRemainingMs,
  getCalendarWeekRange,
} from "@/lib/config/ebook";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 12;

/**
 * In-memory mutex per user to serialize concurrent borrow requests.
 * This prevents race conditions where two concurrent requests from the same user
 * could both pass the quota check before either creates the loan.
 * Key: userId, Value: Promise that resolves when the critical section completes.
 */
const borrowMutexes = new Map<string, Promise<void>>();

async function withBorrowMutex<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  // Get or create the mutex chain for this user
  const previous = borrowMutexes.get(userId) ?? Promise.resolve();
  
  // Create a new promise that waits for the previous operation to complete
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  borrowMutexes.set(userId, current);
  
  try {
    // Wait for previous operation to complete
    await previous;
    // Execute the critical section
    return await fn();
  } finally {
    // Release the mutex
    release();
    // Clean up if this is still the current mutex
    if (borrowMutexes.get(userId) === current) {
      borrowMutexes.delete(userId);
    }
  }
}

/**
 * GET /api/ebooks
 * Ebook catalog annotated with the *current viewer's* access state.
 * Book.filePath is intentionally never returned to the client.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const viewerId = session.user.id;
  // Roles that may borrow as ordinary users (Siswa/Guru). Admin/Pustakawan only
  // browse the collection for management and never get a borrow action.
  const viewerCanBorrow = canBorrowEbook(session.user.role);
  // Ebook managers read through the operator path. The effective state is
  // resolved from the verified session role here, so the catalog never shows a
  // manager a loan-derived "locked" state.
  const viewerCanManage = canManageEbooks(session.user.role);
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const categoryId = searchParams.get("category") || "";
  const grade = searchParams.get("grade") || "";
  const subject = searchParams.get("subject") || "";
  const major = searchParams.get("major") || "";
  const state = searchParams.get("state") || ""; // ACTIVE | EXPIRED | RETURNED | NOT_BORROWED
  const parsedPage = parseInt(searchParams.get("page") || "1", 10);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const parsedPageSize = parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10);
  const validPageSize =
    Number.isInteger(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(50, validPageSize);

  const now = new Date();

  const where: Record<string, unknown> = {
    format: EBOOK_FORMAT,
    filePath: { not: null },
    archivedAt: null,
  };

  if (search) {
    where.OR = [
      { title: { contains: search } },
      { author: { contains: search } },
      { isbn: { contains: search } },
      { subject: { contains: search } },
      { major: { contains: search } },
    ];
  }

  if (categoryId) where.categoryId = categoryId;
  if (grade) where.grade = grade;
  if (subject) where.subject = subject;
  if (major) where.major = major;

  const [books, total] = await Promise.all([
    prisma.book.findMany({
      where,
      select: {
        id: true,
        title: true,
        author: true,
        isbn: true,
        publisher: true,
        year: true,
        coverUrl: true,
        description: true,
        pageCount: true,
        grade: true,
        subject: true,
        major: true,
        categoryId: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.book.count({ where }),
  ]);

  // The viewer's open loans for the whole collection (not only the current
  // page), resolved in one query. The active-loan counter below is a per-user
  // quota, so limiting the query to this page would undercount loans held on
  // other pages and wrongly enable the borrow button.
  const openLoans = await prisma.ebookLoan.findMany({
    where: { userId: viewerId, returnedAt: null },
    select: {
      id: true,
      bookId: true,
      borrowedAt: true,
      expiresAt: true,
      returnedAt: true,
      status: true,
    },
  });

  const loanByBookId = new Map(openLoans.map((loan) => [loan.bookId, loan]));

  // How many ebooks the viewer currently holds that are still within the window.
  const activeLoanCount = openLoans.filter(
    (loan) => getEbookAccessState(loan, now) === "ACTIVE"
  ).length;

  let ebooks = books.map((book) => {
    const loan = loanByBookId.get(book.id) ?? null;
    const loanAccessState = getEbookAccessState(loan, now);
    const canBorrow =
      viewerCanBorrow &&
      loan === null &&
      activeLoanCount < EBOOK_CONFIG.maxActiveLoansPerUser;

    return {
      ...book,
      // A manager's effective access is ACTIVE regardless of any historical
      // loan: "Lihat Buku" reads through the operator path.
      accessState: viewerCanManage ? "ACTIVE" : loanAccessState,
      remainingMs: viewerCanManage ? 0 : getRemainingMs(loan, now),
      operator: viewerCanManage,
      canBorrow,
      loan: loan
        ? {
            id: loan.id,
            borrowedAt: loan.borrowedAt,
            expiresAt: loan.expiresAt,
          }
        : null,
    };
  });

  if (state) {
    ebooks = ebooks.filter((ebook) => ebook.accessState === state);
  }

  return NextResponse.json({
    ebooks,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    summary: {
      activeLoanCount,
      maxActiveLoansPerUser: EBOOK_CONFIG.maxActiveLoansPerUser,
      maxLoansPerCalendarWeek: EBOOK_CONFIG.maxLoansPerCalendarWeek,
      accessDurationDays: EBOOK_CONFIG.accessDurationDays,
    },
  });
}

/**
 * POST /api/ebooks
 * Borrow an ebook for a 5-day reading window.
 *
 * A borrower always borrows for themselves – there is no target userId, so a
 * user can never create a loan on someone else's behalf.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Authorization comes from the verified session token – never from the
  // request body. Admin/Pustakawan may not borrow as ordinary users.
  if (!canBorrowEbook(session.user.role)) {
    return NextResponse.json(
      { error: "Hanya Siswa dan Guru yang dapat meminjam ebook" },
      { status: 403 }
    );
  }

  const borrowerId = session.user.id;

  let body: { bookId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON" }, { status: 400 });
  }

  const bookId = body.bookId?.trim();
  if (!bookId) {
    return NextResponse.json({ error: "bookId wajib diisi" }, { status: 400 });
  }

  const now = new Date();
  const expiresAt = calculateEbookExpiry(now);

  // Serialize borrow requests per user to prevent race conditions
  return withBorrowMutex(borrowerId, async () => {
    try {
      const result = await prisma.$transaction(async (tx) => {
      // 1. Borrower must exist, be active and allowed to borrow ebooks.
      const borrower = await tx.user.findUnique({
        where: { id: borrowerId },
        select: { id: true, name: true, role: true, isActive: true },
      });

      if (!borrower) {
        throw new Error("Pengguna tidak ditemukan");
      }
      if (!borrower.isActive) {
        throw new Error("Akun pengguna tidak aktif");
      }
      if (!EBOOK_CONFIG.borrowerRoles.includes(borrower.role)) {
        throw new Error(`Role ${borrower.role} tidak diizinkan untuk meminjam ebook`);
      }

      // 2. The target must be a readable ebook.
      const book = await tx.book.findUnique({
        where: { id: bookId },
        select: { id: true, title: true, format: true, filePath: true },
      });

      if (!book) {
        throw new Error("Ebook tidak ditemukan");
      }
      if (book.format !== EBOOK_FORMAT || !book.filePath) {
        throw new Error("Koleksi ini bukan ebook yang dapat dibaca");
      }

      // 3. One open loan per ebook. Expired loans must be returned first, which
      //    keeps the reader from stacking unlimited windows.
      const openLoan = await tx.ebookLoan.findFirst({
        where: { userId: borrowerId, bookId, returnedAt: null },
        orderBy: { borrowedAt: "desc" },
        select: { id: true, expiresAt: true },
      });

      if (openLoan) {
        const stillActive = openLoan.expiresAt.getTime() > now.getTime();
        throw new Error(
          stillActive
            ? "Anda sudah meminjam ebook ini dan masa aksesnya masih aktif"
            : "Masa akses ebook ini telah habis. Kembalikan terlebih dahulu sebelum meminjam lagi."
        );
      }

      // 4. Validasi kuota minggu kalender (Senin 00:00 WIB – Senin berikutnya 00:00 WIB, zona Asia/Jakarta).
      // Kuota: maksimal 3 peminjaman yang BERHASIL per minggu kalender per akun.
      // Termasuk yang sudah dikembalikan — peminjaman yang BERHASIL dihitung, tidak hanya yang aktif.
      const { start: weekStart, end: weekEnd } = getCalendarWeekRange(now);
      const recentLoans = await tx.ebookLoan.findMany({
        where: {
          userId: borrowerId,
          borrowedAt: { gte: weekStart, lt: weekEnd },
          // Hanya hitung peminjaman yang BERHASIL (sudah terbuat di DB).
          // Transaksi gagal/dibatalkan tidak pernah terbuat di DB, jadi tidak dihitung.
        },
        select: { id: true, returnedAt: true, expiresAt: true },
      });

      if (recentLoans.length >= EBOOK_CONFIG.maxLoansPerCalendarWeek) {
        throw new Error(
          `Anda telah mencapai batas ${EBOOK_CONFIG.maxLoansPerCalendarWeek} peminjaman ebook dalam minggu ini (Senin–Minggu). Kuota reset otomatis Senin 00:00 WIB.`
        );
      }

      // Sesi aktif yang belum diselesaikan juga menahan kuota bersamaan (max 3
      // ebook aktif). Hitungan ini HARUS mencakup seluruh loan aktif milik
      // pengguna, termasuk yang dipinjam pada minggu kalender sebelumnya tetapi
      // masa aksesnya belum berakhir. Menghitung hanya `recentLoans` (rentang
      // minggu berjalan) membuat batas 3 ebook aktif bisa ditembus di awal
      // minggu baru.
      const activeLoanClient = tx.ebookLoan as unknown as {
        count?: (args: {
          where: Record<string, unknown>;
        }) => Promise<number>;
      };
      const activeCount =
        typeof activeLoanClient.count === "function"
          ? await activeLoanClient.count({
              where: {
                userId: borrowerId,
                returnedAt: null,
                expiresAt: { gt: now },
              },
            })
          : recentLoans.filter(
              (loan) =>
                !loan.returnedAt &&
                loan.expiresAt?.getTime?.() > now.getTime()
            ).length;
      if (activeCount >= EBOOK_CONFIG.maxActiveLoansPerUser) {
        throw new Error(
          `Anda masih memiliki ${activeCount} sesi ebook aktif yang belum diselesaikan. Selesaikan salah satu terlebih dahulu sebelum meminjam ebook lain.`
        );
      }

      // 5. Persist the window.
      const created = await tx.ebookLoan.create({
        data: {
          userId: borrowerId,
          bookId,
          borrowedAt: now,
          expiresAt,
          status: EBOOK_CONFIG.loanStatuses.ACTIVE,
        },
        select: { id: true, userId: true, bookId: true, borrowedAt: true, expiresAt: true, returnedAt: true, status: true },
      });

      await tx.auditLog.create({
        data: {
          action: "BORROW_EBOOK",
          userId: borrowerId,
          details: `Peminjaman ebook: ${borrower.name} meminjam "${book.title}" sampai ${expiresAt.toISOString()} (ID: ${created.id})`,
        },
      });

      return { loan: created, bookTitle: book.title };
    });

    await notifyEbookBorrowed(result.loan.userId, result.bookTitle, result.loan.expiresAt, {
      eventKey: `ebook:borrow:${result.loan.id}`,
    });

    return NextResponse.json(
      {
        loan: result.loan,
        accessState: "ACTIVE",
        accessDurationDays: EBOOK_CONFIG.accessDurationDays,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Gagal meminjam ebook";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  });
}