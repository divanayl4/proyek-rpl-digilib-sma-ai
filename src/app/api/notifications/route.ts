import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processOverdueNotifications, processUpcomingDueNotifications } from "@/lib/notifications";
import { runEbookExpiryScheduler } from "@/lib/ebook-scheduler";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications
 * Fetch notifications for the current user.
 * Also lazily triggers overdue/upcoming-due processing (~20% of requests).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Deterministic, self-throttling scheduler for e-book expiry + pre-expiry reminder.
  // Runs at most once every 5 minutes (throttled internally); never blocks response.
  runEbookExpiryScheduler().catch(console.error);

  // Lazy (probabilistic) processing for overdue/upcoming due (unchanged behavior).
  if (Math.random() < 0.2) {
    processOverdueNotifications().catch(console.error);
  }
  if (Math.random() < 0.1) {
    processUpcomingDueNotifications().catch(console.error);
  }

  const { searchParams } = new URL(req.url);
  const take = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
  const skip = Math.max(0, parseInt(searchParams.get("skip") || "0", 10));
  const unreadOnly = searchParams.get("unreadOnly") === "true";

  try {
    const where = {
      userId: session.user.id,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.notification.count({ where: { userId: session.user.id } }),
      prisma.notification.count({ where: { userId: session.user.id, isRead: false } }),
    ]);

    return NextResponse.json({ notifications, total, unreadCount });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ error: "Gagal mengambil notifikasi" }, { status: 500 });
  }
}

/**
 * PATCH /api/notifications
 * Mark all notifications as read for the current user.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.notification.updateMany({
      where: { userId: session.user.id, isRead: false },
      data: { isRead: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return NextResponse.json({ error: "Gagal memproses" }, { status: 500 });
  }
}
