import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { runEbookExpiryScheduler } from "@/lib/ebook-scheduler";

export const dynamic = "force-dynamic";

/**
 * Endpoint deterministik untuk scheduler e-book (expired + pre-expiry reminder).
 *
 * Dapat dipanggil oleh scheduler eksternal (cron/Windows Task Scheduler) dengan
 * header `Authorization: Bearer <CRON_SECRET>`, atau oleh Administrator yang
 * sudah login. Tidak ada autentikasi lain → 401.
 *
 * Aman dipanggil berulang: di-throttle 5 menit dan anti-duplikat via eventKey.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let allowed = false;
  if (cronSecret && bearer && bearer === cronSecret) {
    allowed = true;
  } else {
    const session = await getServerSession(authOptions);
    if (session?.user?.role === "ADMIN") allowed = true;
  }

  if (!allowed) {
    console.warn(`[cron:ebook-expiry] ${new Date().toISOString()} unauthorized attempt`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runEbookExpiryScheduler();
  console.log(
    `[cron:ebook-expiry] ${new Date().toISOString()} expired=${result.expired} reminded=${result.reminded} skipped=${result.skipped}${result.reason ? ` reason=${result.reason}` : ""}`
  );
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
