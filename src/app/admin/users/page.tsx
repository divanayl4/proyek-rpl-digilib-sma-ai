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
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { UserFormModal } from "@/components/users/UserFormModal";
import { ResetPasswordModal } from "@/components/users/ResetPasswordModal";
import { UserDetailModal } from "@/components/users/UserDetailModal";
import {
  Plus, Search, Filter, Eye, Edit2, Trash2,
  ToggleLeft, ToggleRight, KeyRound, Users
} from "lucide-react";

interface User {
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
  ADMIN: "Administrator",
  LIBRARIAN: "Pustakawan",
  STUDENT: "Siswa",
  TEACHER: "Guru",
  STAFF: "Staf",
};

const ROLE_BADGE_VARIANTS: Record<string, "info" | "success" | "warning" | "danger"> = {
  ADMIN: "danger",
  LIBRARIAN: "warning",
  STUDENT: "info",
  TEACHER: "success",
  STAFF: "info",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [toggleUser, setToggleUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const fetchUsers = useCallback(async (p = page, s = search, r = roleFilter, inc = showInactive) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(p), search: s, role: r, includeInactive: String(inc) });
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error("Gagal memuat data");
      const data = await res.json();
      setUsers(data.users);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, showInactive]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchUsers(1, val, roleFilter), 400);
  };

  const handleRoleFilterChange = (val: string) => {
    setRoleFilter(val);
    setPage(1);
    fetchUsers(1, search, val);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    fetchUsers(p, search, roleFilter);
  };

  const handleToggleStatus = async () => {
    if (!toggleUser) return;
    try {
      const res = await fetch(`/api/admin/users/${toggleUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !toggleUser.isActive }),
      });
      if (res.ok) {
        setToggleUser(null);
        fetchUsers();
      }
    } catch { /* handled by UI */ }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    try {
      const res = await fetch(`/api/admin/users/${deleteUser.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDeleteUser(null);
        fetchUsers();
      } else {
        setError(data.error || "Gagal menghapus pengguna");
        setDeleteUser(null);
      }
    } catch {
      setError("Terjadi kesalahan koneksi");
      setDeleteUser(null);
    }
  };

  return (
    <DashboardLayout>
      {/* Header */}
      <div className="page-header mb-6">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <Users size={24} className="flex-shrink-0" aria-hidden="true" /> Manajemen Pengguna
          </h1>
          <p className="page-description">
            Total <strong>{total}</strong> pengguna terdaftar
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowAddModal(true)}>
            <Plus size={18} /> Tambah Pengguna
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
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
              className="form-control pl-9 sm:w-48"
              value={roleFilter}
              onChange={e => handleRoleFilterChange(e.target.value)}
            >
              <option value="">Semua Role</option>
              <option value="ADMIN">Administrator</option>
              <option value="LIBRARIAN">Pustakawan</option>
              <option value="STUDENT">Siswa</option>
              <option value="TEACHER">Guru</option>
              <option value="STAFF">Staf</option>
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-muted whitespace-nowrap self-center">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => { setShowInactive(e.target.checked); setPage(1); fetchUsers(1, search, roleFilter, e.target.checked); }}
            />
            Tampilkan nonaktif
          </label>
        </div>
      </Card>

      {/* Table */}
      {loading ? (
        <LoadingState message="Memuat daftar pengguna..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchUsers()} />
      ) : users.length === 0 ? (
        <EmptyState
          title="Tidak ada pengguna ditemukan"
          description={search || roleFilter ? "Coba ubah filter pencarian Anda." : "Mulai dengan menambahkan pengguna baru."}
          action={!search && !roleFilter ? <Button onClick={() => setShowAddModal(true)}><Plus size={16} /> Tambah Pengguna</Button> : undefined}
        />
      ) : (
        <TableContainer>
          <Table>
            <Thead>
              <Tr>
                <Th>Pengguna</Th>
                <Th>Role</Th>
                <Th>Identitas</Th>
                <Th>Kelas</Th>
                <Th>Status</Th>
                <Th>Terdaftar</Th>
                <Th className="text-right">Aksi</Th>
              </Tr>
            </Thead>
            <Tbody>
              {users.map(user => (
                <Tr key={user.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary-100 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-main text-sm">{user.name}</p>
                        <p className="text-xs text-muted">{user.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Badge variant={ROLE_BADGE_VARIANTS[user.role] || "info"}>
                      {ROLE_LABELS[user.role] || user.role}
                    </Badge>
                  </Td>
                  <Td className="text-sm text-muted">{user.identityNumber || <span className="italic">—</span>}</Td>
                  <Td className="text-sm text-muted">{user.class || <span className="italic">—</span>}</Td>
                  <Td>
                    <Badge variant={user.isActive ? "success" : "danger"}>
                      {user.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </Td>
                  <Td className="text-sm text-muted">
                    {new Date(user.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Lihat Detail"
                        onClick={() => setDetailUserId(user.id)}
                        className="row-action hover:bg-base hover:text-primary transition-colors"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        title="Edit"
                        onClick={() => setEditUser(user)}
                        className="row-action hover:bg-base hover:text-primary transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        title={user.isActive ? "Nonaktifkan" : "Aktifkan"}
                        onClick={() => setToggleUser(user)}
                        className={`row-action transition-colors ${user.isActive ? "text-warning-text hover:bg-warning-bg" : "text-success hover:bg-success-bg"}`}
                      >
                        {user.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      <button
                        title="Reset Password"
                        onClick={() => setResetPasswordUser(user)}
                        className="row-action hover:bg-base hover:text-info transition-colors"
                      >
                        <KeyRound size={16} />
                      </button>
                      <button
                        title="Hapus"
                        onClick={() => setDeleteUser(user)}
                        className="row-action hover:bg-danger-bg hover:text-danger transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <div className="px-6 py-2 border-t border-border">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </div>
        </TableContainer>
      )}

      {/* Modals */}
      <UserFormModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => fetchUsers()}
      />

      <UserFormModal
        isOpen={!!editUser}
        onClose={() => setEditUser(null)}
        onSuccess={() => { setEditUser(null); fetchUsers(); }}
        editUser={editUser}
      />

      <UserDetailModal
        isOpen={!!detailUserId}
        onClose={() => setDetailUserId(null)}
        userId={detailUserId}
      />

      {resetPasswordUser && (
        <ResetPasswordModal
          isOpen={!!resetPasswordUser}
          onClose={() => setResetPasswordUser(null)}
          userId={resetPasswordUser.id}
          userName={resetPasswordUser.name}
        />
      )}

      <ConfirmationDialog
        isOpen={!!toggleUser}
        onClose={() => setToggleUser(null)}
        onConfirm={handleToggleStatus}
        title={toggleUser?.isActive ? "Nonaktifkan Pengguna?" : "Aktifkan Pengguna?"}
        message={toggleUser?.isActive
          ? `Pengguna "${toggleUser?.name}" akan dinonaktifkan dan tidak bisa login. Lanjutkan?`
          : `Pengguna "${toggleUser?.name}" akan diaktifkan kembali. Lanjutkan?`
        }
        confirmText={toggleUser?.isActive ? "Ya, Nonaktifkan" : "Ya, Aktifkan"}
        isDestructive={toggleUser?.isActive}
      />

      <ConfirmationDialog
        isOpen={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
        title="Hapus Pengguna?"
        message={`Tindakan ini permanen dan tidak dapat dibatalkan. Pengguna "${deleteUser?.name}" beserta semua data terkait akan dihapus.`}
        confirmText="Ya, Hapus Permanen"
        isDestructive
      />
    </DashboardLayout>
  );
}
