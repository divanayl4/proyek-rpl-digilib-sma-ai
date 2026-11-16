import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface DailyActivity {
  date: string;
  physicalBorrows: number;
  physicalReturns: number;
  ebookLoans: number;
}

function getJakartaDateKey(date: Date): string {
  // Mengonversi waktu ke format YYYY-MM-DD dalam zona waktu Asia/Jakarta
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "7days";

    const now = new Date();
    let startDate: Date;

    if (period === "today") {
      // Awal hari ini (00:00:00) waktu Asia/Jakarta
      const todayStr = getJakartaDateKey(now);
      startDate = new Date(`${todayStr}T00:00:00+07:00`);
    } else if (period === "30days") {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      // Default 7 days
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Ambil data peminjaman buku fisik, pengembalian fisik, dan peminjaman ebook
    const [physicalBorrows, physicalReturns, ebookLoans] = await Promise.all([
      prisma.borrowRecord.findMany({
        where: {
          borrowDate: { gte: startDate, lte: now },
        },
        select: { borrowDate: true },
      }),
      prisma.borrowRecord.findMany({
        where: {
          status: "RETURNED",
          returnDate: { not: null, gte: startDate, lte: now },
        },
        select: { returnDate: true },
      }),
      prisma.ebookLoan.findMany({
        where: {
          borrowedAt: { gte: startDate, lte: now },
        },
        select: { borrowedAt: true },
      }),
    ]);

    const activityMap = new Map<string, DailyActivity>();

    // Buat slot hari dari startDate sampai now agar grafik berurutan
    const current = new Date(startDate.getTime());
    while (current <= now) {
      const key = getJakartaDateKey(current);
      if (!activityMap.has(key)) {
        activityMap.set(key, {
          date: key,
          physicalBorrows: 0,
          physicalReturns: 0,
          ebookLoans: 0,
        });
      }
      current.setDate(current.getDate() + 1);
    }
    // Pastikan tanggal 'now' juga masuk
    const todayKey = getJakartaDateKey(now);
    if (!activityMap.has(todayKey)) {
      activityMap.set(todayKey, {
        date: todayKey,
        physicalBorrows: 0,
        physicalReturns: 0,
        ebookLoans: 0,
      });
    }

    physicalBorrows.forEach((b) => {
      const key = getJakartaDateKey(b.borrowDate);
      const entry = activityMap.get(key);
      if (entry) entry.physicalBorrows += 1;
    });

    physicalReturns.forEach((b) => {
      if (b.returnDate) {
        const key = getJakartaDateKey(b.returnDate);
        const entry = activityMap.get(key);
        if (entry) entry.physicalReturns += 1;
      }
    });

    ebookLoans.forEach((l) => {
      const key = getJakartaDateKey(l.borrowedAt);
      const entry = activityMap.get(key);
      if (entry) entry.ebookLoans += 1;
    });

    const data = Array.from(activityMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    return NextResponse.json({ data, period });
  } catch (error) {
    console.error("[API] Gagal mengambil data aktivitas sistem:", error);
    return NextResponse.json(
      { error: "Gagal memuat aktivitas sistem." },
      { status: 500 }
    );
  }
}
