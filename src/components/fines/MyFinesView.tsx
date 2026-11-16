"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import BorrowDetailModal from "@/components/borrows/BorrowDetailModal";
import { AlertTriangle, CheckCircle, Coins, Eye, Info, RefreshCw } from "lucide-react";

interface MyFineRow {
  id: string;
  dueDate: string;
  borrowDate: string;
  returnDate: string | null;
  fineAmount: number;
  lateFineAmount: number;
  damageFineAmount: number;
  returnCondition: string | null;
  fineRate: number | null;
  finePaid: boolean;
  finePaidAt: string | null;
  daysLate: number;
  ratePerDay: number;
  totalPaid: number;
  outstanding: number;
  payments: number;
  lastPaymentAt: string | null;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  book: { id: string; title: string; author: string; isbn: string | null; coverUrl: string | null };
}

interface MyFinesResponse {
  fines: MyFineRow[];
  total: number;
  page: number;
  totalPages: number;
  summary: {
    totalFine: number;
    totalPaid: number;
    totalOutstanding: number;
    unpaidCount: number;
    partialCount: number;
    paidCount: number;
  };
  ratePerDay: number;
}

interface Props {
  title: string;
  subtitle: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "Semua Denda" },
  { value: "UNPAID", label: "Belum Lunas" },
  { value: "PARTIAL", label: "Dibayar Sebagian" },
  { value: "PAID", label: "Lunas" },
];

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

const PAYMENT_STATUS: Record<
  "UNPAID" | "PARTIAL" | "PAID",
  { label: string; variant: "danger" | "warning" | "success" }
> = {
  UNPAID: { label: "Belum Lunas", variant: "danger" },
  PARTIAL: { label: "Dibayar Sebagian", variant: "warning" },
  PAID: { label: "Lunas", variant: "success" },
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Tampilan denda milik pengguna sendiri. Data selalu berasal dari
 * `/api/fines/my` yang membatasi query ke `session.user.id`; komponen ini tidak
 * pernah mengirim `userId` dari klien.
 */
export default function MyFinesView({ title, subtitle }: Props) {
  const [fines, setFines] = useState<MyFineRow[]>([]);
  const [summary, setSummary] = useState<MyFinesResponse["summary"]>({
    totalFine: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    unpaidCount: 0,
    partialCount: 0,
    paidCount: 0,
  });
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratePerDay, setRatePerDay] = useState<number | null>(null);
  const [selectedBorrowId, setSelectedBorrowId] = useState<string | null>(null);

  const fetchFines = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: "15",
        ...(status && { status }),
      });
      const res = await fetch(`/api/fines/my?${params}`);
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? "Sesi Anda telah berakhir." : "Gagal memuat data denda."
        );
      }
      const data: MyFinesResponse = await res.json();
      setFines(data.fines ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setSummary(data.summary);
      setRatePerDay(data.ratePerDay);
    } catch (err) {
      setFines([]);
      setTotal(0);
      setTotalPages(1);
      setError(err instanceof Error ? err.message : "Gagal memuat data denda.");
    } finally {
      setIsLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    fetchFines();
  }, [fetchFines]);

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">{title}</h1>
            <p className="page-description">{subtitle}</p>
          </div>
          <div className="page-actions">
            <Button variant="ghost" onClick={fetchFines} size="sm">
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
        </div>

        <Card className="card-accent-yellow">
          <CardBody className="flex flex-wrap items-center gap-3">
            <div className="icon-tile icon-tile--yellow" aria-hidden="true">
              <Info size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted">Tarif denda keterlambatan yang berlaku</p>
              <p className="text-lg font-bold text-main">
                {ratePerDay === null ? "Memuat..." : `${rupiah(ratePerDay)} / hari`}
              </p>
            </div>
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--danger" aria-hidden="true">
              <Coins size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Sisa Tunggakan</p>
              <p className="stat-card__value text-lg sm:text-xl">{rupiah(summary.totalOutstanding)}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--yellow" aria-hidden="true">
              <AlertTriangle size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Total Denda Tercatat</p>
              <p className="stat-card__value text-lg sm:text-xl">{rupiah(summary.totalFine)}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--green" aria-hidden="true">
              <CheckCircle size={22} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Sudah Dibayar</p>
              <p className="stat-card__value text-lg sm:text-xl">{rupiah(summary.totalPaid)}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardBody>
            <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
              <Select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                style={{ minWidth: "170px" }}
                aria-label="Filter status denda"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>
          </CardBody>
        </Card>

        <Card className="card-accent-purple">
          <CardHeader>
            <CardTitle>Daftar Denda Saya</CardTitle>
            <CardDescription>
              {total} transaksi berdenda · {summary.unpaidCount} belum lunas
              {summary.partialCount > 0 ? ` · ${summary.partialCount} dibayar sebagian` : ""}
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            {isLoading ? (
              <LoadingState message="Memuat data denda..." />
            ) : error ? (
              <div className="p-4">
                <EmptyState title="Gagal memuat denda" description={error} />
              </div>
            ) : fines.length === 0 ? (
              <EmptyState
                title="Tidak ada denda"
                description={
                  status
                    ? "Tidak ada denda yang sesuai dengan filter."
                    : "Anda tidak memiliki denda yang tercatat."
                }
              />
            ) : (
              <TableContainer className="border-none shadow-none rounded-none">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Buku</Th>
                      <Th>Tgl Kembali</Th>
                      <Th>Telat</Th>
                      <Th>Rincian</Th>
                      <Th>Total Denda</Th>
                      <Th>Dibayar</Th>
                      <Th>Sisa</Th>
                      <Th>Status</Th>
                      <Th>Aksi</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {fines.map((f) => {
                      const statusMeta = PAYMENT_STATUS[f.paymentStatus] ?? PAYMENT_STATUS.UNPAID;
                      const lunas = statusMeta.variant === "success";
                      return (
                        <Tr key={f.id}>
                          <Td>
                            <div>
                              <p className="font-medium text-main line-clamp-1">{f.book.title}</p>
                              <p className="text-xs text-muted">{f.book.author}</p>
                            </div>
                          </Td>
                          <Td className="text-sm">{formatDate(f.returnDate)}</Td>
                          <Td className="text-sm">{f.daysLate} hari</Td>
                          <Td className="text-sm">
                            <div className="text-xs text-muted">
                              {f.lateFineAmount > 0 && <p>Keterlambatan: {rupiah(f.lateFineAmount)}</p>}
                              {f.damageFineAmount > 0 && <p>Kerusakan: {rupiah(f.damageFineAmount)}</p>}
                              {f.lateFineAmount <= 0 && f.damageFineAmount <= 0 && <p>Denda tercatat</p>}
                            </div>
                          </Td>
                          <Td className="text-sm font-medium">{rupiah(f.fineAmount)}</Td>
                          <Td className="text-sm">{rupiah(f.totalPaid)}</Td>
                          <Td className="text-sm font-semibold">
                            <span style={{ color: lunas ? "var(--color-success-text)" : "var(--color-danger-text)" }}>
                              {rupiah(f.outstanding)}
                            </span>
                          </Td>
                          <Td>
                            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                          </Td>
                          <Td>
                            <button
                              onClick={() => setSelectedBorrowId(f.id)}
                              className="row-action hover:bg-base hover:text-main transition-colors"
                              title="Lihat Detail"
                              aria-label={`Lihat detail denda ${f.book.title}`}
                            >
                              <Eye size={16} />
                            </button>
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
