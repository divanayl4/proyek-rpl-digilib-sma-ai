"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import CreateBorrowModal from "@/components/borrows/CreateBorrowModal";
import ReturnConfirmDialog from "@/components/borrows/ReturnConfirmDialog";
import BorrowDetailModal from "@/components/borrows/BorrowDetailModal";
import ApproveRejectDialog from "@/components/borrows/ApproveRejectDialog";
import PayFineDialog from "@/components/borrows/PayFineDialog";
import {
  BookMarked,
  BookOpen,
  FileText,
  AlertTriangle,
  Search,
  Plus,
  RefreshCw,
  Eye,
  CheckCircle,
  Clock,
  XCircle,
  Coins,
} from "lucide-react";

interface BorrowRecord {
  id: string;
  /** "book" untuk BorrowRecord fisik, "ebook" untuk EbookLoan. */
  itemType?: "book" | "ebook";
  borrowDate: string;
  dueDate: string;
  returnDate: string | null;
  status: string;
  effectiveStatus: string;
  notes: string | null;
  borrowReason: string | null;
  fineAmount: number;
  finePaid: boolean;
  user: { id: string; name: string; email: string; role: string; class: string | null; identityNumber: string | null };
  book: {
    id: string;
    title: string;
    author: string;
    isbn: string | null;
    coverUrl: string | null;
    archivedAt?: string | null;
    isArchived?: boolean;
  };
  createdBy: { id: string; name: string } | null;
}

interface BorrowsSummary {
  total: number;
  requested: number;
  borrowed: number;
  overdue: number;
  returned: number;
  cancelled: number;
  rejected: number;
  physicalTotal: number;
  physicalActive: number;
  ebookTotal: number;
  ebookActive: number;
  ebookReturned: number;
  ebookExpired: number;
}

interface BorrowsResponse {
  borrows: BorrowRecord[];
  total: number;
  page: number;
  totalPages: number;
  summary: BorrowsSummary;
}

interface Props {
  title: string;
  subtitle: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "Semua Status" },
  { value: "REQUESTED", label: "Menunggu Persetujuan" },
  { value: "BORROWED", label: "Dipinjam" },
  { value: "OVERDUE", label: "Terlambat" },
  { value: "RETURNED", label: "Dikembalikan" },
  { value: "EXPIRED", label: "Masa Akses Berakhir" },
  { value: "CANCELLED", label: "Dibatalkan" },
  { value: "REJECTED", label: "Ditolak" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "Semua" },
  { value: "book", label: "Buku Fisik" },
  { value: "ebook", label: "Ebook" },
] as const;

const EMPTY_SUMMARY: BorrowsSummary = {
  total: 0,
  requested: 0,
  borrowed: 0,
  overdue: 0,
  returned: 0,
  cancelled: 0,
  rejected: 0,
  physicalTotal: 0,
  physicalActive: 0,
  ebookTotal: 0,
  ebookActive: 0,
  ebookReturned: 0,
  ebookExpired: 0,
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusBadge(effectiveStatus: string, itemType?: "book" | "ebook") {
  // Status ebook sengaja tidak memakai istilah "dibaca": EbookLoan hanya
  // mencatat masa akses, bukan aktivitas membaca.
  if (itemType === "ebook") {
    switch (effectiveStatus) {
      case "BORROWED":
        return <Badge variant="info">Masa Akses Aktif</Badge>;
      case "EXPIRED":
        return <Badge variant="warning">Masa Akses Berakhir</Badge>;
      case "RETURNED":
        return <Badge variant="success">Dikembalikan</Badge>;
      default:
        return <Badge>{effectiveStatus}</Badge>;
    }
  }
  switch (effectiveStatus) {
    case "REQUESTED":
      return <Badge variant="warning">Menunggu Persetujuan</Badge>;
    case "BORROWED":
      return <Badge variant="info">Dipinjam</Badge>;
    case "OVERDUE":
      return <Badge variant="danger">Terlambat</Badge>;
    case "RETURNED":
      return <Badge variant="success">Dikembalikan</Badge>;
    case "CANCELLED":
      return <Badge variant="warning">Dibatalkan</Badge>;
    case "REJECTED":
      return <Badge variant="danger">Ditolak</Badge>;
    default:
      return <Badge>{effectiveStatus}</Badge>;
  }
}

export default function BorrowManagementView({ title, subtitle }: Props) {
  const [borrows, setBorrows] = useState<BorrowRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [itemType, setItemType] = useState("");
  const [summary, setSummary] = useState<BorrowsSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [approveReject, setApproveReject] = useState<{ borrow: BorrowRecord; mode: "approve" | "reject" } | null>(null);
  const [payFineBorrow, setPayFineBorrow] = useState<BorrowRecord | null>(null);
  const [selectedBorrow, setSelectedBorrow] = useState<BorrowRecord | null>(null);

  const fetchBorrows = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: "15",
        ...(search && { search }),
        ...(status && { status }),
        ...(itemType && { type: itemType }),
      });
      const res = await fetch(`/api/borrows?${params}`);
      if (!res.ok) {
        throw new Error("Gagal memuat data transaksi");
      }
      const data: BorrowsResponse = await res.json();
      setBorrows(data.borrows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setSummary(data.summary ?? EMPTY_SUMMARY);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Gagal memuat data transaksi");
    } finally {
      setIsLoading(false);
    }
  }, [page, search, status, itemType]);

  useEffect(() => {
    fetchBorrows();
  }, [fetchBorrows]);

  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">{title}</h1>
            <p className="page-description">{subtitle}</p>
          </div>
          <div className="page-actions">
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus size={16} />
              Buat Peminjaman
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-4">
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--blue" aria-hidden="true">
              <BookMarked size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Total Transaksi</p>
              <p className="stat-card__value">{summary.total}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--purple" aria-hidden="true">
              <BookOpen size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Transaksi Buku Fisik</p>
              <p className="stat-card__value">{summary.physicalTotal}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--green" aria-hidden="true">
              <FileText size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Transaksi Ebook</p>
              <p className="stat-card__value">{summary.ebookTotal}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--blue" aria-hidden="true">
              <CheckCircle size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Buku Fisik Aktif</p>
              <p className="stat-card__value">{summary.physicalActive}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--green" aria-hidden="true">
              <CheckCircle size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Ebook Aktif</p>
              <p className="stat-card__value">{summary.ebookActive}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--yellow" aria-hidden="true">
              <Clock size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Menunggu Persetujuan</p>
              <p className="stat-card__value">{summary.requested}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--danger" aria-hidden="true">
              <AlertTriangle size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Terlambat</p>
              <p className="stat-card__value">{summary.overdue}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardBody>
            <div
              className="flex flex-wrap gap-2 mb-3"
              role="group"
              aria-label="Kategori transaksi"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={itemType === opt.value ? "primary" : "secondary"}
                  size="sm"
                  aria-pressed={itemType === opt.value}
                  onClick={() => {
                    setItemType(opt.value);
                    setPage(1);
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
              <div className="relative" style={{ flex: "1 1 240px" }}>
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
                <Input
                  placeholder="Cari nama, kelas, NIS/NIP, email, judul buku/ebook, ISBN..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                style={{ minWidth: "190px" }}
                aria-label="Filter status transaksi"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
              <Button variant="secondary" onClick={() => { setStatus("REQUESTED"); setPage(1); }} size="sm">
                <Clock size={14} />
                Menunggu
              </Button>
              <Button variant="secondary" onClick={() => { setStatus("OVERDUE"); setPage(1); }} size="sm">
                <AlertTriangle size={14} />
                Terlambat
              </Button>
              <Button variant="ghost" onClick={fetchBorrows} size="sm">
                <RefreshCw size={14} />
                Refresh
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="card-accent-blue">
          <CardHeader>
            <CardTitle>Daftar Transaksi</CardTitle>
            <CardDescription>{total} transaksi ditemukan</CardDescription>
          </CardHeader>
        <CardBody className="p-0">
          <p className="px-4 pt-4 text-xs text-muted">
            Masa akses ebook menunjukkan periode peminjaman/akses, bukan bukti bahwa ebook
            dibuka atau dibaca. Waktu ditampilkan dalam zona Asia/Jakarta.
          </p>
          {isLoading ? (
            <LoadingState message="Memuat data transaksi..." />
          ) : error ? (
            <ErrorState
              title="Gagal memuat transaksi"
              message={error}
              onRetry={fetchBorrows}
            />
          ) : borrows.length === 0 ? (
            <EmptyState
              title="Tidak ada transaksi"
              description={search || status || itemType ? "Tidak ada transaksi yang sesuai dengan filter." : "Belum ada transaksi peminjaman."}
            />
          ) : (
            <TableContainer className="border-none shadow-none rounded-none">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Peminjam</Th>
                    <Th>Buku / Ebook</Th>
                    <Th>Mulai</Th>
                    <Th>Berakhir</Th>
                    <Th>Dikembalikan</Th>
                    <Th>Status</Th>
                    <Th>Aksi</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {borrows.map((borrow) => {
                    const isEbook = borrow.itemType === "ebook";
                    const isOverdue = !isEbook && borrow.effectiveStatus === "OVERDUE";
                    const isRequested = !isEbook && borrow.effectiveStatus === "REQUESTED";
                    const isActive = !isEbook && (borrow.effectiveStatus === "BORROWED" || isOverdue);
                    const isExpired = isEbook && borrow.effectiveStatus === "EXPIRED";
                    const hasUnpaidFine = !isEbook && borrow.effectiveStatus === "RETURNED" && borrow.fineAmount > 0 && !borrow.finePaid;
                    const identityLabel = borrow.user.class || borrow.user.identityNumber;
                    return (
                      <Tr key={borrow.id} className={isOverdue ? "bg-danger-bg" : ""}>
                        <Td>
                          <div>
                            <p className="font-medium text-main">{borrow.user.name}</p>
                            <p className="text-xs text-muted">{borrow.user.role}{identityLabel ? ` · ${identityLabel}` : ""}</p>
                          </div>
                        </Td>
                        <Td>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-main line-clamp-1">{borrow.book.title}</p>
                              {isEbook && <Badge variant="info">Ebook</Badge>}
                              {isEbook && borrow.book.isArchived && (
                                <Badge variant="warning">Ebook diarsipkan</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted">{borrow.book.author}</p>
                            {borrow.borrowReason && (
                              <p className="text-xs text-muted line-clamp-1" title={borrow.borrowReason}>
                                Alasan: {borrow.borrowReason}
                              </p>
                            )}
                          </div>
                        </Td>
                        <Td className="text-sm">
                          {isRequested
                            ? <span className="text-muted">-</span>
                            : isEbook
                              ? formatDateTime(borrow.borrowDate)
                              : formatDate(borrow.borrowDate)}
                        </Td>
                        <Td className="text-sm">
                          <span className={isOverdue || isExpired ? "text-danger font-semibold" : ""}>
                            {isEbook ? formatDateTime(borrow.dueDate) : formatDate(borrow.dueDate)}
                          </span>
                          {isOverdue && <span className="text-danger text-xs ml-1">(!)</span>}
                        </Td>
                        <Td className="text-sm">
                          {borrow.returnDate
                            ? isEbook
                              ? formatDateTime(borrow.returnDate)
                              : formatDate(borrow.returnDate)
                            : <span className="text-muted">-</span>}
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-1 items-start">
                            {getStatusBadge(borrow.effectiveStatus, borrow.itemType)}
                            {hasUnpaidFine && (
                              <span className="text-xs" style={{ color: "var(--color-danger-text)" }}>
                                Denda: Rp {borrow.fineAmount.toLocaleString("id-ID")}
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td>
                          {isEbook ? (
                            <span className="text-xs text-muted">Kelola di menu Ebook</span>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => { setSelectedBorrow(borrow); setShowDetailModal(true); }}
                                className="row-action hover:bg-base hover:text-main transition-colors"
                                title="Lihat Detail"
                              >
                                <Eye size={16} />
                              </button>
                              {isRequested && (
                                <>
                                  <button
                                    onClick={() => setApproveReject({ borrow, mode: "approve" })}
                                    className="row-action hover:bg-success-bg hover:text-success transition-colors"
                                    title="Setujui Pengajuan"
                                  >
                                    <CheckCircle size={16} />
                                  </button>
                                  <button
                                    onClick={() => setApproveReject({ borrow, mode: "reject" })}
                                    className="row-action hover:bg-danger-bg hover:text-danger transition-colors"
                                    title="Tolak Pengajuan"
                                  >
                                    <XCircle size={16} />
                                  </button>
                                </>
                              )}
                              {isActive && (
                                <button
                                  onClick={() => { setSelectedBorrow(borrow); setShowReturnDialog(true); }}
                                  className="row-action hover:bg-success-bg hover:text-success transition-colors"
                                  title="Proses Pengembalian"
                                >
                                  <CheckCircle size={16} />
                                </button>
                              )}
                              {hasUnpaidFine && (
                                <button
                                  onClick={() => setPayFineBorrow(borrow)}
                                  className="row-action hover:bg-warning-bg hover:text-warning transition-colors"
                                  title="Catat Pembayaran Denda"
                                >
                                  <Coins size={16} />
                                </button>
                              )}
                            </div>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
      </div>

      <CreateBorrowModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => { setShowCreateModal(false); fetchBorrows(); }}
      />

      {selectedBorrow && (
        <BorrowDetailModal
          isOpen={showDetailModal}
          borrowId={selectedBorrow.id}
          onClose={() => { setShowDetailModal(false); setSelectedBorrow(null); }}
        />
      )}

      {selectedBorrow && (
        <ReturnConfirmDialog
          isOpen={showReturnDialog}
          borrow={selectedBorrow}
          onClose={() => { setShowReturnDialog(false); setSelectedBorrow(null); }}
          onSuccess={() => { setShowReturnDialog(false); setSelectedBorrow(null); fetchBorrows(); }}
        />
      )}

      {approveReject && (
        <ApproveRejectDialog
          isOpen={!!approveReject}
          mode={approveReject.mode}
          borrow={approveReject.borrow}
          onClose={() => setApproveReject(null)}
          onSuccess={() => { setApproveReject(null); fetchBorrows(); }}
        />
      )}

      {payFineBorrow && (
        <PayFineDialog
          isOpen={!!payFineBorrow}
          borrowId={payFineBorrow.id}
          onClose={() => setPayFineBorrow(null)}
          onSuccess={() => { setPayFineBorrow(null); fetchBorrows(); }}
        />
      )}
    </DashboardLayout>
  );
}
