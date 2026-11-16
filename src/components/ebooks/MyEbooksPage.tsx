"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import EbookCountdown from "./EbookCountdown";
import { EbookStatusBadge } from "./EbookCard";
import { EBOOK_CONFIG, canBorrowEbook } from "@/lib/config/ebook";
import {
  BookOpen,
  Calendar,
  CheckCircle,
  Clock,
  FileText,
  History,
  Lock,
  PlayCircle,
  RotateCcw,
} from "lucide-react";

interface ReadingProgress {
  found: boolean;
  lastPage: number | null;
  progressPercent: number | null;
  lastActivityAt: string | null;
}

type AccessState = "ACTIVE" | "EXPIRED" | "RETURNED" | "NOT_BORROWED";

interface LoanRow {
  /** EbookLoan id – what the return endpoint expects. */
  id: string;
  borrowedAt: string;
  expiresAt: string;
  returnedAt: string | null;
  accessState: AccessState;
  remainingMs: number;
  book: {
    id: string;
    title: string;
    author: string;
    coverUrl: string | null;
    pageCount: number | null;
    format: string;
    category: { id: string; name: string } | null;
  };
}

const SCOPE_OPTIONS = [
  { value: "current", label: "Sedang Dipinjam" },
  { value: "history", label: "Riwayat" },
  { value: "all", label: "Semua" },
];

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function MyEbooksPage() {
  const router = useRouter();
  const { data: session } = useSession();

  // Admin dan Pustakawan tidak meminjam sebagai pengguna biasa.
  const viewerCanBorrow = canBorrowEbook(session?.user?.role);

  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState("current");
  const [summary, setSummary] = useState({
    active: 0,
    expired: 0,
    total: 0,
    accessDurationDays: EBOOK_CONFIG.accessDurationDays,
  });

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchLoans = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "10",
        scope,
      });
      const res = await fetch(`/api/ebooks/loans?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLoans(data.loans);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setSummary(data.summary);
      }
    } catch {
      // keep the previous view on a transient failure
    } finally {
      setLoading(false);
    }
  }, [page, scope]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  const handleReturn = async (loan: LoanRow) => {
    setBusyId(loan.id);
    setFeedback(null);
    try {
      const res = await fetch("/api/ebooks/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loanId: loan.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({
          type: "success",
          message: `Ebook "${loan.book.title}" telah dikembalikan.`,
        });
      } else {
        setFeedback({
          type: "error",
          message: data.error || "Gagal mengembalikan ebook",
        });
      }
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan" });
    } finally {
      setBusyId(null);
      fetchLoans();
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading">Ebook Saya</h1>
          <p className="page-description">
            Masa akses setiap ebook adalah {summary.accessDurationDays} hari sejak dipinjam
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => router.push("/ebooks")}>
            <FileText size={16} /> Katalog Ebook
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-card__icon icon-tile--green" aria-hidden="true">
            <BookOpen size={20} />
          </div>
          <div className="min-w-0">
            <p className="stat-card__label">Aktif</p>
            <p className="stat-card__value">{summary.active}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon icon-tile--danger" aria-hidden="true">
            <Lock size={20} />
          </div>
          <div className="min-w-0">
            <p className="stat-card__label">Kedaluwarsa</p>
            <p className="stat-card__value">{summary.expired}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon icon-tile--blue" aria-hidden="true">
            <History size={20} />
          </div>
          <div className="min-w-0">
            <p className="stat-card__label">Total Riwayat</p>
            <p className="stat-card__value">{summary.total}</p>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className="flex items-center gap-2 p-3 rounded-xl text-sm"
          style={{
            backgroundColor:
              feedback.type === "success"
                ? "var(--color-success-bg)"
                : "var(--color-danger-bg)",
            color:
              feedback.type === "success"
                ? "var(--color-success-text)"
                : "var(--color-danger-text)",
          }}
        >
          {feedback.type === "success" ? (
            <CheckCircle size={16} />
          ) : (
            <Lock size={16} />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div>
              <CardTitle>Daftar Peminjaman Ebook</CardTitle>
              <CardDescription>{total} peminjaman</CardDescription>
            </div>
            <Select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setPage(1);
              }}
              style={{ width: "180px" }}
            >
              {SCOPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <LoadingState message="Memuat ebook Anda..." />
          ) : loans.length === 0 ? (
            <EmptyState
              title="Belum ada ebook"
              description="Anda belum meminjam ebook apa pun. Jelajahi katalog untuk memulai."
              icon={<FileText size={32} />}
              action={
                <Button onClick={() => router.push("/ebooks")}>Jelajahi Katalog</Button>
              }
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {loans.map((loan) => (
                <LoanRowCard
                  key={loan.id}
                  loan={loan}
                  isBusy={busyId === loan.id}
                  canBorrowRole={viewerCanBorrow}
                  onReturn={handleReturn}
                  onOpenReader={(bookId) => router.push(`/ebooks/${bookId}/baca`)}
                  onBrowse={() => router.push("/ebooks")}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}

function LoanRowCard({
  loan,
  isBusy,
  canBorrowRole,
  onReturn,
  onOpenReader,
  onBrowse,
}: {
  loan: LoanRow;
  isBusy: boolean;
  canBorrowRole: boolean;
  onReturn: (loan: LoanRow) => void;
  onOpenReader: (bookId: string) => void;
  onBrowse: () => void;
}) {
  const isActive = loan.accessState === "ACTIVE";
  const isExpired = loan.accessState === "EXPIRED";
  const isReturned = loan.accessState === "RETURNED";

  // Fetch reading progress for active loans
  const [progress, setProgress] = useState<ReadingProgress | null>(null);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    fetch(`/api/ebooks/${loan.book.id}/progress`)
      .then((r) => r.json())
      .then((data: ReadingProgress) => {
        if (!cancelled) setProgress(data);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isActive, loan.book.id]);

  const hasProgress = progress?.found && progress.lastPage && progress.lastPage > 0;

  return (
    <div
      className="card"
      style={{
        borderLeft: `4px solid ${
          isActive
            ? "var(--color-success-text)"
            : isExpired
            ? "var(--color-danger-text)"
            : "var(--color-border)"
        }`,
      }}
    >
      <div
        className="card-body"
        style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}
      >
        {loan.book.coverUrl ? (
          <Image
            src={loan.book.coverUrl}
            alt={loan.book.title}
            width={56}
            height={80}
            style={{ objectFit: "cover", borderRadius: "6px", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: "56px",
              height: "80px",
              borderRadius: "6px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            className="bg-primary-50"
          >
            <FileText size={24} className="text-primary" />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <p className="font-semibold text-main line-clamp-1">{loan.book.title}</p>
              <p className="text-sm text-muted">{loan.book.author}</p>
            </div>
            <EbookStatusBadge accessState={loan.accessState} />
          </div>

          <div
            style={{
              display: "flex",
              gap: "1.5rem",
              marginTop: "0.75rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Calendar size={13} className="text-muted" />
              <span className="text-xs text-muted">
                Dipinjam: {formatDate(loan.borrowedAt)}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Clock size={13} className={isExpired ? "text-danger" : "text-muted"} />
              <span className="text-xs text-muted">
                Berakhir: {formatDate(loan.expiresAt)}
              </span>
            </div>

            {isActive && <EbookCountdown expiresAt={loan.expiresAt} />}

            {loan.returnedAt && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <CheckCircle size={13} className="text-success" />
                <span className="text-xs text-muted">
                  Dikembalikan: {formatDate(loan.returnedAt)}
                </span>
              </div>
            )}
          </div>

          {isExpired && (
            <div
              className="flex items-center gap-2 mt-2 p-2 rounded-lg"
              style={{ backgroundColor: "var(--color-danger-bg)" }}
            >
              <Lock
                size={13}
                style={{ color: "var(--color-danger-text)", flexShrink: 0 }}
              />
              <p className="text-xs" style={{ color: "var(--color-danger-text)" }}>
                Masa akses {EBOOK_CONFIG.accessDurationDays} hari telah habis. Ebook
                terkunci – kembalikan untuk dapat meminjam kembali.
              </p>
            </div>
          )}

          <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {/* Reading progress display (active loans with tracked progress) */}
            {isActive && hasProgress && progress && (
              <div
                className="flex flex-col gap-1 p-2 rounded-lg"
                style={{ backgroundColor: "var(--color-bg-secondary)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    Terakhir dibaca: halaman {progress.lastPage}
                    {loan.book.pageCount ? ` dari ${loan.book.pageCount}` : ""}
                  </p>
                  {progress.progressPercent !== null && (
                    <span
                      className="text-xs font-semibold"
                      style={{ color: "var(--color-primary)" }}
                    >
                      {Math.round(progress.progressPercent)}%
                    </span>
                  )}
                </div>
                {progress.progressPercent !== null && (
                  <div
                    className="w-full rounded-full overflow-hidden"
                    style={{ height: "4px", backgroundColor: "var(--color-border)" }}
                  >
                    <div
                      className="rounded-full"
                      style={{
                        width: `${Math.round(progress.progressPercent)}%`,
                        height: "100%",
                        backgroundColor: "var(--color-primary)",
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            {!canBorrowRole ? (
              <p className="text-xs text-muted">
                Peminjaman ebook hanya untuk Siswa dan Guru.
              </p>
            ) : isActive ? (
              <Button size="sm" onClick={() => onOpenReader(loan.book.id)}>
                {hasProgress ? (
                  <><PlayCircle size={14} /> Lanjutkan Membaca</>
                ) : (
                  <><BookOpen size={14} /> Mulai Membaca</>
                )}
              </Button>
            ) : isExpired ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={isBusy}
                onClick={() => onReturn(loan)}
              >
                <RotateCcw size={14} /> {isBusy ? "Memproses..." : "Kembalikan Ebook"}
              </Button>
            ) : isReturned ? (
              <Button size="sm" variant="secondary" onClick={onBrowse}>
                Pinjam Lagi
              </Button>
            ) : (
              <Badge variant="default">Belum Dipinjam</Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}