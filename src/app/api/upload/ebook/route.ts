import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, extname } from "path";
import { EBOOK_STORAGE_ROOT } from "@/lib/ebook-access";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/upload/ebook
 *
 * Admin/Pustakawan mengunggah berkas PDF yang sah untuk sebuah ebook. Berkas
 * disimpan di storage privat (bukan ikon publik) dan hanya diakses lewat route
 * yang sudah memeriksa masa peminjaman. Mengembalikan nama berkas relatif yang
 * harus disimpan pada Book.filePath.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !["ADMIN", "LIBRARIAN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Format tidak didukung. Unggah berkas PDF." },
        { status: 400 }
      );
    }

    if (extname(file.name).toLowerCase() !== ".pdf") {
      return NextResponse.json(
        { error: "Ekstensi berkas harus .pdf" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Ukuran berkas terlalu besar. Maksimal ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.` },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Reject anything that is not actually a PDF, regardless of MIME/extension.
    if (bytes.length < 5 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return NextResponse.json(
        { error: "Berkas bukan PDF yang sah." },
        { status: 400 }
      );
    }

    if (!existsSync(EBOOK_STORAGE_ROOT)) {
      await mkdir(EBOOK_STORAGE_ROOT, { recursive: true });
    }

    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const filename = `ebook-${uniqueSuffix}.pdf`;
    await writeFile(join(EBOOK_STORAGE_ROOT, filename), bytes);

    return NextResponse.json(
      { filePath: filename, size: bytes.length },
      { status: 201 }
    );
  } catch (error) {
    console.error("Ebook upload error:", error);
    return NextResponse.json({ error: "Gagal mengunggah berkas ebook" }, { status: 500 });
  }
}