"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Trash2, Edit2, Plus } from "lucide-react";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";

interface Category {
  id: string;
  name: string;
  _count?: { books: number };
}

interface CategoryFormModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CategoryFormModal({ isOpen, onClose }: CategoryFormModalProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [apiError, setApiError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/categories");
      if (res.ok) {
        const data = await res.json();
        setCategories(data);
      }
    } catch {
      setApiError("Gagal memuat kategori");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCategories();
      setName("");
      setEditingId(null);
      setApiError("");
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setApiError("");
    try {
      const url = editingId ? `/api/categories/${editingId}` : "/api/categories";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setApiError(data.error || "Gagal menyimpan kategori");
      } else {
        setName("");
        setEditingId(null);
        fetchCategories();
      }
    } catch {
      setApiError("Terjadi kesalahan jaringan");
    }
  };

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id);
    setName(cat.name);
    setApiError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setName("");
    setApiError("");
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/categories/${deleteId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setApiError(data.error || "Gagal menghapus kategori");
      } else {
        fetchCategories();
      }
    } catch {
      setApiError("Terjadi kesalahan jaringan");
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Kelola Kategori Buku">
        <div className="flex flex-col gap-6">
          {apiError && (
            <div role="alert" className="bg-danger-bg text-danger text-sm p-3 rounded-md border border-danger-bg">
              {apiError}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label htmlFor="cat_name" className="form-label">{editingId ? "Edit Kategori" : "Tambah Kategori Baru"}</label>
              <input
                id="cat_name"
                className="form-control"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Nama kategori..."
              />
            </div>
            <div className="flex items-center gap-2">
              {editingId && (
                <Button type="button" variant="ghost" onClick={cancelEdit}>Batal</Button>
              )}
              <Button type="submit" disabled={!name.trim()}>
                {editingId ? "Simpan" : <><Plus size={16} /> Tambah</>}
              </Button>
            </div>
          </form>

          {/* List */}
          <div>
            <h4 className="font-medium text-main mb-3">Daftar Kategori</h4>
            {loading ? (
              <p className="text-muted text-sm">Memuat...</p>
            ) : categories.length === 0 ? (
              <p className="text-muted text-sm italic">Belum ada kategori</p>
            ) : (
              <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                {categories.map((cat) => (
                  <div key={cat.id} className="p-3 flex justify-between items-center gap-3 hover:bg-base transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium text-main truncate">{cat.name}</p>
                      <p className="text-xs text-muted">{cat._count?.books || 0} Buku</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleEdit(cat)}
                        className="row-action text-muted hover:text-primary hover:bg-primary-50"
                        aria-label={`Edit kategori ${cat.name}`}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteId(cat.id)}
                        disabled={cat._count?.books !== undefined && cat._count.books > 0}
                        className="row-action text-muted hover:text-danger hover:bg-danger-bg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                        title={cat._count?.books ? "Tidak bisa dihapus, masih ada buku" : "Hapus"}
                        aria-label={`Hapus kategori ${cat.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmationDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Hapus Kategori?"
        message="Kategori yang dihapus tidak dapat dikembalikan. Pastikan kategori ini benar-benar tidak terpakai."
        confirmText="Ya, Hapus"
        isDestructive
      />
    </>
  );
}
