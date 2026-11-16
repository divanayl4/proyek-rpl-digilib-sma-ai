"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Pagination } from "@/components/ui/Pagination";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { UserDetailModal } from "@/components/users/UserDetailModal";
import { Search, Filter, Eye, Users } from "lucide-react";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  identityNumber?: string | null;
  class?: string | null;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  LIBRARIAN: "Pustakawan",
  STUDENT: "Siswa",
  TEACHER: "Guru",
  STAFF: "Staf",
};

export default function LibrarianMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchMembers = useCallback(async (p = page, s = search, r = roleFilter) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(p), search: s, role: r });
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error("Gagal memuat data");
      const data = await res.json();
      setMembers(data.users);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchMembers(1, val, roleFilter), 400);
  };

  const handleRoleFilter = (val: string) => {
    setRoleFilter(val);
    setPage(1);
    fetchMembers(1, search, val);
  };

  return (
    <DashboardLayout>
      <div className="page-header mb-6">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <Users size={24} className="flex-shrink-0" aria-hidden="true" /> Data Anggota
          </h1>
          <p className="page-description">
            Total <strong>{total}</strong> anggota perpustakaan. Pustakawan hanya dapat melihat data.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <div className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="form-control pl-9"
              placeholder="Cari nama, email, atau nomor identitas..."
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
            />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <select
              className="form-control pl-9 sm:w-44"
              value={roleFilter}
              onChange={e => handleRoleFilter(e.target.value)}
            >
              <option value="">Semua Anggota</option>
              <option value="STUDENT">Siswa</option>
              <option value="TEACHER">Guru</option>
              <option value="STAFF">Staf</option>
            </select>
          </div>
        </div>
      </Card>

      {loading ? (
        <LoadingState message="Memuat data anggota..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchMembers()} />
      ) : members.length === 0 ? (
        <EmptyState
          title="Tidak ada anggota ditemukan"
          description="Coba ubah filter pencarian."
        />
      ) : (
        <TableContainer>
          <Table>
            <Thead>
              <Tr>
                <Th>Anggota</Th>
                <Th>Role</Th>
                <Th>Nomor Identitas</Th>
                <Th>Kelas</Th>
                <Th>Status</Th>
                <Th>Terdaftar</Th>
                <Th className="text-right">Detail</Th>
              </Tr>
            </Thead>
            <Tbody>
              {members.map(member => (
                <Tr key={member.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary-100 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-main text-sm">{member.name}</p>
                        <p className="text-xs text-muted">{member.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Badge variant="info">{ROLE_LABELS[member.role] || member.role}</Badge>
                  </Td>
                  <Td className="text-sm text-muted">{member.identityNumber || <span className="italic">—</span>}</Td>
                  <Td className="text-sm text-muted">{member.class || <span className="italic">—</span>}</Td>
                  <Td>
                    <Badge variant={member.isActive ? "success" : "danger"}>
                      {member.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </Td>
                  <Td className="text-sm text-muted">
                    {new Date(member.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                  </Td>
                  <Td>
                    <div className="flex justify-end">
                      <button
                        title="Lihat Detail"
                        onClick={() => setDetailUserId(member.id)}
                        className="row-action hover:bg-base hover:text-primary transition-colors"
                      >
                        <Eye size={16} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <div className="px-6 py-2 border-t border-border">
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={p => { setPage(p); fetchMembers(p); }} />
          </div>
        </TableContainer>
      )}

      <UserDetailModal
        isOpen={!!detailUserId}
        onClose={() => setDetailUserId(null)}
        userId={detailUserId}
      />
    </DashboardLayout>
  );
}
