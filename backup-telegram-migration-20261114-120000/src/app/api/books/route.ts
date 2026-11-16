import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidGrade } from "@/lib/config/smk";
import {
  BOOK_FORMAT,
  cleanOptionalText,
  isValidBookFormat,
  sanitizeEbookFilePath,
  serializeBook,
} from "@/lib/books";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 12;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const categoryId = searchParams.get("category") || "";
    const grade = searchParams.get("grade") || "";
    const subject = searchParams.get("subject") || "";
    const major = searchParams.get("major") || "";
    const availability = searchParams.get("availability") || ""; // "available" or ""
    const parsedPage = parseInt(searchParams.get("page") || "1", 10);
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

    const parsedPageSize = parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10);
    const validPageSize =
      Number.isInteger(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(50, validPageSize);

    // Buku yang diarsipkan (soft delete) tidak pernah muncul di katalog aktif.
    const where: Record<string, unknown> = { archivedAt: null };

    if (search) {
      // Pencarian teks bebas juga menjangkau mata pelajaran dan jurusan.
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

    const books = await prisma.book.findMany({
      where,
      include: {
        category: true,
        _count: {
          select: {
            borrows: {
              where: { status: { in: ["BORROWED", "OVERDUE"] } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const total = await prisma.book.count({ where });

    // Calculate available stock for each book
    let formattedBooks = books.map((book) => {
      const activeBorrowsCount = book._count.borrows;
      const available = Math.max(0, book.stock - activeBorrowsCount);
      const { _count, ...bookData } = book;
      return serializeBook({ ...bookData, available });
    });

    // Apply availability filter on the memory after fetching
    // If the dataset gets very large, this should be done differently,
    // but Prisma doesn't natively support filtering by computed relations easily without raw queries.
    if (availability === "available") {
      formattedBooks = formattedBooks.filter(book => book.available > 0);
    }

    return NextResponse.json({
      books: formattedBooks,
      total,
      page,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch books" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !["ADMIN", "LIBRARIAN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      title,
      author,
      isbn,
      publisher,
      year,
      stock,
      coverUrl,
      description,
      categoryId,
      grade,
      subject,
      major,
      format,
      filePath,
      pageCount,
    } = body;

    if (!title?.trim() || !author?.trim()) {
      return NextResponse.json({ error: "Judul dan Penulis wajib diisi" }, { status: 400 });
    }

    const stockNum = stock === undefined || stock === "" ? 0 : parseInt(stock, 10);
    if (Number.isNaN(stockNum) || stockNum < 0) {
      return NextResponse.json({ error: "Stok tidak boleh negatif" }, { status: 400 });
    }

    if (grade !== undefined && grade !== null && grade !== "" && !isValidGrade(String(grade))) {
      return NextResponse.json({ error: "Kelas tidak valid (X, XI, atau XII)" }, { status: 400 });
    }

    const resolvedFormat = isValidBookFormat(format) ? format : BOOK_FORMAT.PHYSICAL;
    const isEbook = resolvedFormat === BOOK_FORMAT.EBOOK;

    const book = await prisma.book.create({
      data: {
        title: title.trim(),
        author: author.trim(),
        isbn: cleanOptionalText(isbn),
        publisher: cleanOptionalText(publisher),
        year: year ? parseInt(year, 10) : null,
        stock: stockNum,
        coverUrl: cleanOptionalText(coverUrl),
        description: cleanOptionalText(description),
        categoryId: categoryId || null,
        grade: cleanOptionalText(grade),
        subject: cleanOptionalText(subject),
        major: cleanOptionalText(major),
        format: resolvedFormat,
        // Only ebooks may carry a file; physical books never do.
        filePath: isEbook ? sanitizeEbookFilePath(filePath) : null,
        pageCount: isEbook && pageCount ? parseInt(pageCount, 10) : null,
      },
      include: { category: true },
    });

    await prisma.auditLog.create({
      data: {
        action: "CREATE_BOOK",
        userId: session.user.id,
        details: `Menambahkan buku: ${book.title}`,
      },
    });

    return NextResponse.json(serializeBook(book), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create book" }, { status: 500 });
  }
}