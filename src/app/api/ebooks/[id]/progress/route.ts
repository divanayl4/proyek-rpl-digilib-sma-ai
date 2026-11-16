import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/ebooks/[id]/progress
 *
 * Mengembalikan sesi membaca terbaru milik pengguna yang login untuk ebook ini.
 * Dipakai oleh reader untuk melanjutkan membaca (lastPage) dan oleh halaman
 * "Ebook Saya" untuk menampilkan progres.
 *
 * Tidak memerlukan akses aktif; pengguna yang masa aksesnya sudah habis tetap
 * bisa melihat progres terakhirnya.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const bookId = params.id;

  // Ambil sesi membaca terbaru berdasarkan lastActivityAt. Sesi yang sudah
  // ditutup (endedAt) tetap dipakai – yang penting lastPage paling baru.
  const latestSession = await prisma.ebookReadingSession.findFirst({
    where: { userId, bookId },
    orderBy: { lastActivityAt: "desc" },
    select: {
      id: true,
      lastPage: true,
      progressPercent: true,
      firstOpenedAt: true,
      lastActivityAt: true,
      activityCount: true,
    },
  });

  if (!latestSession) {
    return NextResponse.json({
      found: false,
      lastPage: null,
      progressPercent: null,
      lastActivityAt: null,
    });
  }

  return NextResponse.json({
    found: true,
    lastPage: latestSession.lastPage,
    progressPercent: latestSession.progressPercent,
    firstOpenedAt: latestSession.firstOpenedAt,
    lastActivityAt: latestSession.lastActivityAt,
    activityCount: latestSession.activityCount,
  });
}
