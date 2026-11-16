"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardBody } from "@/components/ui/Card";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { RefreshCw, UserCheck } from "lucide-react";

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

function roleBadge(role: string) {
  switch (role) {
    case "ADMIN":
      return <Badge variant="danger">Admin</Badge>;
    case "LIBRARIAN":
      return <Badge variant="purple">Pustakawan</Badge>;
    case "TEACHER":
      return <Badge variant="blue">Guru</Badge>;
    case "STUDENT":
      return <Badge variant="green">Siswa</Badge>;
    case "STAFF":
      return <Badge variant="yellow">Staf</Badge>;
    default:
      return <Badge>{role}</Badge>;
  }
}

export default function RecentUsersTable() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users?pageSize=5", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Gagal memuat data pengguna.");
      }
      const json = await res.json();
      setUsers(json.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return (
    <Card className="card-accent-blue">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div className="min-w-0">
          <CardTitle>Pengguna Terbaru</CardTitle>
          <CardDescription>Anggota yang baru saja mendaftar</CardDescription>
        </div>
        <button
          onClick={fetchUsers}
          title="Segarkan daftar pengguna"
          aria-label="Segarkan daftar pengguna"
          className="text-muted hover:text-main p-1 rounded-lg transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </CardHeader>
      <CardBody className="p-0 sm:p-0">
        {loading ? (
          <div className="flex items-center justify-center h-64 m-4 rounded-xl bg-bg-subtle border border-border">
            <LoadingState message="Memuat pengguna terbaru..." />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 m-4 rounded-xl bg-bg-subtle border border-border text-center p-6">
            <p className="text-danger text-sm mb-3">{error}</p>
            <button
              onClick={fetchUsers}
              className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
            >
              <RefreshCw size={14} /> Coba lagi
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="flex items-center justify-center h-64 m-4 rounded-xl bg-bg-subtle border border-border text-center p-6">
            <p className="text-muted text-sm">Belum ada pengguna yang mendaftar</p>
          </div>
        ) : (
          <TableContainer className="border-none shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Nama Pengguna</Th>
                  <Th>Role</Th>
                  <Th>Pendaftaran</Th>
                </Tr>
              </Thead>
              <Tbody>
                {users.map((u) => {
                  const regDate = new Date(u.createdAt);
                  const formattedDate = isNaN(regDate.getTime())
                    ? u.createdAt
                    : regDate.toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      });

                  return (
                    <Tr key={u.id}>
                      <Td className="text-sm">
                        <p className="font-medium text-main line-clamp-1">{u.name}</p>
                        <p className="text-xs text-muted line-clamp-1">{u.email}</p>
                      </Td>
                      <Td className="text-xs whitespace-nowrap">
                        {roleBadge(u.role)}
                      </Td>
                      <Td className="text-xs text-muted whitespace-nowrap">
                        {formattedDate}
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
  );
}
