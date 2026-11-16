"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { LIBRARY_CONFIG } from "@/lib/config/library";
import { AlertCircle, BookOpen } from "lucide-react";

interface RequestBook {
  id: string;
  title: string;
  author: string;
}

interface Props {
  isOpen: boolean;
  book: RequestBook | null;
  onClose: () => void;
  onSuccess: (data: { status?: string }) => void;
}

/**
 * Formulir pengajuan peminjaman buku fisik untuk Siswa/Guru.
 * Alasan wajib diisi, divalidasi di sini (frontend) dan diulang di server.
 */
export default function BorrowRequestModal({ isOpen, book, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const maxLength = LIBRARY_CONFIG.borrowReasonMaxLength;

  const handleClose = () => {
    if (isSubmitting) return;
    setReason("");
    setError("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!book) return;
    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      setError("Alasan Peminjaman Buku wajib diisi.");
      return;
    }
    if (trimmedReason.length > maxLength) {
      setError(`Alasan peminjaman maksimal ${maxLength} karakter.`);
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/borrows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id, reason: trimmedReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal mengajukan peminjaman");
        return;
      }
      setReason("");
      onSuccess(data);
    } catch {
      setError("Terjadi kesalahan jaringan atau server tidak merespons");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!book) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Ajukan Peminjaman Buku"
      size="md"
      footer={
        <div className="flex gap-3" style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Mengirim..." : "Kirim Pengajuan"}
          </Button>
        </div>
      }
    >
      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg mb-4 bg-danger-bg text-danger">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="p-4 rounded-xl border border-border mb-4" style={{ backgroundColor: "var(--color-bg-base)" }}>
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-primary-50 text-primary flex-shrink-0">
            <BookOpen size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-main break-words">{book.title}</p>
            <p className="text-xs text-muted break-words">{book.author}</p>
          </div>
        </div>
      </div>

      <div>
        <label className="form-label" htmlFor="borrow-reason">
          Alasan Peminjaman Buku <span aria-hidden="true" style={{ color: "var(--color-danger-text)" }}>*</span>
        </label>
        <textarea
          id="borrow-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError("");
          }}
          placeholder="Tuliskan alasan kamu meminjam buku ini..."
          rows={4}
          maxLength={maxLength}
          required
          aria-required="true"
          aria-describedby="borrow-reason-hint"
          className="form-control"
          style={{ resize: "vertical" }}
          autoFocus
        />
        <div className="form-hint" id="borrow-reason-hint" style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
          <span>Alasan ini digunakan sebagai informasi bagi petugas perpustakaan.</span>
          <span aria-live="polite" style={{ flexShrink: 0 }}>
            {reason.length}/{maxLength}
          </span>
        </div>
      </div>
    </Modal>
  );
}
