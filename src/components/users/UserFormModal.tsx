"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface UserFormData {
  name: string;
  email: string;
  password: string;
  role: string;
  identityNumber: string;
  class: string;
}

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editUser?: {
    id: string;
    name: string;
    email: string;
    role: string;
    identityNumber?: string | null;
    class?: string | null;
  } | null;
}

const ROLES = [
  { value: "STUDENT", label: "Siswa" },
  { value: "TEACHER", label: "Guru" },
  { value: "STAFF", label: "Staf" },
  { value: "LIBRARIAN", label: "Pustakawan" },
  { value: "ADMIN", label: "Administrator" },
];

export function UserFormModal({ isOpen, onClose, onSuccess, editUser }: UserFormModalProps) {
  const isEdit = !!editUser;

  const [form, setForm] = useState<UserFormData>({
    name: "",
    email: "",
    password: "",
    role: "STUDENT",
    identityNumber: "",
    class: "",
  });
  const [errors, setErrors] = useState<Partial<UserFormData>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  // Sync form state when modal opens or editUser changes
  useEffect(() => {
    if (isOpen) {
      setForm({
        name: editUser?.name || "",
        email: editUser?.email || "",
        password: "",
        role: editUser?.role || "STUDENT",
        identityNumber: editUser?.identityNumber || "",
        class: editUser?.class || "",
      });
      setErrors({});
      setApiError("");
    }
  }, [isOpen, editUser]);

  const validate = (): boolean => {
    const newErrors: Partial<UserFormData> = {};
    if (!form.name.trim()) newErrors.name = "Nama wajib diisi";
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = "Format email tidak valid";
    }
    if (!isEdit && (!form.password || form.password.length < 6)) {
      newErrors.password = "Password minimal 6 karakter";
    }
    if (isEdit && form.password && form.password.length < 6) {
      newErrors.password = "Password minimal 6 karakter";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setApiError("");

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        identityNumber: form.identityNumber.trim() || null,
        class: form.class.trim() || null,
      };

      if (!isEdit) {
        payload.password = form.password;
      } else if (form.password) {
        payload.password = form.password;
      }

      const url = isEdit ? `/api/admin/users/${editUser!.id}` : "/api/admin/users";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setApiError(data.error || "Terjadi kesalahan saat menyimpan data");
      } else {
        onSuccess();
        onClose();
      }
    } catch {
      setApiError("Gagal terhubung ke server. Periksa koneksi internet Anda.");
    } finally {
      setLoading(false);
    }
  };

  const showClassField = form.role === "STUDENT";
  const showIdentityField = ["STUDENT", "TEACHER", "STAFF", "LIBRARIAN"].includes(form.role);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? "Edit Data Pengguna" : "Tambah Pengguna Baru"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Menyimpan..." : (isEdit ? "Simpan Perubahan" : "Tambah Pengguna")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {apiError && (
          <div role="alert" className="bg-danger-bg text-danger text-sm p-3.5 rounded-xl border border-danger-bg font-medium">
            {apiError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="user-name" className="form-label">
              Nama Lengkap <span className="text-danger">*</span>
            </label>
            <input
              id="user-name"
              className={`form-control ${errors.name ? "border-danger-text" : ""}`}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Masukkan nama lengkap"
              disabled={loading}
            />
            {errors.name && <p className="text-xs text-danger mt-1.5">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="user-email" className="form-label">
              Alamat Email <span className="text-danger">*</span>
            </label>
            <input
              id="user-email"
              type="email"
              className={`form-control ${errors.email ? "border-danger-text" : ""}`}
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="nama@sma.id"
              disabled={loading}
            />
            {errors.email && <p className="text-xs text-danger mt-1.5">{errors.email}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="user-password" className="form-label">
              Kata Sandi {isEdit ? <span className="text-muted text-xs font-normal">(opsional)</span> : <span className="text-danger">*</span>}
            </label>
            <input
              id="user-password"
              type="password"
              className={`form-control ${errors.password ? "border-danger-text" : ""}`}
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder={isEdit ? "Kosongkan jika tidak diubah" : "Minimal 6 karakter"}
              disabled={loading}
            />
            {errors.password && <p className="text-xs text-danger mt-1.5">{errors.password}</p>}
          </div>

          <div>
            <label htmlFor="user-role" className="form-label">
              Peran / Role <span className="text-danger">*</span>
            </label>
            <select
              id="user-role"
              className="form-control"
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
              disabled={loading}
            >
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>

        {(showIdentityField || showClassField) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {showIdentityField && (
              <div>
                <label htmlFor="user-identity" className="form-label">
                  {form.role === "STUDENT" ? "Nomor Induk Siswa (NIS)" : "NIP / Nomor Pegawai"}
                </label>
                <input
                  id="user-identity"
                  className="form-control"
                  value={form.identityNumber}
                  onChange={e => setForm({ ...form, identityNumber: e.target.value })}
                  placeholder={form.role === "STUDENT" ? "Contoh: 2024001" : "Contoh: 198504102010011001"}
                  disabled={loading}
                />
              </div>
            )}

            {showClassField && (
              <div>
                <label htmlFor="user-class" className="form-label">Kelas</label>
                <input
                  id="user-class"
                  className="form-control"
                  value={form.class}
                  onChange={e => setForm({ ...form, class: e.target.value })}
                  placeholder="Contoh: XII IPA 1"
                  disabled={loading}
                />
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
