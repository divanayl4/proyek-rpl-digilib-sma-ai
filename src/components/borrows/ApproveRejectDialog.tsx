"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface BorrowRecord {
  id: string;
  requestDate?: string | null;
  borrowDate: string;
  dueDate: string;
  user: { name: string; email: string; role: string; class?: string | null };
  book: { title: string; author: string };
  notes?: string | null;
  borrowReason?: string | null;
}

interface Props {
  isOpen: boolean;
  mode: "approve" | "reject";
  borrow: BorrowRecord;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ApproveRejectDialog({ isOpen, mode, borrow, onClose, onSuccess }: Props) {
  const isApprove = mode === "approve";
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!isApprove && !reason.trim()) {
      setError("Alasan penolakan wajib diisi");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/borrows/${borrow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: isApprove ? "approve" : "reject", reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal memproses pengajuan");
        return;
      }
      onSuccess();
      setReason("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason("");
    setError("");
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isApprove ? "Setujui Peminjaman" : "Tolak Peminjaman"}
      footer={
        <div className="flex gap-3" style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button variant={isApprove ? "primary" : "danger"} onClick={handleSubmit} disabled={isSubmitting}>
            {isApprove ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {isSubmitting ? "Memproses..." : isApprove ? "Setujui" : "Tolak"}
          </Button>
        </div>
      }
    >
      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg mb-4 bg-danger-bg text-danger">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="p-4 rounded-xl border border-border mb-4" style={{ backgroundColor: "var(--color-bg-base)" }}>
        <div className="space-y-2">
          <div className="flex justify-between gap-2">
            <span className="text-sm text-muted">Peminjam</span>
            <div className="text-right min-w-0">
              <p className="text-sm font-medium text-main break-words">{borrow.user.name}</p>
              <p className="text-xs text-muted">{borrow.user.role}{borrow.user.class ? ` · ${borrow.user.class}` : ""}</p>
            </div>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-sm text-muted">Buku</span>
            <div className="text-right min-w-0 max-w-[60%]">
              <p className="text-sm font-medium text-main break-words">{borrow.book.title}</p>
              <p className="text-xs text-muted">{borrow.book.author}</p>
            </div>
          </div>
          {borrow.borrowReason && (
            <div className="flex justify-between gap-2">
              <span className="text-sm text-muted flex-shrink-0">Alasan</span>
              <p className="text-sm text-main text-right break-words whitespace-pre-line">
                {borrow.borrowReason}
              </p>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-sm text-muted">Status</span>
            <Badge variant="warning">Menunggu Persetujuan</Badge>
          </div>
        </div>
      </div>

      {isApprove ? (
        <p className="text-sm text-muted">
          Dengan menyetujui, status berubah menjadi <strong>Dipinjam</strong> dan stok buku berkurang
          satu. Pastikan buku telah diserahkan secara fisik kepada peminjam.
        </p>
      ) : (
        <div>
          <label className="form-label" htmlFor="reject-reason">Alasan penolakan</label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: stok sedang dipesan anggota lain, data peminjam belum lengkap..."
            rows={3}
            className="form-control"
            style={{ resize: "vertical" }}
            autoFocus
          />
        </div>
      )}
    </Modal>
  );
}
