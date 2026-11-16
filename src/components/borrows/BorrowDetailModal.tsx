"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { BookOpen, User, Calendar, Clock, FileText, AlertTriangle } from "lucide-react";
import { getDamageCondition } from "@/lib/config/library";

interface BorrowDetail {
  id: string;
  borrowDate: string;
  dueDate: string;
  returnDate: string | null;
  status: string;
  effectiveStatus: string;
  notes: string | null;
  borrowReason: string | null;
  rejectReason: string | null;
  fine: number;
  finePaid: boolean;
  returnCondition: string | null;
  fineInfo: {
    daysLate: number;
    ratePerDay: number;
    amount: number;
    paid: number;
    outstanding: number;
    isFinal: boolean;
    lateAmount: number;
    damageAmount: number;
    paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  };
  finePayments: { id: string; amount: number; method: string | null; createdAt: string }[];
  user: {
    name: string;
    email: string;
    role: string;
    class: string | null;
    identityNumber: string | null;
  };
  book: {
    title: string;
    author: string;
    isbn: string | null;
    coverUrl: string | null;
    publisher: string | null;
  };
  createdBy: { name: string } | null;
  approvedBy: { name: string } | null;
}

interface Props {
  isOpen: boolean;
  borrowId: string;
  onClose: () => void;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "REQUESTED": return <Badge variant="warning">Menunggu Persetujuan</Badge>;
    case "BORROWED": return <Badge variant="info">Dipinjam</Badge>;
    case "OVERDUE": return <Badge variant="danger">Terlambat</Badge>;
    case "RETURNED": return <Badge variant="success">Dikembalikan</Badge>;
    case "CANCELLED": return <Badge variant="warning">Dibatalkan</Badge>;
    case "REJECTED": return <Badge variant="danger">Ditolak</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

export default function BorrowDetailModal({ isOpen, borrowId, onClose }: Props) {
  const [borrow, setBorrow] = useState<BorrowDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !borrowId) return;
    setIsLoading(true);
    fetch(`/api/borrows/${borrowId}`)
      .then((r) => r.json())
      .then((data) => setBorrow(data))
      .finally(() => setIsLoading(false));
  }, [isOpen, borrowId]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Detail Transaksi Peminjaman" size="lg">
      {isLoading || !borrow ? (
        <LoadingState message="Memuat detail transaksi..." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Overdue Alert */}
          {borrow.effectiveStatus === "OVERDUE" && (
            <div
              className="flex items-start gap-3 p-4 rounded-xl"
              style={{ backgroundColor: "var(--color-danger-bg)", border: "1px solid var(--color-danger-text)" }}
            >
              <AlertTriangle size={18} style={{ color: "var(--color-danger-text)", flexShrink: 0 }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--color-danger-text)" }}>
                  Buku ini terlambat dikembalikan
                </p>
                {borrow.fine > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-danger-text)" }}>
                    Estimasi denda: Rp {borrow.fine.toLocaleString("id-ID")}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Transaction ID */}
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">ID Transaksi</p>
            <p className="text-xs font-mono text-main break-all">{borrow.id}</p>
          </div>

          {/* Book Info */}
          <div className="flex items-start gap-3">
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
            <div className="min-w-0">
              <p className="text-xs text-muted mb-0.5">Buku</p>
              <p className="font-semibold text-main break-words">{borrow.book.title}</p>
              <p className="text-sm text-muted">{borrow.book.author}</p>
              {borrow.book.publisher && <p className="text-xs text-muted">{borrow.book.publisher}</p>}
              {borrow.book.isbn && <p className="text-xs text-muted">ISBN: {borrow.book.isbn}</p>}
            </div>
          </div>

          {/* Borrower Info */}
          <div className="p-3 rounded-lg border border-border" style={{ backgroundColor: "var(--color-bg-base)" }}>
            <div className="flex items-center gap-2 mb-2">
              <User size={14} className="text-muted" />
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">Peminjam</p>
            </div>
            <p className="font-medium text-main break-words">{borrow.user.name}</p>
            <p className="text-sm text-muted break-all">{borrow.user.email}</p>
            <div className="flex gap-2 mt-2" style={{ flexWrap: "wrap" }}>
              <Badge variant="info">{borrow.user.role}</Badge>
              {borrow.user.class && <Badge>{borrow.user.class}</Badge>}
              {borrow.user.identityNumber && <Badge>{borrow.user.identityNumber}</Badge>}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border border-border text-center">
              <Calendar size={16} className="text-muted mx-auto mb-1" />
              <p className="text-xs text-muted">Dipinjam</p>
              <p className="text-sm font-medium text-main">
                {new Date(borrow.borrowDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-border text-center">
              <Clock size={16} className="text-muted mx-auto mb-1" />
              <p className="text-xs text-muted">Tenggat</p>
              <p className={`text-sm font-medium ${borrow.effectiveStatus === "OVERDUE" ? "text-danger" : "text-main"}`}>
                {new Date(borrow.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-border text-center">
              <Calendar size={16} className="text-muted mx-auto mb-1" />
              <p className="text-xs text-muted">Dikembalikan</p>
              <p className="text-sm font-medium text-main">
                {borrow.returnDate
                  ? new Date(borrow.returnDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                  : "-"}
              </p>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Status</span>
            <StatusBadge status={borrow.effectiveStatus} />
          </div>

          {borrow.returnCondition && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Kondisi saat kembali</span>
              <Badge variant={borrow.returnCondition === "GOOD" ? "success" : "warning"}>
                {getDamageCondition(borrow.returnCondition)?.label ?? borrow.returnCondition}
              </Badge>
            </div>
          )}

          {/* Rejection reason */}
          {borrow.status === "REJECTED" && borrow.rejectReason && (
            <div
              className="flex items-start gap-3 p-4 rounded-xl"
              style={{ backgroundColor: "var(--color-danger-bg)" }}
            >
              <AlertTriangle size={18} style={{ color: "var(--color-danger-text)", flexShrink: 0 }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--color-danger-text)" }}>
                  Pengajuan ditolak
                </p>
                <p className="text-sm mt-0.5" style={{ color: "var(--color-danger-text)" }}>
                  {borrow.rejectReason}
                </p>
              </div>
            </div>
          )}

          {/* Fine details */}
          {borrow.fineInfo && borrow.fineInfo.amount > 0 && (
            <div className="p-3 rounded-lg border border-border">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                  {borrow.fineInfo.isFinal ? "Denda" : "Estimasi Denda"}
                </p>
                {borrow.fineInfo.isFinal && (
                  <Badge
                    variant={
                      borrow.fineInfo.paymentStatus === "PAID"
                        ? "success"
                        : borrow.fineInfo.paymentStatus === "PARTIAL"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {borrow.fineInfo.paymentStatus === "PAID"
                      ? "Lunas"
                      : borrow.fineInfo.paymentStatus === "PARTIAL"
                        ? "Dibayar Sebagian"
                        : "Belum Lunas"}
                  </Badge>
                )}
              </div>
              <div className="text-sm text-main flex flex-col gap-1">
                <div className="flex justify-between">
                  <span className="text-muted">Keterlambatan</span>
                  <span>{borrow.fineInfo.daysLate} hari</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Tarif / hari</span>
                  <span>Rp {borrow.fineInfo.ratePerDay.toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Denda keterlambatan</span>
                  <span>Rp {(borrow.fineInfo.lateAmount ?? 0).toLocaleString("id-ID")}</span>
                </div>
                {(borrow.fineInfo.damageAmount ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Denda kerusakan</span>
                    <span>Rp {borrow.fineInfo.damageAmount.toLocaleString("id-ID")}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <span>Total denda</span>
                  <span>Rp {borrow.fineInfo.amount.toLocaleString("id-ID")}</span>
                </div>
                {borrow.fineInfo.isFinal && borrow.fineInfo.paid > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Sudah dibayar</span>
                    <span>Rp {borrow.fineInfo.paid.toLocaleString("id-ID")}</span>
                  </div>
                )}
                {borrow.fineInfo.isFinal && borrow.fineInfo.outstanding > 0 && (
                  <div className="flex justify-between font-semibold" style={{ color: "var(--color-danger-text)" }}>
                    <span>Sisa</span>
                    <span>Rp {borrow.fineInfo.outstanding.toLocaleString("id-ID")}</span>
                  </div>
                )}
              </div>
              {borrow.finePayments && borrow.finePayments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-muted mb-1">Riwayat pembayaran</p>
                  {borrow.finePayments.map((p) => (
                    <div key={p.id} className="flex justify-between text-xs text-main">
                      <span>
                        {new Date(p.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                        {p.method ? ` • ${p.method}` : ""}
                      </span>
                      <span>Rp {p.amount.toLocaleString("id-ID")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Alasan peminjaman yang ditulis peminjam */}
          {borrow.borrowReason && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileText size={14} className="text-muted" />
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Alasan Peminjaman Buku</p>
              </div>
              <p className="text-sm text-main bg-base p-3 rounded-lg border border-border whitespace-pre-line break-words">
                {borrow.borrowReason}
              </p>
            </div>
          )}

          {/* Notes */}
          {borrow.notes && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileText size={14} className="text-muted" />
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Catatan</p>
              </div>
              <p className="text-sm text-main bg-base p-3 rounded-lg border border-border whitespace-pre-line">
                {borrow.notes}
              </p>
            </div>
          )}

          <div className="text-xs text-muted text-right flex flex-col gap-0.5">
            {borrow.createdBy && <span>Dibuat oleh: {borrow.createdBy.name}</span>}
            {borrow.approvedBy && <span>Diproses oleh: {borrow.approvedBy.name}</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}
