"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import BorrowDetailModal from "@/components/borrows/BorrowDetailModal";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle,
  Clock,
  Eye,
  History as HistoryIcon,
  RefreshCw,
  XCircle,
} from "lucide-react";

type Audience = "STUDENT" | "STAFF";

interface BorrowHistoryViewProps {
  audience: Audience;
}

interface BorrowRecord {
  id: string;
  /** "book" untuk BorrowRecord fisik, "ebook" untuk EbookLoan. */
  itemType?: "book" | "ebook";
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
    isArchived?: boolean;
  };
}

interface Summary {
  total: number;
  borrowed: number;
  overdue: number;
  returned: number;
  cancelled: number;
  // Ringkasan ebook (disediakan /api/borrows). Opsional agar kompatibel
  // dengan respons lama yang hanya berisi buku fisik.
  physicalTotal?: number;
  physicalActive?: number;
  ebookTotal?: number;
  ebookActive?: number;
  ebookReturned?: number;
  ebookExpired?: number;
}

interface BorrowsResponse {
  borrows: BorrowRecord[];
  total: number;
  page: number;
  totalPages: number;
  summary?: Summary;
}

const PAGE_SIZE = 10;

const COPY: Record<Audience, { title: string; subtitle: string; emptyTitle: string; emptyDescription: string }> = {
  STUDENT: {
    title: "Riwayat Peminjaman",
    subtitle: "Semua catatan peminjaman dan pengembalian buku Anda",
    emptyTitle: "Belum ada riwayat",
    emptyDescription: "Anda belum pernah meminjam buku dari perpustakaan.",
  },
  STAFF: {
    title: "Riwayat Transaksi",
    subtitle: "Semua catatan peminjaman dan pengembalian buku Anda",
    emptyTitle: "Belum ada riwayat",
    emptyDescription: "Anda belum pernah melakukan transaksi peminjaman buku.",
  },
};

const STATUS_OPTIONS = [
  { value: "", label: "Semua Status" },
  { value: "REQUESTED", label: "Menunggu Persetujuan" },
  { value: "BORROWED", label: "Sedang Dipinjam" },
  { value: "OVERDUE", label: "Terlambat" },
  { value: "RETURNED", label: "Sudah Dikembalikan" },
  { value: "EXPIRED", label: "Masa Akses Ebook Berakhir" },
  { value: "CANCELLED", label: "Dibatalkan" },
  { value: "REJECTED", label: "Ditolak" },
];

const EMPTY_SUMMARY: Summary = { total: 0, borrowed: 0, overdue: 0, returned: 0, cancelled: 0 };

function buildYearOptions() {
  const currentYear = new Date().getFullYear();
  return [
    { value: "", label: "Semua Tahun" },
    ...Array.from({ length: 5 }, (_, i) => {
      const y = String(currentYear - i);
      return { value: y, label: y };
    }),
  ];
}

const YEAR_OPTIONS = buildYearOptions();

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDuration(borrowDate: string, returnDate: string | null) {
  const start = new Date(borrowDate).getTime();
  const end = returnDate ? new Date(returnDate).getTime() : Date.now();
  const days = Math.max(0, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
  return `${days} hari`;
}

function StatusBadge({ status, itemType }: { status: string; itemType?: "book" | "ebook" }) {
  // Status ebook memakai kosakata masa akses, bukan "dipinjam": EbookLoan
  // ACTIVE berarti akses masih berlaku, bukan bukti sedang dibaca.
  if (itemType === "ebook") {
    switch (status) {
      case "BORROWED":
        return <Badge variant="info">Masa Akses Aktif</Badge>;
      case "RETURNED":
        return <Badge variant="success">Dikembalikan</Badge>;
      case "EXPIRED":
        return <Badge variant="warning">Kedaluwarsa</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  }

  switch (status) {
    case "REQUESTED":
      return <Badge variant="warning">Menunggu Persetujuan</Badge>;
    case "BORROWED":
      return <Badge variant="info">Dipinjam</Badge>;
    case "OVERDUE":
      return <Badge variant="danger">Terlambat</Badge>;
    case "RETURNED":
      return <Badge variant="success">Dikembalikan</Badge>;
    case "EXPIRED":
      return <Badge variant="warning">Kedaluwarsa</Badge>;
    case "CANCELLED":
      return <Badge variant="warning">Dibatalkan</Badge>;
    case "REJECTED":
      return <Badge variant="danger">Ditolak</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

export default function BorrowHistoryView({ audience }: BorrowHistoryViewProps) {
  const copy = COPY[audience];
  const [borrows, setBorrows] = useState<BorrowRecord[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [year, setYear] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBorrowId, setSelectedBorrowId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: PAGE_SIZE.toString(),
        ...(status && { status }),
        ...(year && { year }),
      });
      const res = await fetch(`/api/borrows?${params}`);
      if (!res.ok) {
        throw new Error(res.status === 401 ? "Sesi Anda telah berakhir." : "Gagal memuat riwayat transaksi.");
      }
      const data: BorrowsResponse = await res.json();
      setBorrows(data.borrows ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setSummary(data.summary ?? EMPTY_SUMMARY);
    } catch (err) {
      setBorrows([]);
      setTotal(0);
      setTotalPages(1);
      setSummary(EMPTY_SUMMARY);
      setError(err instanceof Error ? err.message : "Gagal memuat riwayat transaksi.");
    } finally {
      setIsLoading(false);
    }
  }, [page, status, year]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const hasFilter = Boolean(status || year);
  // Ringkasan kartu menggabungkan buku fisik dan ebook agar angka "Total
  // Riwayat" tidak lebih besar dari jumlah bagian yang ditampilkan.
  const finishedCount = summary.returned + (summary.ebookReturned ?? 0);
  const activeCount = summary.borrowed + (summary.ebookActive ?? 0);

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading flex items-center gap-2">
              <HistoryIcon size={24} className="text-primary flex-shrink-0" aria-hidden="true" />
              {copy.title}
            </h1>
            <p className="page-description">{copy.subtitle}</p>
          </div>
          <div className="page-actions">
            <Button variant="ghost" onClick={fetchHistory} size="sm">
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--purple" aria-hidden="true"><BookOpen size={20} /></div>
            <div className="min-w-0">
              <p className="stat-card__label">Total Riwayat</p>
              <p className="stat-card__value">{summary.total}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--green" aria-hidden="true"><CheckCircle size={20} /></div>
            <div className="min-w-0">
              <p className="stat-card__label">Selesai</p>
              <p className="stat-card__value">{finishedCount}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--blue" aria-hidden="true"><Clock size={20} /></div>
            <div className="min-w-0">
              <p className="stat-card__label">Sedang Dipinjam / Aktif</p>
              <p className="stat-card__value">{activeCount}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--danger" aria-hidden="true"><AlertTriangle size={20} /></div>
            <div className="min-w-0">
              <p className="stat-card__label">Terlambat</p>
              <p className="stat-card__value">{summary.overdue}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardBody>
            <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
              <Select
                value={year}
                onChange={(e) => { setYear(e.target.value); setPage(1); }}
                style={{ minWidth: "150px" }}
                aria-label="Filter tahun"
              >
                {YEAR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
              <Select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                style={{ minWidth: "190px" }}
                aria-label="Filter status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
              {hasFilter && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setStatus(""); setYear(""); setPage(1); }}
                >
                  <XCircle size={14} />
                  Reset Filter
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="card-accent-purple">
          <CardHeader>
            <CardTitle>Daftar Riwayat</CardTitle>
            <CardDescription>{total} transaksi ditemukan</CardDescription>
          </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <LoadingState message="Memuat riwayat transaksi..." />
          ) : error ? (
            <div className="p-4">
              <ErrorState message={error} onRetry={fetchHistory} />
            </div>
          ) : borrows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={hasFilter ? "Tidak ada transaksi yang sesuai" : copy.emptyTitle}
                description={hasFilter ? "Coba ubah atau hapus filter yang aktif." : copy.emptyDescription}
              />
            </div>
          ) : (
            <TableContainer className="border-none shadow-none rounded-none">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Buku</Th>
                    <Th>Tgl Pinjam</Th>
                    <Th>Tenggat / Akhir Akses</Th>
                    <Th>Tgl Kembali</Th>
                    <Th>Durasi</Th>
                    <Th>Status</Th>
                    <Th>Aksi</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {borrows.map((borrow) => {
                    const isEbook = borrow.itemType === "ebook";
                    const isReturnedLate =
                      !isEbook &&
                      borrow.status === "RETURNED" &&
                      Boolean(borrow.returnDate) &&
                      new Date(borrow.returnDate as string) > new Date(borrow.dueDate);

                    return (
                      <Tr key={borrow.id}>
                        <Td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            {borrow.book.coverUrl ? (
                              <img
                                src={borrow.book.coverUrl}
                                alt={borrow.book.title}
                                style={{ width: "36px", height: "50px", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                              />
                            ) : (
                              <div
                                className="bg-primary-50 text-primary flex items-center justify-center"
                                style={{ width: "36px", height: "50px", borderRadius: "4px", flexShrink: 0 }}
                              >
                                <BookOpen size={16} />
                              </div>
                            )}
                            <div style={{ minWidth: 0 }}>
                              <p className="font-medium text-main line-clamp-1">
                                {borrow.book.title}
                                {isEbook && (
                                  <span className="ml-2 align-middle">
                                    <Badge variant="info">Ebook</Badge>
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-muted line-clamp-1">{borrow.book.author}</p>
                            </div>
                          </div>
                        </Td>
                        <Td className="text-sm whitespace-nowrap">{formatDate(borrow.borrowDate)}</Td>
                        <Td className="text-sm whitespace-nowrap">
                          <span className={borrow.effectiveStatus === "OVERDUE" ? "text-danger font-semibold" : ""}>
                            {formatDate(borrow.dueDate)}
                          </span>
                        </Td>
                        <Td className="text-sm whitespace-nowrap">
                          {borrow.returnDate ? formatDate(borrow.returnDate) : <span className="text-muted">-</span>}
                        </Td>
                        <Td className="text-sm whitespace-nowrap">
                          {borrow.status === "CANCELLED" ? (
                            <span className="text-muted">-</span>
                          ) : (
                            formatDuration(borrow.borrowDate, borrow.returnDate)
                          )}
                        </Td>
                        <Td>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-start" }}>
                            <StatusBadge status={borrow.effectiveStatus} itemType={borrow.itemType} />
                            {isReturnedLate && (
                              <span className="text-xs" style={{ color: "var(--color-danger-text)" }}>
                                Telat kembali
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td>
                          {isEbook ? (
                            <Link
                              href="/ebooks/saya"
                              className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg text-muted hover:bg-base hover:text-main transition-colors"
                              title="Kelola akses ebook"
                              aria-label={`Kelola akses ebook ${borrow.book.title}`}
                            >
                              <Eye size={16} />
                            </Link>
                          ) : (
                            <button
                              onClick={() => setSelectedBorrowId(borrow.id)}
                              className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg text-muted hover:bg-base hover:text-main transition-colors"
                              title="Lihat Detail"
                              aria-label={`Lihat detail peminjaman ${borrow.book.title}`}
                            >
                              <Eye size={16} />
                            </button>
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
