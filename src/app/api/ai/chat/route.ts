import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ChatError, getGreeting, isChatError, processChat } from "@/lib/ai/pipeline";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/chat — titik masuk obrolan AI Assistant.
 *
 * Route ini sengaja tipis: autentikasi sesi di sini, seluruh penentuan
 * jawaban di `processChat()` (src/lib/ai/pipeline.ts) agar mudah diuji.
 */
export async function POST(req: NextRequest) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let userId: string | undefined;
  let stage = "auth";

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Sesi Anda tidak valid. Silakan masuk kembali." }, { status: 401 });
    }
    userId = session.user.id;

    stage = "parse";
    let body: { messages?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
    }

    stage = "processChat";
    const result = await processChat({ userId, messages: body.messages });
    return NextResponse.json(result);
  } catch (error) {
    if (isChatError(error)) {
      const payload: Record<string, unknown> = { error: error.message, requestId };
      if (error.code) payload.code = error.code;
      if (typeof error.retryAfter === "number") payload.retryAfter = error.retryAfter;
      console.error("[AI] Chat request failed (mapped).", {
        requestId,
        userId: userId ?? "anonymous",
        stage,
        status: error.status,
        code: error.code,
        retryAfter: error.retryAfter,
        message: error.message,
      });
      return NextResponse.json(payload, { status: error.status });
    }

    // Detail teknis hanya ke log server. API key tidak pernah dicatat.
    console.error("[AI] Permintaan chat gagal.", {
      requestId,
      userId: userId ?? "anonymous",
      stage,
      detail: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error:
          "Maaf, asisten AI sedang mengalami gangguan. Silakan coba kembali beberapa saat lagi.",
        code: "AI_ERROR",
        requestId,
      },
      { status: 500 }
    );
  }
}

/** Identitas ringan untuk personalisasi sapaan pertama di UI (tanpa panggil model). */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Sesi Anda tidak valid." }, { status: 401 });
    }

    return NextResponse.json({ greeting: await getGreeting(session.user.id) });
  } catch (error) {
    if (isChatError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AI] Gagal memuat identitas pengguna.", error);
    return NextResponse.json({ error: "Terjadi kesalahan." }, { status: 500 });
  }
}

export const maxDuration = 60;
