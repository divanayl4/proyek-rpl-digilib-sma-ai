"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { KeyRound } from "lucide-react";

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
}

export function ResetPasswordModal({ isOpen, onClose, userId, userName }: ResetPasswordModalProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState("");

  const handleReset = () => {
    setNewPassword("");
    setConfirmPassword("");
    setErrors({});
    setSuccess(false);
    setApiError("");
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!newPassword || newPassword.length < 6) {
      newErrors.newPassword = "Password minimal 6 karakter";
    }
    if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = "Konfirmasi password tidak cocok";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    setApiError("");

    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setApiError(data.error || "Terjadi kesalahan");
      } else {
        setSuccess(true);
      }
    } catch {
      setApiError("Gagal terhubung ke server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Reset Password"
      footer={
        success ? (
          <Button onClick={handleClose}>Tutup</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={handleClose} disabled={loading}>Batal</Button>
            <Button variant="danger" onClick={handleSubmit} disabled={loading}>
              {loading ? "Memproses..." : "Reset Password"}
            </Button>
          </>
        )
      }
    >
      {success ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="w-14 h-14 rounded-full bg-success-bg flex items-center justify-center">
            <KeyRound size={28} className="text-success" />
          </div>
          <h3 className="font-semibold text-main">Password Berhasil Direset</h3>
          <p className="text-sm text-muted">Password <strong>{userName}</strong> telah diperbarui.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="bg-warning-bg text-warning-text text-sm p-3 rounded-md border border-warning-bg">
            ⚠️ Anda akan mereset password untuk <strong>{userName}</strong>. Pastikan Anda memberitahu pengguna tentang password baru mereka.
          </div>

          {apiError && (
            <div role="alert" className="bg-danger-bg text-danger text-sm p-3 rounded-md border border-danger-bg">{apiError}</div>
          )}

          <div>
            <label htmlFor="newPassword" className="form-label">Password Baru <span className="text-danger">*</span></label>
            <input
              id="newPassword"
              type="password"
              className={`form-control ${errors.newPassword ? "border-danger-text" : ""}`}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
            />
            {errors.newPassword && <p className="text-xs text-danger mt-1">{errors.newPassword}</p>}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="form-label">Konfirmasi Password <span className="text-danger">*</span></label>
            <input
              id="confirmPassword"
              type="password"
              className={`form-control ${errors.confirmPassword ? "border-danger-text" : ""}`}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Ulangi password baru"
            />
            {errors.confirmPassword && <p className="text-xs text-danger mt-1">{errors.confirmPassword}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
