"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { Search, AlertCircle, BookOpen, User } from "lucide-react";

interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  coverUrl: string | null;
  available: number;
  stock: number;
  category: { id: string; name: string } | null;
}

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  class: string | null;
  identityNumber: string | null;
  isActive: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateBorrowModal({ isOpen, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<"user" | "book" | "confirm">("user");
  const [userSearch, setUserSearch] = useState("");
  const [bookSearch, setBookSearch] = useState("");
  const [users, setUsers] = useState<Member[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedUser, setSelectedUser] = useState<Member | null>(null);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [notes, setNotes] = useState("");
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const searchUsers = useCallback(async (q: string) => {
    setIsLoadingUsers(true);
    try {
      const res = await fetch(`/api/librarian/borrowers?search=${encodeURIComponent(q)}&pageSize=10`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  const searchBooks = useCallback(async (q: string) => {
    setIsLoadingBooks(true);
    try {
      const res = await fetch(`/api/books?search=${encodeURIComponent(q)}&availability=available&pageSize=10`);
      if (res.ok) {
        const data = await res.json();
        setBooks(data.books || []);
      }
    } finally {
      setIsLoadingBooks(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // Load initial lists
    searchUsers("");
    searchBooks("");
  }, [isOpen, searchUsers, searchBooks]);

  useEffect(() => {
    const t = setTimeout(() => searchUsers(userSearch), 400);
    return () => clearTimeout(t);
  }, [userSearch, searchUsers]);

  useEffect(() => {
    const t = setTimeout(() => searchBooks(bookSearch), 400);
    return () => clearTimeout(t);
  }, [bookSearch, searchBooks]);

  const handleClose = () => {
    setStep("user");
    setSelectedUser(null);
    setSelectedBook(null);
    setNotes("");
    setError("");
    setUserSearch("");
    setBookSearch("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedUser || !selectedBook) return;
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/borrows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          bookId: selectedBook.id,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal membuat transaksi");
        return;
      }
      onSuccess();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalTitle =
    step === "user" ? "Pilih Peminjam" : step === "book" ? "Pilih Buku" : "Konfirmasi Peminjaman";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Buat Peminjaman – ${modalTitle}`}
      size="lg"
      footer={
        step === "confirm" ? (
          <div className="flex gap-3" style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setStep("book")} disabled={isSubmitting}>
              Kembali
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Memproses..." : "Konfirmasi Peminjaman"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg mb-4 bg-danger-bg text-danger">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Step 1: Select User */}
      {step === "user" && (
        <div>
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Cari nama, email, NIS/NIP..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          {isLoadingUsers ? (
            <LoadingState message="Mencari anggota..." />
          ) : (
            <div className="max-h-80 overflow-y-auto flex flex-col gap-2">
              {users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setSelectedUser(u);
                    setStep("book");
                    setError("");
                  }}
                  disabled={!u.isActive}
                  className="flex w-full items-center gap-3 p-3 rounded-lg border border-border text-left transition-colors hover:bg-base disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="p-2 rounded-full bg-primary-50 text-primary flex-shrink-0">
                    <User size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-main text-sm truncate">{u.name}</p>
                    <p className="text-xs text-muted truncate">{u.email} · {u.role}{u.class ? ` · ${u.class}` : ""}</p>
                  </div>
                  {!u.isActive && <Badge variant="danger">Nonaktif</Badge>}
                </button>
              ))}
              {users.length === 0 && !isLoadingUsers && (
                <p className="text-sm text-muted text-center py-4">Tidak ada anggota ditemukan</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Select Book */}
      {step === "book" && (
        <div>
          {selectedUser && (
            <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-base">
              <User size={14} className="text-muted" />
              <span className="text-sm font-medium text-main">{selectedUser.name}</span>
              <Badge variant="info" className="ml-auto">{selectedUser.role}</Badge>
              <button onClick={() => setStep("user")} className="text-action text-xs text-muted hover:text-main ml-2" aria-label="Ganti peminjam">Ganti</button>
            </div>
          )}
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Cari judul buku, penulis, ISBN..."
              value={bookSearch}
              onChange={(e) => setBookSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          {isLoadingBooks ? (
            <LoadingState message="Mencari buku..." />
          ) : (
            <div className="max-h-80 overflow-y-auto flex flex-col gap-2">
              {books.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setSelectedBook(b);
                    setStep("confirm");
                    setError("");
                  }}
                  disabled={b.available <= 0}
                  className="flex w-full items-center gap-3 p-3 rounded-lg border border-border text-left transition-colors hover:bg-base disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="p-2 rounded-full bg-primary-50 text-primary flex-shrink-0">
                    <BookOpen size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-main text-sm line-clamp-1">{b.title}</p>
                    <p className="text-xs text-muted truncate">{b.author}{b.isbn ? ` · ${b.isbn}` : ""}</p>
                  </div>
                  <Badge variant={b.available > 0 ? "success" : "danger"}>
                    {b.available > 0 ? `${b.available} tersedia` : "Habis"}
                  </Badge>
                </button>
              ))}
              {books.length === 0 && !isLoadingBooks && (
                <p className="text-sm text-muted text-center py-4">Tidak ada buku tersedia ditemukan</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === "confirm" && selectedUser && selectedBook && (
        <div>
          <div className="p-4 rounded-xl border border-border mb-4" style={{ backgroundColor: "var(--color-bg-base)" }}>
            <h4 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Rincian Peminjaman</h4>
            <div className="space-y-3">
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted">Peminjam</span>
                <div className="text-right min-w-0">
                  <p className="text-sm font-medium text-main break-words">{selectedUser.name}</p>
                  <p className="text-xs text-muted">{selectedUser.role}{selectedUser.class ? ` · ${selectedUser.class}` : ""}</p>
                </div>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted">Buku</span>
                <div className="text-right min-w-0 max-w-[60%]">
                  <p className="text-sm font-medium text-main break-words">{selectedBook.title}</p>
                  <p className="text-xs text-muted">{selectedBook.author}</p>
                </div>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted">Tanggal Pinjam</span>
                <span className="text-sm font-medium text-main">{new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</span>
              </div>
            </div>
          </div>
          <div>
            <label className="form-label">Catatan (opsional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan tambahan untuk transaksi ini..."
              rows={3}
              className="form-control"
              style={{ resize: "vertical" }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
