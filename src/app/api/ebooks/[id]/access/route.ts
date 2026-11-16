import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  EBOOK_CONFIG,
  EBOOK_OPERATOR_TOKEN_EXPIRES_AT,
  EBOOK_READ_COOKIE,
  canManageEbooks,
  getEbookReadCookieOptions,
  signEbookReadToken,
} from "@/lib/config/ebook";
import { EBOOK_DENIAL_MESSAGE, getEbookAccessDecision } from "@/lib/ebook-access";

export const dynamic = "force-dynamic";

/**
 * POST /api/ebooks/[id]/access
 *
 * Short-lived read token for the embedded viewer. Refused with the same
 * decision that guards the bytes themselves, so an expired loan never even
 * receives a token to embed.
 *
 * The token is also written to a short-lived, path-scoped HttpOnly cookie so
 * the viewer can keep using a stable URL (no reload every TTL) while the
 * background refresh renews the credential.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A verified manager (Admin/Pustakawan) reads through the operator path:
  // no loan, no transaction, no stock change. Everyone else must own a live
  // loan. The role comes from the signature-protected session, never the body.
  const isOperator = canManageEbooks(session.user.role);

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
      { status: decision.status }
    );
  }

  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (!secret) {
    return NextResponse.json(
      { error: "Konfigurasi server belum lengkap" },
      { status: 500 }
    );
  }

  const now = new Date();
  // Operator tokens are bound to a sentinel instead of a real loan expiry.
  const tokenBoundExpiry = decision.operator
    ? EBOOK_OPERATOR_TOKEN_EXPIRES_AT
    : decision.loan!.expiresAt;

  const token = signEbookReadToken(
    session.user.id,
    params.id,
    tokenBoundExpiry,
    secret,
    now
  );

  const response = NextResponse.json({
    token,
    tokenExpiresAt: new Date(
      now.getTime() + EBOOK_CONFIG.readTokenTtlSeconds * 1000
    ).toISOString(),
    accessState: decision.accessState,
    operator: decision.operator === true,
    loan: decision.loan ?? null,
    book: decision.book,
    remainingMs: decision.remainingMs,
    // The embed target is same-origin and carries the session cookie.
    fileUrl: `/api/ebooks/${params.id}/file?token=${encodeURIComponent(token)}`,
  });

  // The viewer reads the bytes from /file; the cookie keeps that stable URL
  // authorised between refreshes without ever exposing the token to JS.
  response.cookies.set(
    EBOOK_READ_COOKIE,
    token,
    getEbookReadCookieOptions(params.id, req.nextUrl.protocol === "https:")
  );

  return response;
}