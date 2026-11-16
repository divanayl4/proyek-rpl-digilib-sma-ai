import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageEbooks } from "@/lib/config/ebook";
import {
  READING_ACTIVITY_CONFIG,
  validateReadingPage,
} from "@/lib/config/reading";
import {
  EBOOK_DENIAL_MESSAGE,
  getEbookAccessDecision,
} from "@/lib/ebook-access";
import {
  allowReadingActivityRequest,
  recordEbookReadingActivity,
  type ReadingActivityEvent,
} from "@/lib/ebook-reading";

export const dynamic = "force-dynamic";

const EVENTS: ReadonlySet<string> = new Set(["open", "heartbeat", "close"]);

/**
 * POST /api/ebooks/[id]/activity
 *
 * Mencatat pembukaan/aktivitas/penutupan sesi baca. Identitas selalu diambil
 * dari sesi NextAuth di server; body tidak pernah boleh menentukan userId.
 *
 * Halaman/progres bersifat opsional. Reader PDF bawaan browser tidak
 * mengekspos halaman aktif, jadi UI normal tidak mengirim field ini. Bila
 * suatu klien mengirimkannya, nilainya divalidasi terhadap Book.pageCount dan
 * progres dihitung/dikurung ke 0-100.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const bookId = params.id;
  const now = new Date();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const event = payload.event;
  if (typeof event !== "string" || !EVENTS.has(event)) {
    return NextResponse.json(
      { error: "event harus open, heartbeat, atau close" },
      { status: 400 }
    );
  }

  if (!allowReadingActivityRequest(userId, bookId, now)) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan aktivitas" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // Untuk close, akses yang sudah kedaluwarsa tetap boleh menutup sesi milik
  // sendiri. Tidak ada aktivitas baru yang dicatat.
  if (event === "close") {
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: { id: true, format: true },
    });
    if (!book || book.format !== "EBOOK") {
      return NextResponse.json({ error: "Ebook tidak ditemukan" }, { status: 404 });
    }

    const result = await recordEbookReadingActivity({
      userId,
      bookId,
      event: event as ReadingActivityEvent,
      now,
    });
    return NextResponse.json({
      ok: true,
      event,
      sessionId: result.sessionId || null,
      status: result.status,
      created: result.created,
      closed: result.closed,
      pageTrackingSupported: READING_ACTIVITY_CONFIG.pageTrackingSupported,
    });
  }

  const decision = await getEbookAccessDecision(userId, bookId, now, {
    operator: canManageEbooks(session.user.role),
  });

  if (!decision.ok) {
    return NextResponse.json(
      {
        error: decision.reason
          ? EBOOK_DENIAL_MESSAGE[decision.reason]
          : "Akses ebook ditolak",
        accessState: decision.accessState,
      },
      { status: decision.status }
    );
  }

  const pageValidation = validateReadingPage(
    payload.page,
    decision.book?.pageCount ?? null
  );
  if (!pageValidation.ok) {
    return NextResponse.json(
      { error: pageValidation.error },
      { status: 400 }
    );
  }

  const result = await recordEbookReadingActivity({
    userId,
    bookId,
    event: event as ReadingActivityEvent,
    loanId: decision.loan?.id ?? null,
    page: pageValidation.lastPage,
    progressPercent: pageValidation.progressPercent,
    now,
  });

  return NextResponse.json({
    ok: true,
    event,
    sessionId: result.sessionId,
    status: result.status,
    created: result.created,
    closed: result.closed,
    pageTrackingSupported: READING_ACTIVITY_CONFIG.pageTrackingSupported,
  });
}
