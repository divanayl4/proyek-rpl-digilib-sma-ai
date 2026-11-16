"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import BorrowDetailModal from "@/components/borrows/BorrowDetailModal";
import { BookOpen, Calendar, Clock, AlertTriangle, CheckCircle, Eye } from "lucide-react";

interface BorrowRecord {
  id: string;
  borrowDate: string;
  dueDate: string;
  returnDate: string | null;
  status: string;
  effectiveStatus: string;
  book: {
    id: string;
    title: string;
    author: string;
    isbn: string | null;
    coverUrl: string | null;
  };
}

const STATUS_OPTIONS = [
  { value: "", label: "Semua" },
  { value: "REQUESTED", label: "Menunggu Persetujuan" },
  { value: "BORROWED", label: "Sedang Dipinjam" },
  { value: "OVERDUE", label: "Terlambat" },
  { value: "RETURNED", label: "Sudah Dikembalikan" },
  { value: "REJECTED", label: "Ditolak" },
];

function BorrowCard({ borrow, onViewDetail }: { borrow: BorrowRecord; onViewDetail: () => void }) {
  const isOverdue = borrow.effectiveStatus === "OVERDUE";
  const isBorrowed = borrow.effectiveStatus === "BORROWED";
  const isReturned = borrow.effectiveStatus === "RETURNED";
  const isRequested = borrow.effectiveStatus === "REQUESTED";
  const isRejected = borrow.effectiveStatus === "REJECTED";

  const dueDate = new Date(borrow.dueDate);
  const now = new Date();
  const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div
      className="card"
      style={{
        borderLeft: `4px solid ${
          isOverdue
            ? "var(--color-danger-text)"
            : isRequested
            ? "var(--color-warning-text)"
            : isBorrowed && daysUntilDue <= 2
            ? "var(--color-warning-text)"
            : isBorrowed
            ? "var(--color-info-text)"
            : "var(--color-border)"
        }`,
      }}
    >
      <div className="card-body" style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        {/* Cover */}
        {borrow.book.coverUrl ? (
          <img
            src={borrow.book.coverUrl}
            alt={borrow.book.title}
            style={{ width: "56px", height: "80px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{ width: "56px", height: "80px", borderRadius: "6px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
            className="bg-primary-50"
          >
            <BookOpen size={24} className="text-primary" />
          </div>
        )}

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <p className="font-semibold text-main line-clamp-1">{borrow.book.title}</p>
              <p className="text-sm text-muted">{borrow.book.author}</p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexShrink: 0 }}>
              {isRequested && <Badge variant="warning">Menunggu Persetujuan</Badge>}
              {isOverdue && <Badge variant="danger">Terlambat</Badge>}
              {isBorrowed && !isOverdue && daysUntilDue <= 2 && <Badge variant="warning">Segera Kembali</Badge>}
              {isBorrowed && !isOverdue && daysUntilDue > 2 && <Badge variant="info">Dipinjam</Badge>}
              {isReturned && <Badge variant="success">Dikembalikan</Badge>}
              {isRejected && <Badge variant="danger">Ditolak</Badge>}
              {borrow.effectiveStatus === "CANCELLED" && <Badge variant="warning">Dibatalkan</Badge>}
            </div>
          </div>

          <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Calendar size={13} className="text-muted" />
              <span className="text-xs text-muted">
                {isRequested ? "Diajukan" : "Pinjam"}: {new Date(borrow.borrowDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
            {!isRequested && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <Clock size={13} className={isOverdue ? "text-danger" : "text-muted"} />
                <span className={`text-xs ${isOverdue ? "text-danger font-semibold" : "text-muted"}`}>
                  Tenggat: {dueDate.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                  {isOverdue && " (Terlambat!)"}
                  {isBorrowed && !isOverdue && daysUntilDue >= 0 && ` (${daysUntilDue} hari lagi)`}
                </span>
              </div>
            )}
            {borrow.returnDate && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <CheckCircle size={13} className="text-success" />
                <span className="text-xs text-muted">
                  Kembali: {new Date(borrow.returnDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            )}
          </div>

          {/* Pending request notice */}
          {isRequested && (
            <div
              className="flex items-center gap-2 mt-2 p-2 rounded-lg"
              style={{ backgroundColor: "var(--color-warning-bg)" }}
            >
              <Clock size={13} style={{ color: "var(--color-warning-text)", flexShrink: 0 }} />
              <p className="text-xs" style={{ color: "var(--color-warning-text)" }}>
                Menunggu persetujuan pustakawan. Silakan ambil buku setelah disetujui.
              </p>
            </div>
          )}

          {/* Overdue warning */}
          {isOverdue && (
            <div
              className="flex items-center gap-2 mt-2 p-2 rounded-lg"
              style={{ backgroundColor: "var(--color-danger-bg)" }}
            >
              <AlertTriangle size={13} style={{ color: "var(--color-danger-text)", flexShrink: 0 }} />
              <p className="text-xs" style={{ color: "var(--color-danger-text)" }}>
                Harap segera kembalikan buku ini ke perpustakaan.
              </p>
            </div>
          )}

          {/* Due soon warning */}
          {isBorrowed && !isOverdue && daysUntilDue <= 2 && (
            <div
              className="flex items-center gap-2 mt-2 p-2 rounded-lg"
              style={{ backgroundColor: "var(--color-warning-bg)" }}
            >
              <Clock size={13} style={{ color: "var(--color-warning-text)", flexShrink: 0 }} />
              <p className="text-xs" style={{ color: "var(--color-warning-text)" }}>
                Batas pengembalian {daysUntilDue === 0 ? "hari ini!" : `${daysUntilDue} hari lagi.`}
              </p>
            </div>
          )}
        </div>

        {/* Action */}
        <button
          onClick={onViewDetail}
          className="row-action hover:bg-base hover:text-main transition-colors"
          title="Lihat Detail"
        >
          <Eye size={18} />
        </button>
      </div>
    </div>
  );
}

export default function MyBorrowingsPage() {
  const [borrows, setBorrows] = useState<BorrowRecord[]>([]);
  const [summary, setSummary] = useState<{ borrowed: number; overdue: number; total: number }>({
    borrowed: 0,
    overdue: 0,
    total: 0,
  });
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBorrowId, setSelectedBorrowId] = useState<string | null>(null);

  const fetchBorrows = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: "10",
        // Halaman ini khusus peminjaman BUKU FISIK. Riwayat ebook ditampilkan
        // di menu "Ebook Saya" dan riwayat transaksi, bukan di sini.
        type: "book",
        ...(status && { status }),
      });
      const res = await fetch(`/api/borrows?${params}`);
      if (res.ok) {
        const data = await res.json();
        setBorrows(data.borrows);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        if (data.summary) {
          setSummary(data.summary);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    fetchBorrows();
  }, [fetchBorrows]);

  const overdueCount = summary.overdue ?? borrows.filter((b) => b.effectiveStatus === "OVERDUE").length;
  const activeCount = summary.borrowed ?? borrows.filter((b) => b.effectiveStatus === "BORROWED").length;

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">Buku Saya</h1>
            <p className="page-description">Pantau status peminjaman buku Anda</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--blue" aria-hidden="true"><BookOpen size={20} /></div>
            <div className="min-w-0">
              <p className="stat-card__label">Sedang Dipinjam</p>
              <p className="stat-card__value">{activeCount}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--danger" aria-hidden="true"><AlertTriangle size={20} /></div>
            <div className="min-w-0">
              <p className="stat-card__label">Terlambat</p>
              <p className="stat-card__value">{overdueCount}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--green" aria-hidden="true"><CheckCircle size={20} /></div>
            <div className="min-w-0">
              <p className="stat-card__label">Total Riwayat</p>
              <p className="stat-card__value">{total}</p>
            </div>
          </div>
        </div>

        <Card className="card-accent-blue">
          <CardHeader>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
              <div>
                <CardTitle>Riwayat Peminjaman</CardTitle>
                <CardDescription>{total} transaksi</CardDescription>
              </div>
              <Select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                style={{ width: "180px" }}
                aria-label="Filter status peminjaman"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>
          </CardHeader>
        <CardBody>
          {isLoading ? (
            <LoadingState message="Memuat data peminjaman..." />
          ) : borrows.length === 0 ? (
            <EmptyState
              title="Tidak ada data peminjaman"
              description="Anda belum memiliki riwayat peminjaman buku."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {borrows.map((borrow) => (
                <BorrowCard
                  key={borrow.id}
                  borrow={borrow}
                  onViewDetail={() => setSelectedBorrowId(borrow.id)}
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

      {selectedBorrowId && (
        <BorrowDetailModal
          isOpen={!!selectedBorrowId}
          borrowId={selectedBorrowId}
          onClose={() => setSelectedBorrowId(null)}
        />
      )}
    </DashboardLayout>
  );
}
