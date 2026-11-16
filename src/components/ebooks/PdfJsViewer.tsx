"use client";

/**
 * PdfJsViewer — Reader PDF berbasis PDF.js yang mencatat halaman aktif.
 *
 * Komponen ini berjalan murni di sisi klien. PDF.js (v3.11) di-load dari
 * cdnjs agar tidak perlu mengkonfigurasi worker path di Next.js; file worker
 * bertanda `type: "module"` dihindari agar kompatibel dengan iframe.
 *
 * Alur:
 *  1. Ambil access token dari /api/ebooks/[id]/access.
 *  2. Baca byte PDF via /api/ebooks/[id]/file (dengan token di header cookie).
 *  3. Render halaman satu per satu ke <canvas> dalam kontainer dengan overflow-y: auto.
 *  4. IntersectionObserver menentukan halaman yang paling dominan di layar →
 *     currentPage. Setiap perubahan halaman dikirim ke /api/ebooks/[id]/activity.
 *  5. Heartbeat tetap berjalan setiap 60 detik (via sendActivity bawaan).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
  ChevronLeft,
  ChevronRight,
  Lock,
  Maximize2,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  Minus,
  Plus,
} from "lucide-react";

interface AccessPayload {
  token: string;
  tokenExpiresAt: string;
  fileUrl: string;
  accessState: string;
  operator?: boolean;
  loan: { id: string; borrowedAt: string; expiresAt: string } | null;
  book: { id: string; title: string; author: string; pageCount: number | null };
  remainingMs: number;
}

type Phase = "loading" | "reading" | "locked" | "error";

// PDF.js types (subset)
interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (ctx: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => void;
}

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

const PDFJS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

async function loadPdfJs(): Promise<typeof window.pdfjsLib> {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDFJS_CDN;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
  return window.pdfjsLib;
}

export default function PdfJsViewer({ bookId }: { bookId: string }) {
  const router = useRouter();
  const { data: session } = useSession();

  const isOperatorRole = canManageEbooks(session?.user?.role);

  const [phase, setPhase] = useState<Phase>("loading");
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);

  // PDF rendering state
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<PdfDocument | null>(null);
  const pageVisibilityMap = useRef<Map<number, number>>(new Map());
  const lastReportedPage = useRef<number>(0);
  const loanIdRef = useRef<string | null>(null);
  const accessRef = useRef<AccessPayload | null>(null);

  const isOperatorView =
    access?.operator === true || (access === null && isOperatorRole);

  // ─── Activity reporting ───────────────────────────────────────────────────

  const sendActivity = useCallback(
    (event: "open" | "heartbeat" | "close", page?: number, keepalive = false) => {
      const bodyObj: Record<string, unknown> = { event };
      if (page !== undefined && page > 0) bodyObj.page = page;

      if (event === "close" && typeof navigator !== "undefined" && navigator.sendBeacon) {
        try {
          const blob = new Blob([JSON.stringify({ event })], {
            type: "application/json",
          });
          navigator.sendBeacon(`/api/ebooks/${bookId}/activity`, blob);
          return;
        } catch {
          // fall through
        }
      }
      void fetch(`/api/ebooks/${bookId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
        keepalive,
      }).catch(() => undefined);
    },
    [bookId]
  );

  // Report page change (debounced to avoid flooding the API on fast scroll)
  const reportPageTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportPage = useCallback(
    (page: number) => {
      if (page <= 0 || page === lastReportedPage.current) return;
      lastReportedPage.current = page;
      if (reportPageTimeout.current) clearTimeout(reportPageTimeout.current);
      reportPageTimeout.current = setTimeout(() => {
        sendActivity("heartbeat", page);
      }, 800); // debounce 800ms
    },
    [sendActivity]
  );

  // ─── Access check ─────────────────────────────────────────────────────────

  const loadAccess = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch(`/api/ebooks/${bookId}/access`, { method: "POST" });
      if (res.ok) {
        const data: AccessPayload = await res.json();
        setAccess(data);
        accessRef.current = data;
        loanIdRef.current = data.loan?.id ?? null;
        setPhase("reading");
        sendActivity("open");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setMessage(data.error || "Tidak dapat membuka ebook");
      setAccess(null);
      setPhase(res.status === 410 || res.status === 403 ? "locked" : "error");
    } catch {
      setMessage("Terjadi kesalahan jaringan");
      setPhase("error");
    }
  }, [bookId, sendActivity]);

  const refreshAccess = useCallback(async () => {
    try {
      const res = await fetch(`/api/ebooks/${bookId}/access`, { method: "POST" });
      if (res.ok) {
        const data: AccessPayload = await res.json();
        setAccess(data);
        accessRef.current = data;
        return;
      }
      setAccess(null);
      setPhase("locked");
      sendActivity("close", undefined, true);
    } catch {
      // transient
    }
  }, [bookId, sendActivity]);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  // Token refresh
  useEffect(() => {
    if (phase !== "reading") return;
    const intervalMs = (EBOOK_CONFIG.readTokenTtlSeconds * 1000) / 2;
    const iv = setInterval(refreshAccess, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAccess();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, refreshAccess]);

  // Heartbeat
  useEffect(() => {
    if (phase !== "reading") return;
    const tick = () => {
      if (document.visibilityState === "visible") {
        sendActivity("heartbeat", lastReportedPage.current || undefined);
      }
    };
    const iv = setInterval(tick, READING_ACTIVITY_CONFIG.heartbeatSeconds * 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    const onHide = () => sendActivity("close", lastReportedPage.current || undefined, true);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [phase, sendActivity]);

  // ─── PDF Rendering ────────────────────────────────────────────────────────

  const renderAllPages = useCallback(
    async (doc: PdfDocument, initialPage: number, scaleVal: number) => {
      const container = containerRef.current;
      if (!container) return;

      // Clear previous pages
      container.innerHTML = "";
      pageVisibilityMap.current.clear();

      const canvases: HTMLCanvasElement[] = [];

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: scaleVal });

        const wrapper = document.createElement("div");
        wrapper.dataset.page = String(i);
        wrapper.style.cssText = `
          margin: 0 auto 8px auto;
          display: block;
          width: ${viewport.width}px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
          border-radius: 4px;
          overflow: hidden;
          background: #fff;
        `;

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.display = "block";

        wrapper.appendChild(canvas);
        container.appendChild(wrapper);
        canvases.push(canvas);

        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
      }

      // Setup IntersectionObserver to detect the most visible page
      const pageWrappers = container.querySelectorAll<HTMLDivElement>("[data-page]");
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const pg = Number((entry.target as HTMLDivElement).dataset.page);
            if (pg) pageVisibilityMap.current.set(pg, entry.intersectionRatio);
          });
          // Find page with highest visibility ratio
          let best = 1;
          let bestRatio = 0;
          pageVisibilityMap.current.forEach((ratio, pg) => {
            if (ratio > bestRatio) {
              bestRatio = ratio;
              best = pg;
            }
          });
          setCurrentPage(best);
          reportPage(best);
        },
        { root: container, threshold: Array.from({ length: 21 }, (_, i) => i / 20) }
      );

      pageWrappers.forEach((w) => obs.observe(w));

      // Scroll to initial page
      if (initialPage > 1 && initialPage <= doc.numPages) {
        const targetWrapper = container.querySelector<HTMLDivElement>(
          `[data-page="${initialPage}"]`
        );
        if (targetWrapper) {
          targetWrapper.scrollIntoView({ block: "start" });
        }
      }

      return () => obs.disconnect();
    },
    [reportPage]
  );

  // Fetch and render PDF
  const loadAndRenderPdf = useCallback(
    async (fileUrl: string, initialPage: number, scaleVal: number) => {
      setPdfLoading(true);
      setPdfError("");
      try {
        const pdfjs = await loadPdfJs();
        // Fetch the file bytes through the authorized endpoint
        const resp = await fetch(fileUrl, { credentials: "include" });
        if (!resp.ok) {
          setPdfError("Gagal mengambil file ebook. Coba muat ulang.");
          return;
        }
        const arrayBuffer = await resp.arrayBuffer();

        // Destroy previous doc
        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }

        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
        const doc: PdfDocument = await loadingTask.promise;
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setCurrentPage(initialPage > 0 ? initialPage : 1);
        lastReportedPage.current = initialPage > 0 ? initialPage : 1;

        await renderAllPages(doc, initialPage, scaleVal);
      } catch (err) {
        console.error("PDF.js error:", err);
        setPdfError("Gagal merender ebook. Pastikan koneksi stabil lalu muat ulang.");
      } finally {
        setPdfLoading(false);
      }
    },
    [renderAllPages]
  );

  // Load PDF when entering reading phase
  useEffect(() => {
    if (phase !== "reading" || !access) return;

    // Fetch initial reading progress (last page)
    const init = async () => {
      let initialPage = 1;
      try {
        const progRes = await fetch(`/api/ebooks/${bookId}/progress`);
        if (progRes.ok) {
          const progData = await progRes.json();
          if (progData.found && progData.lastPage && progData.lastPage > 0) {
            initialPage = progData.lastPage;
          }
        }
      } catch {
        // ignore progress fetch failures
      }
      await loadAndRenderPdf(access.fileUrl, initialPage, scale);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, access?.fileUrl]);

  // Re-render when scale changes (access already loaded)
  const scaleChangeRef = useRef(false);
  useEffect(() => {
    if (!scaleChangeRef.current) {
      scaleChangeRef.current = true;
      return;
    }
    if (phase !== "reading" || !access || !pdfDocRef.current) return;
    renderAllPages(pdfDocRef.current, currentPage, scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
      if (reportPageTimeout.current) clearTimeout(reportPageTimeout.current);
    };
  }, []);

  // ─── Navigation helpers ───────────────────────────────────────────────────

  const goToPage = useCallback(
    (page: number) => {
      if (!containerRef.current) return;
      const target = containerRef.current.querySelector<HTMLDivElement>(
        `[data-page="${page}"]`
      );
      if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    []
  );

  const handleExpire = useCallback(() => {
    setAccess(null);
    setPhase("locked");
    setMessage("Masa akses ebook telah habis.");
    sendActivity("close", lastReportedPage.current || undefined, true);
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
        sendActivity("close", lastReportedPage.current || undefined, true);
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
    containerRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const progressPct =
    numPages > 0 ? Math.round((currentPage / numPages) * 100) : 0;

  // ─── Render ───────────────────────────────────────────────────────────────

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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))}
              title="Perkecil"
              aria-label="Perkecil tampilan"
              disabled={phase !== "reading" || pdfLoading}
            >
              <Minus size={16} />
            </Button>
            <span className="text-xs text-muted w-12 text-center">{Math.round(scale * 100)}%</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setScale((s) => Math.min(3, +(s + 0.25).toFixed(2)))}
              title="Perbesar"
              aria-label="Perbesar tampilan"
              disabled={phase !== "reading" || pdfLoading}
            >
              <Plus size={16} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFullscreen}
              title="Layar penuh"
              aria-label="Buka layar penuh"
            >
              <Maximize2 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadAccess}
              title="Muat ulang"
              aria-label="Muat ulang ebook"
            >
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

        {phase === "reading" && access && (
          <>
            {/* Page navigation bar */}
            {numPages > 0 && (
              <div
                className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border"
                style={{ backgroundColor: "var(--color-bg-secondary)" }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => goToPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1 || pdfLoading}
                  aria-label="Halaman sebelumnya"
                >
                  <ChevronLeft size={16} />
                </Button>
                <span className="text-xs text-muted text-center">
                  Halaman {currentPage} dari {numPages}
                  {progressPct > 0 && (
                    <span className="ml-2 font-medium" style={{ color: "var(--color-primary)" }}>
                      ({progressPct}%)
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => goToPage(Math.min(numPages, currentPage + 1))}
                  disabled={currentPage >= numPages || pdfLoading}
                  aria-label="Halaman berikutnya"
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            )}

            {pdfLoading && <LoadingState message="Memuat halaman ebook..." />}
            {pdfError && (
              <ErrorState title="Gagal memuat PDF" message={pdfError} onRetry={loadAccess} />
            )}

            {/* PDF canvas container */}
            <div
              ref={containerRef}
              id="pdf-page-container"
              style={{
                height: "75vh",
                overflowY: "auto",
                overflowX: "auto",
                padding: "16px",
                backgroundColor: "#6b7280",
                display: pdfLoading ? "none" : "block",
              }}
            />
          </>
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

      {phase === "reading" && numPages > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <BookOpen size={13} />
          Dokumen dirender melalui PDF.js. Halaman dan progres membaca dicatat
          secara otomatis. Materi tidak dapat diunduh dari tautan ini.
        </p>
      )}
    </div>
  );
}
