"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { ScrollText, Search } from "lucide-react";

interface AuditLog {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string } | null;
}

const ACTION_LABELS: Record<string, string> = {
  CREATE_USER: "Tambah Pengguna",
  UPDATE_USER: "Ubah Pengguna",
  DELETE_USER: "Hapus Pengguna",
  USER_DELETED: "Hapus Pengguna",
  DEACTIVATE_USER: "Nonaktifkan Pengguna",
  USER_DEACTIVATED: "Nonaktifkan Pengguna",
  RESET_PASSWORD: "Reset Password",
  UPDATE_PROFILE: "Ubah Profil",
  CREATE_BOOK: "Tambah Koleksi",
  UPDATE_BOOK: "Ubah Koleksi",
  DELETE_BOOK: "Hapus Koleksi",
  CREATE_CATEGORY: "Tambah Kategori",
  UPDATE_CATEGORY: "Ubah Kategori",
  DELETE_CATEGORY: "Hapus Kategori",
  CREATE_BORROW: "Peminjaman Buku",
  REQUEST_BORROW: "Pengajuan Peminjaman",
  APPROVE_BORROW: "Setujui Peminjaman",
  REJECT_BORROW: "Tolak Peminjaman",
  RETURN_BOOK: "Pengembalian Buku",
  CANCEL_BORROW: "Batalkan Peminjaman",
  PAY_FINE: "Pembayaran Denda",
  UPDATE_SETTINGS: "Ubah Pengaturan",
  BORROW_EBOOK: "Pinjam Ebook",
  RETURN_EBOOK: "Kembalikan Ebook",
};

export default function AuditLogView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actions, setActions] = useState<{ action: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (search) params.set("search", search);
      if (actionFilter) params.set("action", actionFilter);

      const res = await fetch(`/api/admin/audit?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Gagal memuat audit log");
      }
      const data = await res.json();
      setLogs(data.logs || []);
      setTotalPages(data.totalPages || 1);
      setActions(data.actions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }, [page, search, actionFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset ke halaman 1 ketika filter berubah.
  useEffect(() => {
    setPage(1);
  }, [search, actionFilter]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <ScrollText className="text-primary flex-shrink-0" aria-hidden="true" /> Audit Log
          </h1>
          <p className="page-description">Riwayat tindakan administratif dan aktivitas penting sistem.</p>
        </div>
      </div>

      <Card className="card-accent-purple">
        <CardHeader className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>Riwayat Aktivitas</CardTitle>
            <CardDescription>Menampilkan catatan terbaru di atas.</CardDescription>
          </div>
          <div className="flex flex-col md:flex-row gap-3 w-full lg:w-auto">
            <Input
              placeholder="Cari aksi / detail / pengguna..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              wrapperClassName="!mb-0 w-full md:flex-1 lg:flex-none lg:w-64"
            />
            <Select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              wrapperClassName="!mb-0 w-full md:flex-1 lg:flex-none lg:w-48"
            >
              <option value="">Semua Aksi</option>
              {actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {(ACTION_LABELS[a.action] || a.action) + ` (${a.count})`}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <LoadingState message="Memuat audit log..." />
          ) : error ? (
            <ErrorState message={error} onRetry={fetchLogs} />
          ) : logs.length === 0 ? (
            <EmptyState
              title="Belum ada catatan"
              description="Belum ada aktivitas yang tercatat sesuai filter ini."
              icon={<Search size={32} />}
            />
          ) : (
            <>
              <TableContainer className="border-none shadow-none rounded-none">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Waktu</Th>
                      <Th>Pelaku</Th>
                      <Th>Aksi</Th>
                      <Th>Detail</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {logs.map((log) => (
                      <Tr key={log.id}>
                        <Td className="whitespace-nowrap text-muted text-sm">
                          {new Date(log.createdAt).toLocaleString("id-ID")}
                        </Td>
                        <Td>
                          {log.user ? (
                            <div>
                              <p className="font-medium text-main">{log.user.name}</p>
                              <p className="text-xs text-muted">{log.user.email}</p>
                            </div>
                          ) : (
                            <span className="text-muted">Sistem</span>
                          )}
                        </Td>
                        <Td>
                          <Badge variant="info">{ACTION_LABELS[log.action] || log.action}</Badge>
                        </Td>
                        <Td className="text-sm text-muted max-w-md">{log.details || "-"}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TableContainer>
              <div className="px-4 border-t border-border">
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
