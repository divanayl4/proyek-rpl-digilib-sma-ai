"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { User, Mail, Shield, BookOpen, Calendar, Hash, GraduationCap } from "lucide-react";

interface UserDetail {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  identityNumber?: string | null;
  class?: string | null;
  createdAt: string;
  updatedAt: string;
  borrows: {
    id: string;
    borrowDate: string;
    dueDate: string;
    returnDate?: string | null;
    status: string;
    book: { title: string };
  }[];
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  LIBRARIAN: "Pustakawan",
  STUDENT: "Siswa",
  TEACHER: "Guru",
  STAFF: "Staf",
};

const STATUS_BADGES: Record<string, "info" | "success" | "warning" | "danger"> = {
  BORROWED: "info",
  RETURNED: "success",
  OVERDUE: "danger",
  CANCELLED: "warning",
};

const STATUS_LABELS: Record<string, string> = {
  BORROWED: "Dipinjam",
  RETURNED: "Kembali",
  OVERDUE: "Terlambat",
  CANCELLED: "Dibatalkan",
};

interface UserDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string | null;
}

export function UserDetailModal({ isOpen, onClose, userId }: UserDetailModalProps) {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen && userId) {
      setLoading(true);
      setError("");
      fetch(`/api/admin/users/${userId}`)
        .then(r => r.json())
        .then(data => {
          if (data.error) setError(data.error);
          else setUser(data.user);
        })
        .catch(() => setError("Gagal memuat data"))
        .finally(() => setLoading(false));
    } else {
      setUser(null);
    }
  }, [isOpen, userId]);

  const InfoRow = ({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) => (
    <div className="flex items-start gap-3 py-3 border-b border-border">
      <div className="w-8 h-8 rounded-full bg-bg-subtle flex items-center justify-center text-muted flex-shrink-0">
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted font-medium uppercase tracking-wider">{label}</p>
        <p className="text-sm text-main mt-0.5 break-words">{value || <span className="text-muted italic">Tidak ada</span>}</p>
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Detail Pengguna">
      {loading ? (
        <LoadingState message="Memuat detail pengguna..." />
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-danger text-sm">{error}</p>
        </div>
      ) : user ? (
        <div>
          {/* Header */}
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-border">
            <div className="w-16 h-16 rounded-full bg-primary-100 text-primary flex items-center justify-center text-2xl font-bold flex-shrink-0">
              {user.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <h4 className="text-xl font-bold text-main break-words">{user.name}</h4>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant={user.isActive ? "success" : "danger"}>
                  {user.isActive ? "Aktif" : "Nonaktif"}
                </Badge>
                <Badge variant="info">{ROLE_LABELS[user.role] || user.role}</Badge>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="mb-6">
            <InfoRow icon={Mail} label="Email" value={user.email} />
            <InfoRow icon={Hash} label="Nomor Identitas" value={user.identityNumber} />
            {user.class && <InfoRow icon={GraduationCap} label="Kelas" value={user.class} />}
            <InfoRow icon={Calendar} label="Tanggal Daftar" value={new Date(user.createdAt).toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} />
          </div>

          {/* Borrow History */}
          {user.borrows.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
                <BookOpen size={14} /> Riwayat Pinjam Terbaru
              </h3>
              <div className="space-y-2">
                {user.borrows.map(b => (
                  <div key={b.id} className="flex items-center justify-between gap-3 p-3 bg-bg-base rounded-lg border border-border">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-main line-clamp-1">{b.book.title}</p>
                      <p className="text-xs text-muted mt-0.5">
                        {new Date(b.borrowDate).toLocaleDateString("id-ID")} → {new Date(b.dueDate).toLocaleDateString("id-ID")}
                      </p>
                    </div>
                    <Badge variant={STATUS_BADGES[b.status] || "default"}>
                      {STATUS_LABELS[b.status] || b.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
