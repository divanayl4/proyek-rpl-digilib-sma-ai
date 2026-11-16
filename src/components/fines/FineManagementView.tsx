"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import PayFineDialog from "@/components/borrows/PayFineDialog";
import BorrowDetailModal from "@/components/borrows/BorrowDetailModal";
import {
  Coins,
  AlertTriangle,
  CheckCircle,
  Search,
  RefreshCw,
  Eye,
  Info,
} from "lucide-react";

interface FineRow {
  id: string;
  dueDate: string;
  returnDate: string | null;
  fineAmount: number;
  fineRate: number | null;
  finePaid: boolean;
  finePaidAt: string | null;
  daysLate: number;
  ratePerDay: number;
  totalPaid: number;
  outstanding: number;
  payments: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  lateFineAmount?: number;
  damageFineAmount?: number;
  returnCondition?: string | null;
  user: { id: string; name: string; email: string; role: string; class: string | null };
  book: { id: string; title: string; author: string; isbn: string | null };
  finePaidBy: { id: string; name: string } | null;
}

interface FinesResponse {
  fines: FineRow[];
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

export default function FineManagementView({ title, subtitle }: Props) {
  const [fines, setFines] = useState<FineRow[]>([]);
  const [summary, setSummary] = useState<FinesResponse["summary"]>({
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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [ratePerDay, setRatePerDay] = useState<number | null>(null);
  const [rateConfigured, setRateConfigured] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [payFineBorrow, setPayFineBorrow] = useState<FineRow | null>(null);
  const [selectedBorrow, setSelectedBorrow] = useState<FineRow | null>(null);

  const fetchFines = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: "15",
        ...(search && { search }),
        ...(status && { status }),
      });
      const res = await fetch(`/api/fines?${params}`);
      if (res.ok) {
        const data: FinesResponse = await res.json();
        setFines(data.fines);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setSummary(data.summary);
        setRatePerDay(data.ratePerDay);
      }
    } finally {
      setIsLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    fetchFines();
  }, [fetchFines]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Tarif resmi (dibaca dari pengaturan). Pustakawan boleh melihatnya.
  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.settings) {
          setRateConfigured(Boolean(d.settings.fineRateConfigured));
          if (typeof d.settings.finePerDayIDR === "number") {
            setRatePerDay(d.settings.finePerDayIDR);
          }
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">{title}</h1>
            <p className="page-description">{subtitle}</p>
          </div>
        </div>

        {/* Tariff */}
        <Card className="card-accent-yellow">
          <CardBody className="flex flex-wrap items-center gap-3">
            <div className="icon-tile icon-tile--yellow" aria-hidden="true">
              <Info size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted">Tarif denda resmi</p>
              <p className="text-lg font-bold text-main">
                {ratePerDay === null ? "Memuat..." : `${rupiah(ratePerDay)} / hari`}
              </p>
            </div>
            <Badge variant={rateConfigured ? "success" : "warning"}>
              {rateConfigured ? "Sudah ditetapkan" : "Nilai bawaan"}
            </Badge>
          </CardBody>
        </Card>

        {/* Summary */}
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
              <div className="relative" style={{ flex: "1 1 240px" }}>
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
                <Input
                  placeholder="Cari nama, email, judul buku, ISBN..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9"
                />
              </div>
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
              <Button variant="secondary" onClick={() => { setStatus("UNPAID"); setPage(1); }} size="sm">
                <AlertTriangle size={14} />
                Belum Lunas
              </Button>
              <Button variant="ghost" onClick={fetchFines} size="sm">
                <RefreshCw size={14} />
                Refresh
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="card-accent-purple">
          <CardHeader>
            <CardTitle>Daftar Denda</CardTitle>
            <CardDescription>
            {total} transaksi berdenda · {summary.unpaidCount} belum lunas
            {summary.partialCount > 0 ? ` · ${summary.partialCount} dibayar sebagian` : ""}
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <LoadingState message="Memuat data denda..." />
          ) : fines.length === 0 ? (
            <EmptyState
              title="Tidak ada denda"
              description={search || status ? "Tidak ada denda yang sesuai dengan filter." : "Belum ada transaksi dengan denda."}
            />
          ) : (
            <TableContainer className="border-none shadow-none rounded-none">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Peminjam</Th>
                    <Th>Buku</Th>
                    <Th>Tgl Kembali</Th>
                    <Th>Telat</Th>
                    <Th>Denda</Th>
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
                            <p className="font-medium text-main">{f.user.name}</p>
                            <p className="text-xs text-muted">{f.user.role}{f.user.class ? ` · ${f.user.class}` : ""}</p>
                          </div>
                        </Td>
                        <Td>
                          <div>
                            <p className="font-medium text-main line-clamp-1">{f.book.title}</p>
                            <p className="text-xs text-muted">{f.book.author}</p>
                          </div>
                        </Td>
                        <Td className="text-sm">
                          {f.returnDate
                            ? new Date(f.returnDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                            : "-"}
                        </Td>
                        <Td className="text-sm">{f.daysLate} hari</Td>
                        <Td className="text-sm font-medium">
                          {rupiah(f.fineAmount)}
                          {(f.lateFineAmount ?? 0) > 0 && (f.damageFineAmount ?? 0) > 0 && (
                            <p className="text-xs text-muted font-normal">
                              Telat {rupiah(f.lateFineAmount!)} · Kerusakan {rupiah(f.damageFineAmount!)}
                            </p>
                          )}
                        </Td>
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => setSelectedBorrow(f)}
                              className="row-action hover:bg-base hover:text-main transition-colors"
                              title="Lihat Detail"
                            >
                              <Eye size={16} />
                            </button>
                            {!lunas && (
                              <button
                                onClick={() => setPayFineBorrow(f)}
                                className="row-action hover:bg-warning-bg hover:text-warning transition-colors"
                                title="Catat Pembayaran Denda"
                              >
                                <Coins size={16} />
                              </button>
                            )}
                          </div>
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

      {selectedBorrow && (
        <BorrowDetailModal
          isOpen={!!selectedBorrow}
          borrowId={selectedBorrow.id}
          onClose={() => setSelectedBorrow(null)}
        />
      )}

      {payFineBorrow && (
        <PayFineDialog
          isOpen={!!payFineBorrow}
          borrowId={payFineBorrow.id}
          onClose={() => setPayFineBorrow(null)}
          onSuccess={() => { setPayFineBorrow(null); fetchFines(); }}
        />
      )}
    </DashboardLayout>
  );
}
