import { prisma } from "@/lib/prisma";
import { processEbookExpiryNotifications, processEbookExpiryReminders } from "@/lib/notifications";

const THROTTLE_MS = 5 * 60 * 1000; // at most once every 5 minutes
const LAST_RUN_KEY = "ebook.scheduler.lastRunAt";

let running = false;

/**
 * Deterministic, self-throttling scheduler for e-book expiry + pre-expiry reminder.
 * Safe to call repeatedly (idempotent). Returns a summary; never throws.
 */
export async function runEbookExpiryScheduler(): Promise<{
  skipped: boolean;
  expired: number;
  reminded: number;
  reason?: string;
}> {
  // In-process mutex to prevent overlapping runs within the same process.
  if (running) {
    return { skipped: true, expired: 0, reminded: 0, reason: "already-running" };
  }

  try {
    running = true;

    const lastRow = await prisma.setting.findUnique({ where: { key: LAST_RUN_KEY } });
    const lastTime = lastRow?.value ? new Date(lastRow.value).getTime() : 0;
    if (Number.isFinite(lastTime) && Date.now() - lastTime < THROTTLE_MS) {
      return { skipped: true, expired: 0, reminded: 0, reason: "throttled" };
    }

    // Mark start time (best-effort) to avoid concurrent runs across processes.
    await prisma.setting.upsert({
      where: { key: LAST_RUN_KEY },
      update: { value: new Date().toISOString() },
      create: { key: LAST_RUN_KEY, value: new Date().toISOString() },
    });

    const expired = await processEbookExpiryNotifications();
    const reminded = await processEbookExpiryReminders();

    return { skipped: false, expired, reminded };
  } catch (error) {
    console.error("Ebook expiry scheduler failed:", error);
    return { skipped: false, expired: 0, reminded: 0, reason: "error" };
  } finally {
    running = false;
  }
}
