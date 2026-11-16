"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line 
} from "recharts";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { LoadingState } from "@/components/ui/LoadingState";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { 
  BookOpen, Users, ArrowRightLeft, AlertTriangle, Download, Calendar, TrendingUp, Award, Coins, Clock
} from "lucide-react";

interface ReportData {
  stats: {
    totalBooks: number;
    totalUsers: number;
    totalBorrows: number;
    activeBorrows: number;
    pendingRequests?: number;
    overdueBooks: number;
    returns: number;
    fineAssessed?: number;
    fineCollected?: number;
    fineOutstanding?: number;
  };
  chartData: { date: string; borrows: number; returns: number }[];
  topBooks: { title: string; count: number; categoryId: string | null }[];
  topCategories: { name: string; count: number }[];
  exportList: any[];
}

export default function ReportsDashboard() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30days"); // today, 7days, 30days, year, all

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      let startDateStr = "";
      let endDateStr = new Date().toISOString();
      const now = new Date();

      switch (period) {
        case "today":
          startDateStr = new Date(now.setHours(0,0,0,0)).toISOString();
          break;
        case "7days":
          startDateStr = new Date(now.setDate(now.getDate() - 7)).toISOString();
          break;
        case "30days":
          startDateStr = new Date(now.setDate(now.getDate() - 30)).toISOString();
          break;
        case "year":
          startDateStr = new Date(now.getFullYear(), 0, 1).toISOString();
          break;
        default:
          startDateStr = "";
          endDateStr = "";
      }

      const params = new URLSearchParams();
      if (startDateStr) params.append("startDate", startDateStr);
      if (endDateStr) params.append("endDate", endDateStr);

      const res = await fetch(`/api/admin/reports?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const exportToCSV = () => {
    if (!data?.exportList || data.exportList.length === 0) return;

    const headers = ["ID", "Peminjam", "Role", "Buku", "Tgl Pinjam", "Tenggat", "Tgl Kembali", "Status", "Denda (Rp)", "Denda Dibayar"];
    const csvContent = [
      headers.join(","),
      ...data.exportList.map(row => {
        return [
          `"${row.id}"`,
          `"${row.user.name}"`,
          `"${row.user.role}"`,
          `"${row.book.title.replace(/"/g, '""')}"`, // escape quotes
          `"${new Date(row.borrowDate).toLocaleDateString("id-ID")}"`,
          `"${new Date(row.dueDate).toLocaleDateString("id-ID")}"`,
          `"${row.returnDate ? new Date(row.returnDate).toLocaleDateString("id-ID") : ""}"`,
          `"${row.status}"`,
          `"${row.fineAmount ?? 0}"`,
          `"${row.finePaid ? "Ya" : "Tidak"}"`
        ].join(",");
      })
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Laporan_Perpustakaan_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading && !data) {
    return <div className="py-20"><LoadingState message="Menyiapkan data laporan..." /></div>;
  }

  return (
    <div className="page-shell relative">
      {/* Header & Filter */}
      <div className="page-header pastel-panel pastel-panel--purple p-5 sm:p-6">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <TrendingUp className="text-primary flex-shrink-0" aria-hidden="true" /> Analitik &amp; Laporan
          </h1>
          <p className="page-description">Pantau statistik dan aktivitas perpustakaan</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 bg-surface border border-border px-3 rounded-xl flex-1 sm:flex-none">
            <Calendar size={16} className="text-muted flex-shrink-0" aria-hidden="true" />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Pilih periode laporan"
              className="bg-transparent py-2.5 text-sm text-main font-medium focus:outline-none w-full appearance-none"
            >
              <option value="today">Hari Ini</option>
              <option value="7days">7 Hari Terakhir</option>
              <option value="30days">30 Hari Terakhir</option>
              <option value="year">Tahun Ini</option>
              <option value="all">Semua Waktu</option>
            </select>
          </div>
          <Button onClick={exportToCSV} variant="secondary" className="flex-shrink-0" disabled={!data || data.exportList.length === 0}>
            <Download size={16} className="mr-2" /> Ekspor CSV
          </Button>
        </div>
      </div>

      {loading && data && (
        <div className="absolute inset-0 bg-white/90 backdrop-blur-md z-10 flex items-center justify-center rounded-2xl">
          <LoadingState message="Memperbarui..." />
        </div>
      )}

      {data && (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="stat-card">
              <div className="stat-card__icon icon-tile--purple" aria-hidden="true"><BookOpen size={24} /></div>
              <div className="min-w-0">
                <p className="stat-card__label">Total Koleksi</p>
                <p className="stat-card__value">{data.stats.totalBooks}</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__icon icon-tile--green" aria-hidden="true"><Users size={24} /></div>
              <div className="min-w-0">
                <p className="stat-card__label">Pengguna Aktif</p>
                <p className="stat-card__value">{data.stats.totalUsers}</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__icon icon-tile--blue" aria-hidden="true"><ArrowRightLeft size={24} /></div>
              <div className="min-w-0">
                <p className="stat-card__label">Transaksi Aktif</p>
                <p className="stat-card__value">{data.stats.activeBorrows}</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__icon icon-tile--danger" aria-hidden="true"><AlertTriangle size={24} /></div>
              <div className="min-w-0">
                <p className="stat-card__label">Buku Terlambat</p>
                <p className="stat-card__value">{data.stats.overdueBooks}</p>
              </div>
            </div>
          </div>

          {/* Main Chart */}
          <Card className="overflow-hidden card-accent-purple">
            <CardHeader className="border-b border-border bg-surface-purple">
              <CardTitle> Aktivitas Peminjaman &amp; Pengembalian</CardTitle>
            </CardHeader>
            <CardBody className="p-4 sm:p-6">
              {data.chartData.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-muted text-sm text-center px-4">
                  Tidak ada data aktivitas untuk periode ini.
                </div>
              ) : (
                <div className="h-[300px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(val) => {
                          const d = new Date(val);
                          return `${d.getDate()}/${d.getMonth()+1}`;
                        }}
                        style={{ fontSize: '12px', fill: 'var(--color-text-muted)' }}
                      />
                      <YAxis 
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        style={{ fontSize: '12px', fill: 'var(--color-text-muted)' }}
                      />
                      <RechartsTooltip 
                        contentStyle={{ borderRadius: '12px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-main)' }}
                        labelFormatter={(l) => new Date(String(l)).toLocaleDateString("id-ID", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                      <Bar dataKey="borrows" name="Dipinjam" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Bar dataKey="returns" name="Dikembalikan" fill="var(--color-accent-green)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Leaderboards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Books */}
            <Card className="card-accent-yellow">
              <CardHeader className="border-b border-border bg-surface-yellow">
                <CardTitle className="flex items-center gap-2"><Award className="text-accent-yellow" size={18} aria-hidden="true" /> Buku Paling Populer</CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                {data.topBooks.length === 0 ? (
                  <div className="p-6 text-center text-muted text-sm">Belum ada data peminjaman buku.</div>
                ) : (
                  <TableContainer className="border-none shadow-none rounded-none">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Judul Buku</Th>
                          <Th className="text-right">Total Dipinjam</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {data.topBooks.map((book, i) => (
                          <Tr key={i}>
                            <Td className="font-medium text-main">{book.title}</Td>
                            <Td className="text-right font-bold text-primary">{book.count} kali</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </TableContainer>
                )}
              </CardBody>
            </Card>

            {/* Top Categories */}
            <Card className="card-accent-blue">
              <CardHeader className="border-b border-border bg-surface-blue">
                <CardTitle className="flex items-center gap-2"><Award className="text-info" size={18} aria-hidden="true" /> Kategori Favorit</CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                {data.topCategories.length === 0 ? (
                  <div className="p-6 text-center text-muted text-sm">Belum ada data kategori.</div>
                ) : (
                  <TableContainer className="border-none shadow-none rounded-none">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Kategori</Th>
                          <Th className="text-right">Total Transaksi</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {data.topCategories.map((cat, i) => (
                          <Tr key={i}>
                            <Td className="font-medium text-main">{cat.name}</Td>
                            <Td className="text-right font-bold text-primary">{cat.count}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </TableContainer>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Fines & Requests Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="stat-card">
              <div className="stat-card__icon icon-tile--yellow" aria-hidden="true"><Clock size={24} /></div>
              <div className="min-w-0">
                <p className="stat-card__label">Pengajuan Menunggu</p>
                <p className="stat-card__value">{data.stats.pendingRequests ?? 0}</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__icon icon-tile--danger" aria-hidden="true"><Coins size={24} /></div>
              <div className="min-w-0">
                <p className="stat-card__label">Total Denda</p>
                <p className="stat-card__value text-lg sm:text-xl">
                  Rp {(data.stats.fineAssessed ?? 0).toLocaleString("id-ID")}
                </p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__icon icon-tile--green" aria-hidden="true"><Coins size={24} /></div>
              <div className="min-w-0">
                <p className="stat-card__label">Denda Dibayar</p>
                <p className="stat-card__value text-lg sm:text-xl">
                  Rp {(data.stats.fineCollected ?? 0).toLocaleString("id-ID")}
                </p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__icon icon-tile--danger" aria-hidden="true"><AlertTriangle size={24} /></div>
              <div className="min-w-0">
                <p className="stat-card__label">Denda Belum Dibayar</p>
                <p className="stat-card__value text-lg sm:text-xl">
                  Rp {(data.stats.fineOutstanding ?? 0).toLocaleString("id-ID")}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
