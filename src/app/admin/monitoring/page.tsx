"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { BookOpen, BookMarked, FileText, RefreshCw, Users, History } from "lucide-react";

interface MonitoredUser {
  name: string;
  role: string;
  class: string | null;
  identityNumber: string | null;
}

interface BorrowRow {
  id: string;
  user: MonitoredUser;
  book: { title: string; author: string };
  borrowDate: string;
  dueDate: string;
  returnDate: string | null;
  status: string;
  effectiveStatus: string;
}

interface EbookRow {
  id: string;
  user: MonitoredUser;
  book: { title: string; author: string };
  borrowedAt: string;
  expiresAt: string;
  returnedAt: string | null;
  status: string;
}

interface MonitoringResponse {
  summary: {
    studentActiveBorrows: number;
    teacherActiveBorrows: number;
    studentTotalBorrows: number;
    teacherTotalBorrows: number;
    activeEbookLoans: number;
    totalTransactions: number;
    totalPhysicalBorrows: number;
    totalEbookLoans: number;
  };
  borrows: BorrowRow[];
  ebookLoans: EbookRow[];
}

const ROLE_LABELS: Record<string, string> = {
  STUDENT: "Siswa",
  TEACHER: "Guru",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function borrowBadge(status: string) {
  switch (status) {
    case "BORROWED":
      return <Badge variant="info">Dipinjam</Badge>;
    case "OVERDUE":
      return <Badge variant="danger">Terlambat</Badge>;
    case "RETURNED":
      return <Badge variant="success">Dikembalikan</Badge>;
    case "REQUESTED":
      return <Badge variant="warning">Menunggu Persetujuan</Badge>;
    case "CANCELLED":
      return <Badge variant="warning">Dibatalkan</Badge>;
    case "REJECTED":
      return <Badge variant="danger">Ditolak</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function ebookBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return <Badge variant="info">Masa Akses Aktif</Badge>;
    case "EXPIRED":
      return <Badge variant="warning">Kedaluwarsa</Badge>;
    case "RETURNED":
      return <Badge variant="success">Dikembalikan</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function userCell(user: MonitoredUser) {
  return (
    <div>
      <p className="font-medium text-main">{user.name}</p>
      <p className="text-xs text-muted">
        {ROLE_LABELS[user.role] ?? user.role}
        {user.class ? ` · ${user.class}` : ""}
        {user.identityNumber ? ` · ${user.identityNumber}` : ""}
      </p>
    </div>
  );
}

export default function AdminMonitoringPage() {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/monitoring", { cache: "no-store" });
      if (!res.ok) throw new Error("Gagal memuat data monitoring");
      const json = (await res.json()) as MonitoringResponse;
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const activeEbooks = useMemo(
    () => (data?.ebookLoans ?? []).filter((loan) => loan.status === "ACTIVE"),
    [data]
  );

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading flex items-center gap-2">
              <Users size={24} className="flex-shrink-0" aria-hidden="true" /> Monitoring Aktivitas
            </h1>
            <p className="page-description">
              Aktivitas peminjaman dan masa akses ebook Siswa serta Guru.
              Aktivitas membaca rinci ada di menu Aktivitas Membaca.
            </p>
          </div>
          <div className="page-actions">
            <Button variant="secondary" onClick={fetchData}>
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <LoadingState message="Memuat data monitoring..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchData} />
        ) : data ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="stat-card">
                <div className="stat-card__icon icon-tile--blue" aria-hidden="true">
                  <BookMarked size={22} />
                </div>
                <div className="min-w-0">
                  <p className="stat-card__label">Pinjaman Aktif Siswa</p>
                  <p className="stat-card__value">{data.summary.studentActiveBorrows}</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon icon-tile--green" aria-hidden="true">
                  <BookMarked size={22} />
                </div>
                <div className="min-w-0">
                  <p className="stat-card__label">Pinjaman Aktif Guru</p>
                  <p className="stat-card__value">{data.summary.teacherActiveBorrows}</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon icon-tile--purple" aria-hidden="true">
                  <FileText size={22} />
                </div>
                <div className="min-w-0">
                  <p className="stat-card__label">Ebook Masa Akses Aktif</p>
                  <p className="stat-card__value">{data.summary.activeEbookLoans}</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon icon-tile--yellow" aria-hidden="true">
                  <History size={22} />
                </div>
                <div className="min-w-0">
                  <p className="stat-card__label">Total Transaksi Keseluruhan</p>
                  <p className="stat-card__value">{data.summary.totalTransactions}</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon icon-tile--blue" aria-hidden="true">
                  <BookOpen size={22} />
                </div>
                <div className="min-w-0">
                  <p className="stat-card__label">Total Transaksi Buku Fisik</p>
                  <p className="stat-card__value">{data.summary.totalPhysicalBorrows}</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon icon-tile--green" aria-hidden="true">
                  <FileText size={22} />
                </div>
                <div className="min-w-0">
                  <p className="stat-card__label">Total Transaksi Ebook</p>
                  <p className="stat-card__value">{data.summary.totalEbookLoans}</p>
                </div>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Peminjaman Buku Fisik</CardTitle>
                <CardDescription>
                  {data.borrows.length} transaksi terbaru Siswa dan Guru.
                </CardDescription>
              </CardHeader>
              <CardBody className="p-0">
                {data.borrows.length === 0 ? (
                  <EmptyState
                    title="Belum ada aktivitas"
                    description="Belum ada transaksi peminjaman dari Siswa atau Guru."
                  />
                ) : (
                  <TableContainer className="border-none shadow-none rounded-none">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Pengguna</Th>
                          <Th>Buku</Th>
                          <Th>Tgl Pinjam</Th>
                          <Th>Tenggat</Th>
                          <Th>Dikembalikan</Th>
                          <Th>Status</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {data.borrows.map((borrow) => (
                          <Tr key={borrow.id}>
                            <Td>{userCell(borrow.user)}</Td>
                            <Td>
                              <p className="font-medium text-main line-clamp-1">{borrow.book.title}</p>
                              <p className="text-xs text-muted">{borrow.book.author}</p>
                            </Td>
                            <Td className="text-sm">{formatDate(borrow.borrowDate)}</Td>
                            <Td className="text-sm">{formatDate(borrow.dueDate)}</Td>
                            <Td className="text-sm">{formatDate(borrow.returnDate)}</Td>
                            <Td>{borrowBadge(borrow.effectiveStatus)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </TableContainer>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ebook Masa Akses Aktif</CardTitle>
                <CardDescription>
                  {activeEbooks.length} peminjaman ebook dengan masa akses aktif Siswa dan Guru.
                </CardDescription>
              </CardHeader>
              <CardBody className="p-0">
                {activeEbooks.length === 0 ? (
                  <EmptyState
                    title="Tidak ada ebook aktif"
                    description="Saat ini tidak ada Siswa atau Guru dengan masa akses ebook aktif."
                  />
                ) : (
                  <TableContainer className="border-none shadow-none rounded-none">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Pengguna</Th>
                          <Th>Ebook</Th>
                          <Th>Mulai Akses</Th>
                          <Th>Akses Berakhir</Th>
                          <Th>Status</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {activeEbooks.map((loan) => (
                          <Tr key={loan.id}>
                            <Td>{userCell(loan.user)}</Td>
                            <Td>
                              <p className="font-medium text-main line-clamp-1">{loan.book.title}</p>
                              <p className="text-xs text-muted">{loan.book.author}</p>
                            </Td>
                            <Td className="text-sm">{formatDate(loan.borrowedAt)}</Td>
                            <Td className="text-sm">{formatDate(loan.expiresAt)}</Td>
                            <Td>{ebookBadge(loan.status)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </TableContainer>
                )}
              </CardBody>
            </Card>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
