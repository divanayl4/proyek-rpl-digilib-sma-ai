"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AlertTriangle, CheckCircle } from "lucide-react";

interface FineInfo {
  daysLate: number;
  ratePerDay: number;
  amount: number;
}

interface DamageCondition {
  key: string;
  label: string;
  amountIDR: number;
  configured: boolean;
  defaultIDR: number;
}

interface BorrowRecord {
  id: string;
  borrowDate: string;
  dueDate: string;
  effectiveStatus: string;
  user: { name: string; email: string };
  book: { title: string; author: string };
}

interface Props {
  isOpen: boolean;
  borrow: BorrowRecord;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReturnConfirmDialog({ isOpen, borrow, onClose, onSuccess }: Props) {
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fineInfo, setFineInfo] = useState<FineInfo | null>(null);
  const [conditions, setConditions] = useState<DamageCondition[]>([]);
  const [condition, setCondition] = useState("GOOD");

  const isOverdue = borrow.effectiveStatus === "OVERDUE";

  // Estimasi denda diambil dari server agar memakai tarif yang berlaku
  // (dapat diubah Admin) – bukan nilai statis di sisi klien.
  useEffect(() => {
    if (!isOpen) return;
    setFineInfo(null);
    setCondition("GOOD");
    fetch(`/api/borrows/${borrow.id}`)
      .then((r) => r.json())
      .then((data: { fineInfo?: FineInfo; damageConditions?: DamageCondition[] }) => {
        if (data.fineInfo) setFineInfo(data.fineInfo);
        setConditions(Array.isArray(data.damageConditions) ? data.damageConditions : []);
      })
      .catch(() => undefined);
  }, [isOpen, borrow.id]);

  const fine = fineInfo?.amount ?? 0;
  const daysLate = fineInfo?.daysLate ?? 0;
  const ratePerDay = fineInfo?.ratePerDay ?? 0;

  const damageAmount =
    conditions.find((c) => c.key === condition)?.amountIDR ?? 0;
  const totalEstimate = fine + damageAmount;

  const handleReturn = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/borrows/${borrow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "return", notes, condition }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal memproses pengembalian");
        return;
      }
      onSuccess();
      setNotes("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setNotes("");
    setError("");
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Konfirmasi Pengembalian"
      footer={
        <div className="flex gap-3" style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button onClick={handleReturn} disabled={isSubmitting}>
            <CheckCircle size={16} />
            {isSubmitting ? "Memproses..." : "Proses Pengembalian"}
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

      {/* Overdue Warning */}
      {isOverdue && (
        <div
          className="flex items-start gap-3 p-4 rounded-xl mb-4"
          style={{ backgroundColor: "var(--color-danger-bg)", border: "1px solid var(--color-danger-text)" }}
        >
          <AlertTriangle size={20} style={{ color: "var(--color-danger-text)", flexShrink: 0 }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-danger-text)" }}>
              Buku Terlambat
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--color-danger-text)" }}>
              Tenggat waktu: {new Date(borrow.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
            </p>
            {fine > 0 && (
              <p className="text-xs mt-1 font-bold" style={{ color: "var(--color-danger-text)" }}>
                Estimasi denda: Rp {fine.toLocaleString("id-ID")}
                {daysLate > 0 && ratePerDay > 0 ? ` (${daysLate} hari × Rp ${ratePerDay.toLocaleString("id-ID")})` : ""}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Borrow Details */}
      <div className="p-4 rounded-xl border border-border mb-4" style={{ backgroundColor: "var(--color-bg-base)" }}>
        <div className="space-y-2">
          <div className="flex justify-between gap-2">
            <span className="text-sm text-muted">Peminjam</span>
            <span className="text-sm font-medium text-main">{borrow.user.name}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-sm text-muted">Buku</span>
            <span className="text-sm font-medium text-main text-right" style={{ maxWidth: "60%" }}>{borrow.book.title}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-sm text-muted">Dipinjam</span>
            <span className="text-sm text-main">{new Date(borrow.borrowDate).toLocaleDateString("id-ID")}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-sm text-muted">Tenggat</span>
            <span className={`text-sm ${isOverdue ? "text-danger font-semibold" : "text-main"}`}>
              {new Date(borrow.dueDate).toLocaleDateString("id-ID")}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-sm text-muted">Status</span>
            <Badge variant={isOverdue ? "danger" : "info"}>
              {isOverdue ? "Terlambat" : "Dipinjam"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Condition & fine breakdown */}
      <div className="p-4 rounded-xl border border-border mb-4">
        <label className="form-label" htmlFor="return-condition">
          Kondisi buku
        </label>
        <select
          id="return-condition"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          className="form-control"
          disabled={isSubmitting}
        >
          {conditions.length === 0 && <option value="GOOD">Baik (tanpa denda)</option>}
          {conditions.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
              {c.amountIDR > 0 ? ` – Rp ${c.amountIDR.toLocaleString("id-ID")}` : " – tanpa denda"}
            </option>
          ))}
        </select>

        <div className="mt-3 space-y-1">
          <div className="flex justify-between gap-2 text-sm">
            <span className="text-muted">Denda keterlambatan</span>
            <span className="text-main">
              {fine > 0
                ? `Rp ${fine.toLocaleString("id-ID")}`
                : "Rp 0"}
            </span>
          </div>
          <div className="flex justify-between gap-2 text-sm">
            <span className="text-muted">Denda kondisi buku</span>
            <span className="text-main">Rp {damageAmount.toLocaleString("id-ID")}</span>
          </div>
          <div className="flex justify-between gap-2 text-sm font-semibold border-t border-border pt-2">
            <span className="text-main">Total estimasi denda</span>
            <span style={{ color: totalEstimate > 0 ? "var(--color-danger-text)" : "var(--color-success-text)" }}>
              Rp {totalEstimate.toLocaleString("id-ID")}
            </span>
          </div>
        </div>
      </div>

      <div>
        <label className="form-label" htmlFor="return-notes">Catatan pengembalian (opsional)</label>
        <textarea
          id="return-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Kondisi buku saat dikembalikan, dll..."
          rows={3}
          className="form-control"
          style={{ resize: "vertical" }}
        />
      </div>
    </Modal>
  );
}
