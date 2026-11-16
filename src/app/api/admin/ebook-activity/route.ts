import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  isReadingActivityStatus,
  type ReadingActivityStatus,
} from "@/lib/config/reading";
import {
  isReadingPeriodKey,
  listReadingActivity,
  resolveReadingPeriod,
} from "@/lib/ebook-reading";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ebook-activity
 *
 * Pemantauan aktivitas membaca GLOBAL hanya untuk ADMIN. Otorisasi diperiksa
 * dari sesi server; menu yang disembunyikan di UI bukan batas keamanan.
 *
 * Filter `lastActivityAt` memakai periode berbasis Asia/Jakarta. Status
 * diturunkan dari waktu server + data sesi (bukan kolom status yang bisa
 * tertinggal).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const rawPageSize = parseInt(searchParams.get("pageSize") || "20", 10) || 20;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));
  const search = (searchParams.get("search") || "").trim().slice(0, 100);
  const rawStatus = (searchParams.get("status") || "").toUpperCase();
  const rawPeriod = searchParams.get("period") || "30d";
  const sort =
    searchParams.get("sort") === "lastActivityAt_asc"
      ? "lastActivityAt_asc"
      : "lastActivityAt_desc";

  let status: ReadingActivityStatus | null = null;
  if (rawStatus && rawStatus !== "ALL") {
    if (!isReadingActivityStatus(rawStatus)) {
      return NextResponse.json(
        { error: "Status aktivitas tidak valid" },
        { status: 400 }
      );
    }
    status = rawStatus;
  }

  if (rawPeriod !== "all" && !isReadingPeriodKey(rawPeriod)) {
    return NextResponse.json(
      { error: "Periode tidak valid" },
      { status: 400 }
    );
  }

  const now = new Date();
  const period = resolveReadingPeriod(rawPeriod, now);
  const result = await listReadingActivity({
    filters: {
      search: search || undefined,
      status,
      start: period.start,
      end: period.end,
      periodLabel: period.label,
    },
    page,
    pageSize,
    sort,
    now,
  });

  return NextResponse.json({
    ...result,
    period: {
      key: period.key,
      label: period.label,
      start: period.start?.toISOString() ?? null,
      end: period.end?.toISOString() ?? null,
    },
    filters: {
      search,
      status: status ?? "ALL",
      period: period.key,
      sort,
    },
  });
}
