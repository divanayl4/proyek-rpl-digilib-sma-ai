"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { Coins, AlertTriangle, CheckCircle } from "lucide-react";

interface BorrowFineDetail {
  id: string;
  user: { name: string };
  book: { title: string };
  fineInfo: {
    daysLate: number;
    ratePerDay: number;
    amount: number;
    paid: number;
    outstanding: number;
    isFinal: boolean;
  } | null;
}

interface Props {
  isOpen: boolean;
  borrowId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const METHOD_OPTIONS = [
  { value: "CASH", label: "Tunai" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "LAINNYA", label: "Lainnya" },
];

function formatIDR(value: number) {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

export default function PayFineDialog({ isOpen, borrowId, onClose, onSuccess }: Props) {
  const [detail, setDetail] = useState<BorrowFineDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!isOpen || !borrowId) return;
    setIsLoading(true);
    setError("");
    setSuccess("");
    fetch(`/api/borrows/${borrowId}`)
      .then((r) => r.json())
      .then((data: BorrowFineDetail & { error?: string }) => {
        if (data.error) {
          setError(data.error);
        } else {
          setDetail(data);
          setAmount(String(data.fineInfo?.outstanding ?? ""));
        }
      })
      .catch(() => setError("Gagal memuat rincian denda"))
      .finally(() => setIsLoading(false));
  }, [isOpen, borrowId]);

  const handleClose = () => {
    setDetail(null);
    setAmount("");
    setMethod("CASH");
    setNote("");
    setError("");
    setSuccess("");
    onClose();
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/borrows/${borrowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pay-fine", amount, method, notes: note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal mencatat pembayaran denda");
        return;
      }
      setSuccess("Pembayaran denda berhasil dicatat.");
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 700);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fine = detail?.fineInfo ?? null;
  const isLunas = !!fine && fine.outstanding <= 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Catat Pembayaran Denda"
      footer={
        <div className="flex gap-3" style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isLunas || !fine || fine.amount <= 0}
          >
            <Coins size={16} />
            {isSubmitting ? "Menyimpan..." : "Catat Pembayaran"}
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <LoadingState message="Memuat rincian denda..." />
      ) : error && !detail ? (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-danger-bg text-danger">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
          <p className="text-sm">{error}</p>
        </div>
      ) : detail && fine ? (
        <div className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-danger-bg text-danger">
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
              <p className="text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div role="status" className="flex items-center gap-2 p-3 rounded-lg bg-success-bg text-success">
              <CheckCircle size={16} />
              <p className="text-sm">{success}</p>
            </div>
          )}

          <div className="p-4 rounded-xl border border-border" style={{ backgroundColor: "var(--color-bg-base)" }}>
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted">Peminjam</span>
                <span className="text-sm font-medium text-main">{detail.user.name}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted">Buku</span>
                <span className="text-sm font-medium text-main text-right" style={{ maxWidth: "60%" }}>
                  {detail.book.title}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted">Keterlambatan</span>
                <span className="text-sm text-main">{fine.daysLate} hari × {formatIDR(fine.ratePerDay)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted">Total denda</span>
                <span className="text-sm font-semibold text-main">{formatIDR(fine.amount)}</span>
              </div>
              {fine.paid > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="text-sm text-muted">Sudah dibayar</span>
                  <span className="text-sm text-main">{formatIDR(fine.paid)}</span>
                </div>
              )}
              <div className="flex justify-between gap-2 items-center">
                <span className="text-sm text-muted">Sisa denda</span>
                <Badge variant={isLunas ? "success" : "danger"}>
                  {isLunas ? "Lunas" : formatIDR(fine.outstanding)}
                </Badge>
              </div>
            </div>
          </div>

          {isLunas ? (
            <p className="text-sm" style={{ color: "var(--color-success-text)" }}>
              Denda untuk transaksi ini sudah lunas.
            </p>
          ) : (
            <>
              <Input
                label="Jumlah pembayaran (Rp)"
                type="number"
                min={1}
                max={fine.outstanding}
                step={500}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Select
                id="fine-method"
                label="Metode pembayaran"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
              <div>
                <label className="form-label" htmlFor="fine-note">Catatan (opsional)</label>
                <textarea
                  id="fine-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Catatan pembayaran..."
                  rows={2}
                  className="form-control"
                  style={{ resize: "vertical" }}
                />
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Transaksi ini tidak memiliki denda.</p>
      )}
    </Modal>
  );
}
