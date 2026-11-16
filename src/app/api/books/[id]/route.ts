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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const book = await prisma.book.findUnique({
      where: { id: params.id },
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
    });

    if (!book) return NextResponse.json({ error: "Buku tidak ditemukan" }, { status: 404 });

    const activeBorrowsCount = book._count.borrows;
    const available = Math.max(0, book.stock - activeBorrowsCount);
    
    // Using rest operator to omit _count
    const { _count, ...bookData } = book;

    return NextResponse.json({
      book: serializeBook({
        ...bookData,
        available,
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch book" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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

    const target = await prisma.book.findUnique({ where: { id: params.id } });
    if (!target) return NextResponse.json({ error: "Buku tidak ditemukan" }, { status: 404 });

    if (stock !== undefined && (Number.isNaN(parseInt(stock, 10)) || parseInt(stock, 10) < 0)) {
      return NextResponse.json({ error: "Stok tidak boleh negatif" }, { status: 400 });
    }

    if (grade !== undefined && grade !== null && grade !== "" && !isValidGrade(String(grade))) {
      return NextResponse.json({ error: "Kelas tidak valid (X, XI, atau XII)" }, { status: 400 });
    }

    if (format !== undefined && !isValidBookFormat(format)) {
      return NextResponse.json({ error: "Format buku tidak valid" }, { status: 400 });
    }

    const nextFormat = isValidBookFormat(format) ? format : target.format;
    const isEbook = nextFormat === BOOK_FORMAT.EBOOK;

    // Physical books never carry a file; ebooks may set/clear theirs.
    let nextFilePath: string | null | undefined;
    if (!isEbook) {
      nextFilePath = null;
    } else if (filePath !== undefined) {
      nextFilePath = sanitizeEbookFilePath(filePath);
    }

    const updated = await prisma.book.update({
      where: { id: params.id },
      data: {
        ...(title?.trim() && { title: title.trim() }),
        ...(author?.trim() && { author: author.trim() }),
        isbn: isbn !== undefined ? cleanOptionalText(isbn) : undefined,
        publisher: publisher !== undefined ? cleanOptionalText(publisher) : undefined,
        year: year !== undefined ? (year ? parseInt(year, 10) : null) : undefined,
        ...(stock !== undefined && { stock: parseInt(stock, 10) }),
        coverUrl: coverUrl !== undefined ? cleanOptionalText(coverUrl) : undefined,
        description: description !== undefined ? cleanOptionalText(description) : undefined,
        categoryId: categoryId !== undefined ? (categoryId || null) : undefined,
        grade: grade !== undefined ? cleanOptionalText(grade) : undefined,
        subject: subject !== undefined ? cleanOptionalText(subject) : undefined,
        major: major !== undefined ? cleanOptionalText(major) : undefined,
        format: format !== undefined ? nextFormat : undefined,
        filePath: nextFilePath,
        pageCount: pageCount !== undefined ? (pageCount ? parseInt(pageCount, 10) : null) : undefined,
      },
      include: { category: true },
    });

    await prisma.auditLog.create({
      data: {
        action: "UPDATE_BOOK",
        userId: session.user.id,
        details: `Mengedit buku: ${updated.title}`,
      },
    });

    return NextResponse.json(serializeBook(updated));
  } catch (error) {
    return NextResponse.json({ error: "Failed to update book" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !["ADMIN", "LIBRARIAN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const target = await prisma.book.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { borrows: true, ebookLoans: true } },
      },
    });

    if (!target) return NextResponse.json({ error: "Buku tidak ditemukan" }, { status: 404 });

    if (target._count.borrows > 0 || target._count.ebookLoans > 0) {
      return NextResponse.json({ 
        error: "Buku tidak dapat dihapus karena memiliki riwayat peminjaman atau peminjaman ebook. Ubah jumlah eksemplar menjadi 0 untuk menonaktifkannya." 
      }, { status: 400 });
    }

    await prisma.book.delete({ where: { id: params.id } });

    await prisma.auditLog.create({
      data: {
        action: "DELETE_BOOK",
        userId: session.user.id,
        details: `Menghapus buku: ${target.title}`,
      },
    });

    return NextResponse.json({ message: "Buku dihapus" });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete book" }, { status: 500 });
  }
}
