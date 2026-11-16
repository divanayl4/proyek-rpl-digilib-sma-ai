"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import EbookCountdown from "./EbookCountdown";
import { EBOOK_CONFIG, canManageEbooks } from "@/lib/config/ebook";
import { READING_ACTIVITY_CONFIG } from "@/lib/config/reading";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Lock,
  Maximize2,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";

interface AccessPayload {
  token: string;
  tokenExpiresAt: string;
  fileUrl: string;
  accessState: string;
  /** True when an Admin/Pustakawan reads via the operator "Lihat Buku" path. */
  operator?: boolean;
  loan: { id: string; borrowedAt: string; expiresAt: string } | null;
  book: { id: string; title: string; author: string; pageCount: number | null };
  remainingMs: number;
}

type Phase = "loading" | "reading" | "locked" | "error";

export default function EbookReaderView({ bookId }: { bookId: string }) {
  const router = useRouter();
  const { data: session } = useSession();

  // Cosmetic gate only; the server's `operator` flag on the access response is
  // what actually distinguishes a manager read from an ordinary loan read.
  const isOperatorRole = canManageEbooks(session?.user?.role);

  const [phase, setPhase] = useState<Phase>("loading");
  const [access, setAccess] = useState<AccessPayload | null>(null);
  /**
   * The viewer URL is captured once per open. It must stay stable: changing the
   * iframe src would reload the document (and lose the reader's page). The
   * short-lived credential is renewed through the HttpOnly cookie that the
   * access endpoint sets, not by swapping this URL.
   */
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  // Prefer the server's authoritative flag; fall back to the session role so
  // the header renders correctly before/if the access payload is absent.
  const isOperatorView = access?.operator === true || (access === null && isOperatorRole);

  /**
   * Fire-and-forget activity signal. Never blocks reading and never sends
   * userId/page/progress from the browser. The server re-checks access before
   * recording anything. Native browser PDF viewer does not expose the active
   * page, so no page/progress fields are ever included here.
   */
  const sendActivity = useCallback(
    (event: "open" | "heartbeat" | "close", keepalive = false) => {
      const body = JSON.stringify({ event });
      if (event === "close" && typeof navigator !== "undefined" && navigator.sendBeacon) {
        try {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon(`/api/ebooks/${bookId}/activity`, blob);
          return;
        } catch {
          // Fall through to fetch keepalive.
        }
      }
      void fetch(`/api/ebooks/${bookId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive,
      }).catch(() => undefined);
    },
    [bookId]
  );

  /**
   * Ask the server whether reading is allowed. This is the only authority –
   * the document is never rendered from a client-side assumption.
   */
  const loadAccess = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch(`/api/ebooks/${bookId}/access`, { method: "POST" });

      if (res.ok) {
        const data: AccessPayload = await res.json();
        setAccess(data);
        setFileUrl(data.fileUrl);
        setPhase("reading");
        // Record the successful opening once access is confirmed. If the user
        // reloads, the server reuses the same open session instead of creating
        // a duplicate.
        sendActivity("open");
        return;
      }

      const data = await res.json().catch(() => ({}));
      setMessage(data.error || "Tidak dapat membuka ebook");
      setAccess(null);
      setFileUrl(null);
      setPhase(res.status === 410 || res.status === 403 ? "locked" : "error");
    } catch {
      setMessage("Terjadi kesalahan jaringan");
      setPhase("error");
    }
  }, [bookId, sendActivity]);

  /**
   * Renew the read credential without touching the viewer URL. The server
   * returns 410/403 the moment the window closes, which is what actually locks
   * the document.
   */
  const refreshAccess = useCallback(async () => {
    try {
      const res = await fetch(`/api/ebooks/${bookId}/access`, { method: "POST" });
      if (res.ok) {
        const data: AccessPayload = await res.json();
        setAccess(data);
        return;
      }
      setAccess(null);
      setFileUrl(null);
      setPhase("locked");
      sendActivity("close", true);
    } catch {
      // Transient network hiccup – keep the current document, retry next tick.
    }
  }, [bookId, sendActivity]);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  /**
   * The read token is short-lived by design. While the loan is still active we
   * silently refresh it (at half its lifetime, so it never lapses between
   * ticks) and refresh immediately when the tab becomes visible again.
   */
  useEffect(() => {
    if (phase !== "reading") return;

    const intervalMs = (EBOOK_CONFIG.readTokenTtlSeconds * 1000) / 2;
    const interval = setInterval(refreshAccess, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAccess();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, refreshAccess]);

  /**
   * Heartbeat hanya dikirim saat tab terlihat. Ini mencatat "reader masih
   * terbuka/aktif", BUKAN bukti membaca setiap detik. Semua heartbeat
   * memperbarui sesi yang sama (tidak membuat baris/transaksi baru).
   */
  useEffect(() => {
    if (phase !== "reading") return;

    const tick = () => {
      if (document.visibilityState === "visible") sendActivity("heartbeat");
    };
    const interval = setInterval(
      tick,
      READING_ACTIVITY_CONFIG.heartbeatSeconds * 1000
    );

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        sendActivity("heartbeat");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Best-effort close saat halaman benar-benar ditinggalkan. Bila browser
    // tidak mengirimnya, batas idle 30 menit tetap membuat sesi INACTIVE.
    const onPageHide = () => sendActivity("close", true);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [phase, sendActivity]);

  // Client-side lock the instant the countdown hits zero, then confirm with the
  // server. The server response is what actually removes access to the bytes.
  const handleExpire = useCallback(() => {
    setAccess(null);
    setPhase("locked");
    setMessage("Masa akses ebook telah habis.");
    sendActivity("close", true);
    loadAccess();
  }, [loadAccess, sendActivity]);

  const handleReturn = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ebooks/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfirmingFinish(false);
        sendActivity("close", true);
        router.push(isOperatorView ? "/ebooks" : "/ebooks/saya");
      } else {
        setMessage(data.error || "Gagal mengembalikan ebook");
      }
    } catch {
      setMessage("Terjadi kesalahan jaringan");
    } finally {
      setBusy(false);
    }
  };

  const handleFullscreen = () => {
    frameRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <button
            onClick={() => (isOperatorView ? router.push("/ebooks") : router.back())}
            className="back-link"
          >
            <ArrowLeft size={18} /> {isOperatorView ? "Kembali ke Katalog" : "Kembali"}
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={handleFullscreen} title="Layar penuh" aria-label="Buka layar penuh">
              <Maximize2 size={16} />
            </Button>
            <Button variant="ghost" size="sm" onClick={loadAccess} title="Muat ulang" aria-label="Muat ulang ebook">
              <RefreshCw size={16} />
            </Button>
            {!isOperatorView && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || phase !== "reading"}
                onClick={() => setConfirmingFinish(true)}
              >
                <CheckCircle2 size={16} /> Selesaikan Membaca
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-main line-clamp-1">
              {access?.book.title ?? "Ebook"}
            </h1>
            {access?.book.author && (
              <p className="text-sm text-muted">{access.book.author}</p>
            )}
          </div>

          {phase === "reading" && access && (
            <div className="flex items-center gap-3">
              {isOperatorView ? (
                <Badge variant="info">Mode Baca Pengelola</Badge>
              ) : (
                <>
                  <Badge variant="success">Aktif</Badge>
                  {access.loan && (
                    <EbookCountdown
                      expiresAt={access.loan.expiresAt}
                      onExpire={handleExpire}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {phase === "reading" && access && !isOperatorView && access.loan && (
          <p className="text-xs text-muted">
            Masa akses berakhir{" "}
            {new Date(access.loan.expiresAt).toLocaleString("id-ID", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Ebook akan terkunci otomatis setelah waktu tersebut.
          </p>
        )}

        {phase === "reading" && access && isOperatorView && (
          <p className="text-xs text-muted">
            Anda melihat isi ebook sebagai pengelola. Membaca di sini tidak
            membuat transaksi peminjaman dan tidak mengubah masa akses pengguna.
          </p>
        )}
      </div>

      {phase === "reading" && !isOperatorView && confirmingFinish && (
        <div
          className="flex flex-col gap-3 p-4 rounded-xl border border-border"
          style={{ backgroundColor: "var(--color-warning-bg)" }}
        >
          <p className="text-sm font-medium text-main">
            Selesaikan membaca ebook ini sekarang?
          </p>
          <p className="text-xs text-muted">
            Akses membaca akan ditutup dan slot peminjaman dikembalikan. Kamu
            tetap dapat meminjamnya lagi selama kuota periode berjalan masih
            tersedia.
          </p>
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy} onClick={handleReturn}>
              <CheckCircle2 size={16} /> Ya, Selesaikan
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmingFinish(false)}
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden min-w-0">
        {phase === "loading" && (
          <LoadingState message="Memeriksa hak akses..." />
        )}

        {phase === "reading" && access && fileUrl && (
          <iframe
            ref={frameRef}
            src={fileUrl}
            title={access.book.title}
            className="ebook-frame"
          />
        )}

        {phase === "locked" && (
          <div className="flex flex-col items-center justify-center text-center p-12">
            <div className="w-16 h-16 rounded-full bg-danger-bg text-danger flex items-center justify-center mb-4">
              <Lock size={30} />
            </div>
            <h2 className="text-xl font-bold text-main mb-1">Ebook Terkunci</h2>
            <p className="text-sm text-muted max-w-md mb-6">
              {message ||
                "Masa akses 5 hari Anda telah habis. Ebook tidak dapat dibaca lagi sampai dipinjam ulang."}
            </p>
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <Button onClick={() => router.push("/ebooks")}>Kembali ke Katalog</Button>
              {!isOperatorView && (
                <Button variant="secondary" disabled={busy} onClick={handleReturn}>
                  <RotateCcw size={16} /> Kembalikan Akses
                </Button>
              )}
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="p-6 flex flex-col gap-4">
            <ErrorState
              title="Gagal membuka ebook"
              message={message}
              onRetry={loadAccess}
            />
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => router.push("/ebooks")}>
                Kembali ke Katalog
              </Button>
            </div>
          </div>
        )}
      </div>

      {phase === "locked" && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-warning-bg text-warning">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <p className="text-xs">
            Penguncian dilakukan oleh server. Bahkan jika jam browser diubah,
            URL diedit, atau dibuka di tab lain, akses tetap ditolak selama
            masa akses habis.
          </p>
        </div>
      )}

      {phase === "reading" && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <BookOpen size={13} />
          Dokumen disajikan melalui viewer bawaan browser. Materi tidak dapat diunduh
          atau disalin dari tautan ini. Viewer ini tidak melaporkan nomor halaman,
          sehingga halaman/progres membaca tidak dicatat.
        </p>
      )}
    </div>
  );
}