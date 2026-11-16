import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  EBOOK_OPERATOR_TOKEN_EXPIRES_AT,
  EBOOK_READ_COOKIE,
  canManageEbooks,
  verifyEbookReadToken,
} from "@/lib/config/ebook";
import {
  EBOOK_DENIAL_MESSAGE,
  getEbookAccessDecision,
  readEbookFile,
  resolveEbookFilePath,
} from "@/lib/ebook-access";

export const dynamic = "force-dynamic";

// Bytes are per-user, time-boxed and must never be cached by a shared cache,
// the browser disk cache, or a service worker.
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
  // The viewer embeds the file from the same origin; nothing else may frame it.
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'; sandbox",
  "Content-Disposition": "inline; filename=ebook.pdf",
} as const;

/**
 * GET /api/ebooks/[id]/file
 *
 * The only path that emits ebook bytes. Three independent checks must pass:
 *   1. an authenticated session,
 *   2. a valid short-lived read token bound to *this* user and *this* ebook,
 *   3. a live loan owned by the session user that has not passed expiresAt.
 *
 * Check 3 is re-read from the database on every single request, so replaying a
 * captured URL after the 5-day deadline – with the client clock rewound, the
 * route hand-edited, or the UI lock bypassed – still fails.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const secret = process.env.NEXTAUTH_SECRET ?? "";

  // A verified manager reads through the operator path (no loan). This flag
  // comes from the signed session, so it can never be raised by the client.
  const isOperator = canManageEbooks(session.user.role);

  // Authoritative access check (ownership + expiresAt) before anything else.
  const decision = await getEbookAccessDecision(
    session.user.id,
    params.id,
    new Date(),
    { operator: isOperator }
  );

  if (!decision.ok) {
    return NextResponse.json(
      {
        error: EBOOK_DENIAL_MESSAGE[decision.reason!],
        reason: decision.reason,
        accessState: decision.accessState,
      },
      { status: decision.status, headers: NO_STORE_HEADERS }
    );
  }

  // Operator tokens bind to a sentinel instead of a real loan expiry.
  const tokenBoundExpiry = decision.operator
    ? EBOOK_OPERATOR_TOKEN_EXPIRES_AT
    : decision.loan!.expiresAt;

  // The token may arrive as the query parameter (direct links / API clients)
  // or as the path-scoped HttpOnly cookie the embedded viewer relies on.
  const queryToken = req.nextUrl.searchParams.get("token");
  const cookieToken = req.cookies.get(EBOOK_READ_COOKIE)?.value ?? null;
  const tokenAccepted =
    verifyEbookReadToken(
      queryToken,
      session.user.id,
      params.id,
      tokenBoundExpiry,
      secret
    ) ||
    verifyEbookReadToken(
      cookieToken,
      session.user.id,
      params.id,
      tokenBoundExpiry,
      secret
    );

  if (!tokenAccepted) {
    return NextResponse.json(
      { error: "Token akses tidak valid atau sudah kedaluwarsa", reason: "FORBIDDEN" },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  let absolutePath: string;
  try {
    absolutePath = resolveEbookFilePath(decision.book!.filePath);
  } catch {
    return NextResponse.json(
      { error: "Berkas ebook tidak valid" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const { buffer, size } = await readEbookFile(absolutePath);

    // Range support so the browser's PDF viewer can page through the document.
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : size - 1;

        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start >= 0 &&
          end < size &&
          start <= end
        ) {
          const chunk = buffer.subarray(start, end + 1);
          return new NextResponse(new Uint8Array(chunk), {
            status: 206,
            headers: {
              ...NO_STORE_HEADERS,
              "Content-Type": "application/pdf",
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunk.length),
            },
          });
        }
      }
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "application/pdf",
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
      },
    });
  } catch (error) {
    console.error(`Failed to read ebook file ${params.id}:`, error);
    return NextResponse.json(
      { error: "Berkas ebook tidak dapat dibaca" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
}