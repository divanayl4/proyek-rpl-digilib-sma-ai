"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import {
  Table,
  Tbody,
  TableContainer,
  Thead,
  Tr,
  Th,
  Td,
} from "@/components/ui/Table";
import {
  Activity,
  BookMarked,
  BookOpen,
  Clock3,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

type TabKey = "reading" | "history";

const ACCESS_HISTORY_NOTICE =
  "Data ini berasal dari riwayat peminjaman ebook. Data membuktikan peminjaman atau masa akses, bukan bukti bahwa ebook benar-benar dibuka atau dibaca.";

interface ActivityRow {
  id: string;
  user: {
    id: string;
    name: string;
    role: string;
    class: string | null;
    identityNumber: string | null;
  };
  book: {
    id: string;
    title: string;
    author: string;
    pageCount: number | null;
  };
  loan: {
    id: string;
    borrowedAt: string;
    expiresAt: string;
    returnedAt: string | null;
    accessState: string;
  } | null;
  firstOpenedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  status: string;
  activityCount: number;
  lastPage: number | null;
  progressPercent: number | null;
  progressAvailable: boolean;
}

interface ActivityResponse {
  rows: ActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    totalSessions: number;
    uniqueUsers: number;
    uniqueBooks: number;
    activeSessions: number;
    openedSessions: number;
    inactiveSessions: number;
  };
  period: { key: string; label: string };
  pageTrackingSupported: boolean;
}

interface AccessHistoryRow {
  id: string;
  user: {
    id: string;
    name: string;
    role: string;
    class: string | null;
    identityNumber: string | null;
  };
  book: {
    id: string;
    title: string;
    author: string;
    format: string;
    archivedAt: string | null;
    isArchived: boolean;
  };
  borrowedAt: string;
  expiresAt: string;
  returnedAt: string | null;
  status: string;
}

interface AccessHistoryResponse {
  source: string;
  readingEvidence: boolean;
  notice: string;
  rows: AccessHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    totalLoans: number;
    uniqueUsers: number;
    uniqueBooks: number;
    activeLoans: number;
    returnedLoans: number;
    expiredLoans: number;
  };
  period: { key: string; label: string; start: string | null; end: string | null };
  filters: { search: string; status: string; period: string };
}

const ROLE_LABELS: Record<string, string> = {
  STUDENT: "Siswa",
  TEACHER: "Guru",
  LIBRARIAN: "Pustakawan",
  ADMIN: "Administrator",
  STAFF: "Staf",
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return <Badge variant="success">Aktivitas terbaru</Badge>;
    case "OPENED":
      return <Badge variant="info">Baru dibuka</Badge>;
    case "INACTIVE":
      return <Badge variant="warning">Tidak aktif</Badge>;
    default:
      return <Badge>Belum ada data</Badge>;
  }
}

function loanStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return <Badge variant="success">Masa akses aktif</Badge>;
    case "RETURNED":
      return <Badge variant="info">Dikembalikan</Badge>;
    case "EXPIRED":
      return <Badge variant="warning">Kedaluwarsa</Badge>;
    default:
      return <Badge>Status tidak diketahui</Badge>;
  }
}

function loanLabel(loan: ActivityRow["loan"]) {
  if (!loan) return "Tanpa pinjaman (pengelola)";
  switch (loan.accessState) {
    case "ACTIVE":
      return `Masa akses aktif s.d. ${formatDateTime(loan.expiresAt)}`;
    case "RETURNED":
      return "Sudah dikembalikan";
    case "EXPIRED":
      return "Masa akses kedaluwarsa";
    default:
      return "Tidak ada pinjaman";
  }
}

export default function AdminEbookActivityPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("reading");

  // Tab aktivitas membaca: sumbernya tetap EbookReadingSession.
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [period, setPeriod] = useState("30d");
  const [page, setPage] = useState(1);

  // Tab riwayat peminjaman: sumbernya EbookLoan, terpisah dari sesi baca.
  const [historyData, setHistoryData] = useState<AccessHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySearchInput, setHistorySearchInput] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("ALL");
  const [historyPeriod, setHistoryPeriod] = useState("30d");
  const [historyPage, setHistoryPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        status,
        period,
      });
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/ebook-activity?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error("Halaman ini khusus Administrator.");
        }
        throw new Error("Gagal memuat aktivitas membaca ebook");
      }
      const json = (await res.json()) as ActivityResponse;
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [page, search, status, period]);

  const fetchHistoryData = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const params = new URLSearchParams({
        page: String(historyPage),
        pageSize: "20",
        status: historyStatus,
        period: historyPeriod,
      });
      if (historySearch) params.set("search", historySearch);
      const res = await fetch(
        `/api/admin/ebook-access-history?${params.toString()}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error("Halaman ini khusus Administrator.");
        }
        throw new Error("Gagal memuat riwayat peminjaman ebook");
      }
      const json = (await res.json()) as AccessHistoryResponse;
      setHistoryData(json);
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage, historySearch, historyStatus, historyPeriod]);

  useEffect(() => {
    if (activeTab === "reading") fetchData();
  }, [activeTab, fetchData]);

  useEffect(() => {
    if (activeTab === "history") fetchHistoryData();
  }, [activeTab, fetchHistoryData]);

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const applyHistorySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setHistoryPage(1);
    setHistorySearch(historySearchInput.trim());
  };

  const refreshActiveTab =
    activeTab === "reading" ? fetchData : fetchHistoryData;

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading flex items-center gap-2">
              <Activity size={24} className="flex-shrink-0" aria-hidden="true" />
              Aktivitas Membaca Ebook
            </h1>
            <p className="page-description">
              Sesi baca terverifikasi dan riwayat peminjaman ebook ditampilkan
              terpisah. Khusus Administrator.
            </p>
          </div>
          <div className="page-actions">
            <Badge variant="purple">Khusus Admin</Badge>
            <Button variant="secondary" onClick={refreshActiveTab}>
              <RefreshCw size={16} /> Refresh
            </Button>
          </div>
        </div>

        <div
          className="flex flex-wrap gap-2 mb-4"
          role="tablist"
          aria-label="Data aktivitas ebook"
        >
          <Button
            id="reading-tab"
            role="tab"
            aria-selected={activeTab === "reading"}
            aria-controls="reading-panel"
            variant={activeTab === "reading" ? "primary" : "secondary"}
            onClick={() => setActiveTab("reading")}
          >
            <Activity size={16} /> Aktivitas Membaca
          </Button>
          <Button
            id="history-tab"
            role="tab"
            aria-selected={activeTab === "history"}
            aria-controls="history-panel"
            variant={activeTab === "history" ? "primary" : "secondary"}
            onClick={() => setActiveTab("history")}
          >
            <BookMarked size={16} /> Riwayat Peminjaman/Akses Ebook
          </Button>
        </div>

        {activeTab === "reading" ? (
          <div
            id="reading-panel"
            role="tabpanel"
            aria-labelledby="reading-tab"
          >
            {loading && !data ? (
              <LoadingState message="Memuat aktivitas membaca..." />
            ) : error ? (
              <ErrorState message={error} onRetry={fetchData} />
            ) : data ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="stat-card">
                    <div
                      className="stat-card__icon icon-tile--blue"
                      aria-hidden="true"
                    >
                      <Activity size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="stat-card__label">Total Sesi</p>
                      <p className="stat-card__value">
                        {data.summary.totalSessions}
                      </p>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div
                      className="stat-card__icon icon-tile--green"
                      aria-hidden="true"
                    >
                      <Users size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="stat-card__label">Pengguna Unik</p>
                      <p className="stat-card__value">
                        {data.summary.uniqueUsers}
                      </p>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div
                      className="stat-card__icon icon-tile--purple"
                      aria-hidden="true"
                    >
                      <BookOpen size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="stat-card__label">Ebook Unik</p>
                      <p className="stat-card__value">
                        {data.summary.uniqueBooks}
                      </p>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div
                      className="stat-card__icon icon-tile--yellow"
                      aria-hidden="true"
                    >
                      <Clock3 size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="stat-card__label">
                        Aktif / Dibuka / Tidak Aktif
                      </p>
                      <p className="stat-card__value">
                        {data.summary.activeSessions} /{" "}
                        {data.summary.openedSessions} /{" "}
                        {data.summary.inactiveSessions}
                      </p>
                    </div>
                  </div>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Filter Aktivitas</CardTitle>
                    <CardDescription>
                      Periode dihitung dari waktu aktivitas terakhir. Angka
                      sesi, pengguna unik, dan ebook unik dihitung terpisah.
                    </CardDescription>
                  </CardHeader>
                  <CardBody>
                    <form
                      className="grid grid-cols-1 md:grid-cols-4 gap-3"
                      onSubmit={applySearch}
                    >
                      <Input
                        label="Cari pengguna / ebook"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Nama, kelas, NIS/NIP, judul, penulis..."
                        wrapperClassName="mb-0"
                      />
                      <Select
                        label="Status aktivitas"
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          setPage(1);
                        }}
                        wrapperClassName="mb-0"
                      >
                        <option value="ALL">Semua status</option>
                        <option value="ACTIVE">Aktivitas terbaru</option>
                        <option value="OPENED">Baru dibuka</option>
                        <option value="INACTIVE">Tidak aktif</option>
                      </Select>
                      <Select
                        label="Periode"
                        value={period}
                        onChange={(e) => {
                          setPeriod(e.target.value);
                          setPage(1);
                        }}
                        wrapperClassName="mb-0"
                      >
                        <option value="today">Hari ini</option>
                        <option value="7d">7 hari terakhir</option>
                        <option value="30d">30 hari terakhir</option>
                        <option value="this_month">Bulan ini</option>
                        <option value="last_month">Bulan lalu</option>
                        <option value="this_year">Tahun ini</option>
                        <option value="all">Seluruh periode</option>
                      </Select>
                      <div className="flex items-end">
                        <Button type="submit" className="w-full">
                          <Search size={16} /> Terapkan
                        </Button>
                      </div>
                    </form>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Daftar Sesi Membaca</CardTitle>
                    <CardDescription>
                      {data.total} sesi pada {data.period.label}. Waktu
                      peminjaman dan waktu membaca ditampilkan terpisah.
                    </CardDescription>
                  </CardHeader>
                  <CardBody className="p-0">
                    {data.rows.length === 0 ? (
                      <EmptyState
                        title="Belum ada aktivitas membaca"
                        description="Tidak ada sesi baca yang cocok dengan filter. Data tidak dibuat untuk peminjaman lama."
                        icon={<BookOpen size={30} />}
                      />
                    ) : (
                      <>
                        <TableContainer className="border-none shadow-none rounded-none">
                          <Table>
                            <Thead>
                              <Tr>
                                <Th>Pengguna</Th>
                                <Th>Ebook</Th>
                                <Th>Waktu Membaca</Th>
                                <Th>Status</Th>
                                <Th>Halaman / Progres</Th>
                                <Th>Peminjaman Terkait</Th>
                              </Tr>
                            </Thead>
                            <Tbody>
                              {data.rows.map((row) => (
                                <Tr key={row.id}>
                                  <Td>
                                    <p className="font-medium text-main">
                                      {row.user.name}
                                    </p>
                                    <p className="text-xs text-muted">
                                      {ROLE_LABELS[row.user.role] ??
                                        row.user.role}
                                      {row.user.class
                                        ? ` · ${row.user.class}`
                                        : ""}
                                      {row.user.identityNumber
                                        ? ` · ${row.user.identityNumber}`
                                        : ""}
                                    </p>
                                  </Td>
                                  <Td>
                                    <p className="font-medium text-main line-clamp-1">
                                      {row.book.title}
                                    </p>
                                    <p className="text-xs text-muted">
                                      {row.book.author}
                                    </p>
                                  </Td>
                                  <Td className="text-sm">
                                    <p>
                                      Dibuka: {formatDateTime(row.firstOpenedAt)}
                                    </p>
                                    <p className="text-xs text-muted">
                                      Aktivitas:{" "}
                                      {formatDateTime(row.lastActivityAt)}
                                    </p>
                                    <p className="text-xs text-muted">
                                      {row.activityCount} sinyal aktivitas
                                    </p>
                                  </Td>
                                  <Td>{statusBadge(row.status)}</Td>
                                  <Td className="text-sm">
                                    {row.lastPage !== null ? (
                                      <>
                                        <p>Halaman {row.lastPage}</p>
                                        {row.progressPercent !== null ? (
                                          <p className="text-xs text-muted">
                                            {row.progressPercent}%
                                          </p>
                                        ) : (
                                          <p className="text-xs text-muted">
                                            Total halaman tidak tersedia;
                                            persentase tidak dihitung
                                          </p>
                                        )}
                                      </>
                                    ) : (
                                      <span className="text-xs text-muted">
                                        Belum tercatat
                                      </span>
                                    )}
                                  </Td>
                                  <Td className="text-sm">
                                    <p>{loanLabel(row.loan)}</p>
                                    {row.loan && (
                                      <p className="text-xs text-muted">
                                        Dipinjam:{" "}
                                        {formatDateTime(row.loan.borrowedAt)}
                                      </p>
                                    )}
                                  </Td>
                                </Tr>
                              ))}
                            </Tbody>
                          </Table>
                        </TableContainer>
                        <div className="px-4">
                          <Pagination
                            currentPage={data.page}
                            totalPages={data.totalPages}
                            onPageChange={setPage}
                          />
                        </div>
                      </>
                    )}
                  </CardBody>
                </Card>

                <div className="rounded-xl border border-border bg-bg-subtle p-4 text-xs text-muted">
                  <p className="font-medium text-main mb-1">Catatan data</p>
                  <p>
                    Status “Aktivitas terbaru” berarti ada sinyal aktivitas
                    dalam 30 menit terakhir, bukan bukti pengguna membaca
                    terus-menerus. “Baru dibuka” berarti sesi baru memiliki
                    sinyal pembukaan. Setelah 30 menit tanpa sinyal, sesi
                    menjadi “Tidak aktif”.
                  </p>
                  <p className="mt-2">
                    Nomor halaman dan progres dicatat dari PDF.js viewer yang
                    merender halaman secara langsung. Nilai ini valid dan
                    mencerminkan halaman aktif yang terdeteksi saat membaca.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div
            id="history-panel"
            role="tabpanel"
            aria-labelledby="history-tab"
          >
            {historyLoading && !historyData ? (
              <LoadingState message="Memuat riwayat peminjaman ebook..." />
            ) : historyError ? (
              <ErrorState message={historyError} onRetry={fetchHistoryData} />
            ) : historyData ? (
              <>
                <div className="rounded-xl border border-border bg-bg-subtle p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">
                      Sumber: {historyData.source}
                    </Badge>
                    <Badge variant="warning">Bukan bukti membaca</Badge>
                  </div>
                  <p className="mt-2 text-sm text-main">
                    {historyData.notice || ACCESS_HISTORY_NOTICE}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="stat-card">
                    <div
                      className="stat-card__icon icon-tile--blue"
                      aria-hidden="true"
                    >
                      <BookMarked size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="stat-card__label">Total Peminjaman</p>
                      <p className="stat-card__value">
                        {historyData.summary.totalLoans}
                      </p>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div
                      className="stat-card__icon icon-tile--green"
                      aria-hidden="true"
                    >
                      <Users size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="stat-card__label">Pengguna Unik</p>
                      <p className="stat-card__value">
                        {historyData.summary.uniqueUsers}
                      </p>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div
                      className="stat-card__icon icon-tile--purple"
                      aria-hidden="true"
                    >
                      <BookOpen size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="stat-card__label">Ebook Unik</p>
                      <p className="stat-card__value">
                        {historyData.summary.uniqueBooks}
                      </p>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div
                      className="stat-card__icon icon-tile--yellow"
                      aria-hidden="true"
                    >
                      <Clock3 size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="stat-card__label">
                        Aktif / Dikembalikan / Kedaluwarsa
                      </p>
                      <p className="stat-card__value">
                        {historyData.summary.activeLoans} /{" "}
                        {historyData.summary.returnedLoans} /{" "}
                        {historyData.summary.expiredLoans}
                      </p>
                    </div>
                  </div>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Filter Riwayat Peminjaman</CardTitle>
                    <CardDescription>
                      Periode dihitung dari waktu peminjaman. Sumber data adalah
                      EbookLoan, bukan sesi membaca.
                    </CardDescription>
                  </CardHeader>
                  <CardBody>
                    <form
                      className="grid grid-cols-1 md:grid-cols-4 gap-3"
                      onSubmit={applyHistorySearch}
                    >
                      <Input
                        label="Cari pengguna / ebook"
                        value={historySearchInput}
                        onChange={(e) =>
                          setHistorySearchInput(e.target.value)
                        }
                        placeholder="Nama, kelas, NIS/NIP, judul, penulis..."
                        wrapperClassName="mb-0"
                      />
                      <Select
                        label="Status peminjaman"
                        value={historyStatus}
                        onChange={(e) => {
                          setHistoryStatus(e.target.value);
                          setHistoryPage(1);
                        }}
                        wrapperClassName="mb-0"
                      >
                        <option value="ALL">Semua status</option>
                        <option value="ACTIVE">Masa akses aktif</option>
                        <option value="RETURNED">Dikembalikan</option>
                        <option value="EXPIRED">Kedaluwarsa</option>
                      </Select>
                      <Select
                        label="Periode peminjaman"
                        value={historyPeriod}
                        onChange={(e) => {
                          setHistoryPeriod(e.target.value);
                          setHistoryPage(1);
                        }}
                        wrapperClassName="mb-0"
                      >
                        <option value="today">Hari ini</option>
                        <option value="7d">7 hari terakhir</option>
                        <option value="30d">30 hari terakhir</option>
                        <option value="this_month">Bulan ini</option>
                        <option value="last_month">Bulan lalu</option>
                        <option value="this_year">Tahun ini</option>
                        <option value="all">Seluruh periode</option>
                      </Select>
                      <div className="flex items-end">
                        <Button type="submit" className="w-full">
                          <Search size={16} /> Terapkan
                        </Button>
                      </div>
                    </form>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Daftar Riwayat Peminjaman</CardTitle>
                    <CardDescription>
                      {historyData.total} peminjaman pada{" "}
                      {historyData.period.label}. Data ini bukan aktivitas
                      membaca.
                    </CardDescription>
                  </CardHeader>
                  <CardBody className="p-0">
                    {historyData.rows.length === 0 ? (
                      <EmptyState
                        title="Belum ada riwayat peminjaman"
                        description="Tidak ada peminjaman ebook yang cocok dengan filter. Riwayat ini hanya berasal dari data EbookLoan."
                        icon={<BookMarked size={30} />}
                      />
                    ) : (
                      <>
                        <TableContainer className="border-none shadow-none rounded-none">
                          <Table>
                            <Thead>
                              <Tr>
                                <Th>Pengguna</Th>
                                <Th>Ebook</Th>
                                <Th>Waktu Peminjaman</Th>
                                <Th>Masa Akses Berakhir</Th>
                                <Th>Waktu Pengembalian</Th>
                                <Th>Status Peminjaman</Th>
                              </Tr>
                            </Thead>
                            <Tbody>
                              {historyData.rows.map((row) => (
                                <Tr key={row.id}>
                                  <Td>
                                    <p className="font-medium text-main">
                                      {row.user.name}
                                    </p>
                                    <p className="text-xs text-muted">
                                      {ROLE_LABELS[row.user.role] ??
                                        row.user.role}
                                      {row.user.class
                                        ? ` · ${row.user.class}`
                                        : ""}
                                      {row.user.identityNumber
                                        ? ` · ${row.user.identityNumber}`
                                        : ""}
                                    </p>
                                  </Td>
                                  <Td>
                                    <p className="font-medium text-main line-clamp-1">
                                      {row.book.title}
                                    </p>
                                    <p className="text-xs text-muted">
                                      {row.book.author}
                                    </p>
                                    {row.book.isArchived && (
                                      <Badge
                                        variant="warning"
                                        className="mt-1"
                                      >
                                        Ebook diarsipkan
                                      </Badge>
                                    )}
                                  </Td>
                                  <Td className="text-sm">
                                    {formatDateTime(row.borrowedAt)}
                                  </Td>
                                  <Td className="text-sm">
                                    {formatDateTime(row.expiresAt)}
                                  </Td>
                                  <Td className="text-sm">
                                    {row.returnedAt
                                      ? formatDateTime(row.returnedAt)
                                      : "Belum dikembalikan"}
                                  </Td>
                                  <Td>{loanStatusBadge(row.status)}</Td>
                                </Tr>
                              ))}
                            </Tbody>
                          </Table>
                        </TableContainer>
                        <div className="px-4">
                          <Pagination
                            currentPage={historyData.page}
                            totalPages={historyData.totalPages}
                            onPageChange={setHistoryPage}
                          />
                        </div>
                      </>
                    )}
                  </CardBody>
                </Card>

                <div className="rounded-xl border border-border bg-bg-subtle p-4 text-xs text-muted">
                  <p className="font-medium text-main mb-1">Catatan data</p>
                  <p>
                    Status peminjaman diturunkan dari waktu peminjaman, masa
                    akses, dan waktu pengembalian. Riwayat ini tidak
                    membuktikan ebook dibuka atau dibaca.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
