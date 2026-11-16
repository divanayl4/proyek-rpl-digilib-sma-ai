"use client";

import { useState, useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Upload, X, Image as ImageIcon, FileText, CheckCircle } from "lucide-react";
import Image from "next/image";
import {
  ALL_SUBJECTS,
  GRADE_LEVELS,
  MAJOR_NAMES,
} from "@/lib/config/smk";

interface Category {
  id: string;
  name: string;
}

interface BookFormData {
  title: string;
  author: string;
  isbn: string;
  publisher: string;
  year: string;
  stock: string;
  categoryId: string;
  description: string;
  coverUrl: string;
  grade: string;
  subject: string;
  major: string;
  format: "PHYSICAL" | "EBOOK";
}

interface BookFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editBook?: any | null;
}

const EMPTY_FORM: BookFormData = {
  title: "",
  author: "",
  isbn: "",
  publisher: "",
  year: "",
  stock: "0",
  categoryId: "",
  description: "",
  coverUrl: "",
  grade: "",
  subject: "",
  major: "",
  format: "PHYSICAL",
};

export function BookFormModal({ isOpen, onClose, onSuccess, editBook }: BookFormModalProps) {
  const isEdit = !!editBook;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<BookFormData>(EMPTY_FORM);

  // Ebook file bookkeeping
  const [uploadedFilePath, setUploadedFilePath] = useState("");
  const [existingFile, setExistingFile] = useState(false);
  const [removeFile, setRemoveFile] = useState(false);

  const [errors, setErrors] = useState<Partial<Record<keyof BookFormData, string>>>({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [apiError, setApiError] = useState("");

  useEffect(() => {
    if (isOpen) {
      fetch("/api/categories")
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setCategories(data);
        })
        .catch(() => {});

      if (editBook) {
        setForm({
          title: editBook.title || "",
          author: editBook.author || "",
          isbn: editBook.isbn || "",
          publisher: editBook.publisher || "",
          year: editBook.year ? String(editBook.year) : "",
          stock: editBook.stock !== undefined ? String(editBook.stock) : "0",
          categoryId: editBook.categoryId || "",
          description: editBook.description || "",
          coverUrl: editBook.coverUrl || "",
          grade: editBook.grade || "",
          subject: editBook.subject || "",
          major: editBook.major || "",
          format: editBook.format === "EBOOK" ? "EBOOK" : "PHYSICAL",
        });
        setExistingFile(Boolean(editBook.hasEbookFile));
      } else {
        setForm(EMPTY_FORM);
        setExistingFile(false);
      }
      setUploadedFilePath("");
      setRemoveFile(false);
      setErrors({});
      setApiError("");
    }
  }, [isOpen, editBook]);

  const validate = () => {
    const newErrors: Partial<Record<keyof BookFormData, string>> = {};
    if (!form.title.trim()) newErrors.title = "Judul buku wajib diisi";
    if (!form.author.trim()) newErrors.author = "Nama penulis wajib diisi";
    if (form.format === "PHYSICAL" && (!form.stock || parseInt(form.stock) < 0)) {
      newErrors.stock = "Jumlah eksemplar minimal 0";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setApiError("Hanya file gambar (JPG, PNG) yang diperbolehkan");
      return;
    }

    setUploading(true);
    setApiError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setForm(prev => ({ ...prev, coverUrl: data.url }));
      } else {
        setApiError(data.error || "Gagal mengunggah cover buku");
      }
    } catch {
      setApiError("Terjadi kesalahan jaringan saat mengunggah cover");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPdf(true);
    setApiError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload/ebook", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setUploadedFilePath(data.filePath);
        setRemoveFile(false);
      } else {
        setApiError(data.error || "Gagal mengunggah berkas ebook PDF");
      }
    } catch {
      setApiError("Terjadi kesalahan jaringan saat mengunggah berkas PDF");
    } finally {
      setUploadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const hasEbookFile = Boolean(uploadedFilePath) || (existingFile && !removeFile);

  const clearEbookFile = () => {
    setUploadedFilePath("");
    setRemoveFile(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setApiError("");

    try {
      const url = isEdit ? `/api/books/${editBook.id}` : "/api/books";
      const method = isEdit ? "PATCH" : "POST";

      let filePath: string | null | undefined;
      if (!hasEbookFile) {
        filePath = isEdit ? (removeFile ? null : undefined) : null;
      } else if (uploadedFilePath) {
        filePath = uploadedFilePath;
      }

      const payload = {
        ...form,
        stock: form.stock,
        filePath,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setApiError(data.error || "Gagal menyimpan data buku");
      } else {
        onSuccess();
        onClose();
      }
    } catch {
      setApiError("Terjadi kesalahan jaringan saat menghubungi server");
    } finally {
      setLoading(false);
    }
  };

  const isEbook = form.format === "EBOOK";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? "Edit Informasi Buku" : "Tambah Buku Baru ke Katalog"}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading || uploading || uploadingPdf}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={loading || uploading || uploadingPdf}>
            {loading ? "Menyimpan..." : (isEdit ? "Simpan Perubahan" : "Simpan Buku")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        {apiError && (
          <div role="alert" className="bg-danger-bg text-danger text-sm p-3.5 rounded-xl border border-danger-bg font-medium">
            {apiError}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Left Column - Cover Upload */}
          <div className="w-full md:w-1/3 flex flex-col gap-3 flex-shrink-0">
            <label className="form-label">Cover Buku</label>
            <div
              className={`cover-preview-frame border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-4 transition-all ${
                form.coverUrl ? "border-primary bg-base" : "border-border hover:border-primary/50 hover:bg-base"
              } h-64`}
            >
              {form.coverUrl ? (
                <>
                  <Image src={form.coverUrl} alt="Cover Preview" fill className="object-cover" />
                  <div className="cover-preview-overlay">
                    <button
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, coverUrl: "" }))}
                      className="cover-remove shadow-lg"
                      title="Hapus Cover"
                      aria-label="Hapus cover buku"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className="text-center flex flex-col items-center cursor-pointer p-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  role="button"
                  tabIndex={0}
                  aria-label="Unggah cover buku"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  {uploading ? (
                    <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                  ) : (
                    <>
                      <div className="w-12 h-12 bg-primary-50 text-primary rounded-2xl flex items-center justify-center mb-3">
                        <ImageIcon size={24} />
                      </div>
                      <p className="text-sm font-semibold text-main">Klik untuk upload cover</p>
                      <p className="text-xs text-muted mt-1">PNG, JPG, WebP maksimal 2MB</p>
                    </>
                  )}
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*"
                className="hidden"
              />
            </div>
            {form.coverUrl && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={14} className="mr-1.5" /> Ganti Cover
              </Button>
            )}
          </div>

          {/* Right Column - Form Fields */}
          <div className="w-full md:w-2/3 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="book-title" className="form-label">
                  Judul Buku <span className="text-danger">*</span>
                </label>
                <input
                  id="book-title"
                  className={`form-control ${errors.title ? "border-danger-text" : ""}`}
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="Contoh: Matematika Diskrit"
                  disabled={loading}
                />
                {errors.title && <p className="text-xs text-danger mt-1">{errors.title}</p>}
              </div>

              <div>
                <label htmlFor="book-author" className="form-label">
                  Penulis <span className="text-danger">*</span>
                </label>
                <input
                  id="book-author"
                  className={`form-control ${errors.author ? "border-danger-text" : ""}`}
                  value={form.author}
                  onChange={e => setForm({ ...form, author: e.target.value })}
                  placeholder="Contoh: Tim Penyusun"
                  disabled={loading}
                />
                {errors.author && <p className="text-xs text-danger mt-1">{errors.author}</p>}
              </div>
            </div>

            {/* Kurikulum & Jurusan */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="book-grade" className="form-label">Tingkat Kelas</label>
                <select
                  id="book-grade"
                  className="form-control"
                  value={form.grade}
                  onChange={e => setForm({ ...form, grade: e.target.value })}
                  disabled={loading}
                >
                  <option value="">Semua Kelas</option>
                  {GRADE_LEVELS.map(g => (
                    <option key={g} value={g}>Kelas {g}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="book-subject" className="form-label">Mata Pelajaran</label>
                <input
                  id="book-subject"
                  list="subject-options"
                  className="form-control"
                  value={form.subject}
                  onChange={e => setForm({ ...form, subject: e.target.value })}
                  placeholder="mis. Informatika"
                  disabled={loading}
                />
                <datalist id="subject-options">
                  {ALL_SUBJECTS.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>

              <div>
                <label htmlFor="book-major" className="form-label">Jurusan / Program</label>
                <input
                  id="book-major"
                  list="major-options"
                  className="form-control"
                  value={form.major}
                  onChange={e => setForm({ ...form, major: e.target.value })}
                  placeholder="mis. RPL"
                  disabled={loading}
                />
                <datalist id="major-options">
                  {MAJOR_NAMES.map(m => <option key={m} value={m} />)}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="book-format" className="form-label">Format Koleksi</label>
                <select
                  id="book-format"
                  className="form-control"
                  value={form.format}
                  onChange={e => setForm({ ...form, format: e.target.value as "PHYSICAL" | "EBOOK" })}
                  disabled={loading}
                >
                  <option value="PHYSICAL">Buku Fisik</option>
                  <option value="EBOOK">Ebook Digital (PDF)</option>
                </select>
              </div>

              <div>
                <label htmlFor="book-category" className="form-label">Kategori</label>
                <select
                  id="book-category"
                  className="form-control"
                  value={form.categoryId}
                  onChange={e => setForm({ ...form, categoryId: e.target.value })}
                  disabled={loading}
                >
                  <option value="">Pilih Kategori</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Ebook PDF upload block */}
            {isEbook && (
              <div className="rounded-xl border border-border p-4 bg-base">
                <label className="form-label mb-2">Berkas Dokumen Ebook (PDF)</label>
                {hasEbookFile ? (
                  <div className="flex items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-border">
                    <div className="flex items-center gap-2 text-sm text-main min-w-0">
                      <CheckCircle size={18} className="text-success flex-shrink-0" />
                      <span className="truncate font-medium">
                        {uploadedFilePath ? "Berkas PDF baru siap disimpan" : "Berkas PDF tersimpan di sistem"}
                      </span>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => pdfInputRef.current?.click()}
                        disabled={uploadingPdf}
                      >
                        Ganti PDF
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearEbookFile}
                        disabled={uploadingPdf}
                      >
                        Hapus
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => pdfInputRef.current?.click()}
                    disabled={uploadingPdf}
                    className="w-full flex flex-col items-center justify-center gap-2 py-5 border-2 border-dashed border-border rounded-xl text-muted hover:bg-surface hover:text-primary transition-colors cursor-pointer"
                  >
                    {uploadingPdf ? (
                      <div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                    ) : (
                      <>
                        <FileText size={28} />
                        <span className="text-sm font-semibold text-main">Unggah Berkas PDF Ebook</span>
                        <span className="text-xs text-muted">Format .pdf maksimal 25MB</span>
                      </>
                    )}
                  </button>
                )}
                <input
                  type="file"
                  ref={pdfInputRef}
                  onChange={handlePdfUpload}
                  accept="application/pdf,.pdf"
                  className="hidden"
                />
              </div>
            )}

            {/* Physical book inventory */}
            {!isEbook && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="book-stock" className="form-label">
                    Jumlah Eksemplar <span className="text-danger">*</span>
                  </label>
                  <input
                    id="book-stock"
                    type="number"
                    min="0"
                    className={`form-control ${errors.stock ? "border-danger-text" : ""}`}
                    value={form.stock}
                    onChange={e => setForm({ ...form, stock: e.target.value })}
                    disabled={loading}
                  />
                  {errors.stock && <p className="text-xs text-danger mt-1">{errors.stock}</p>}
                </div>
                <div>
                  <label htmlFor="book-year" className="form-label">Tahun Terbit</label>
                  <input
                    id="book-year"
                    type="number"
                    className="form-control"
                    value={form.year}
                    onChange={e => setForm({ ...form, year: e.target.value })}
                    placeholder="Contoh: 2023"
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {isEbook && (
              <div>
                <label htmlFor="book-year-ebook" className="form-label">Tahun Terbit</label>
                <input
                  id="book-year-ebook"
                  type="number"
                  className="form-control"
                  value={form.year}
                  onChange={e => setForm({ ...form, year: e.target.value })}
                  placeholder="Contoh: 2023"
                  disabled={loading}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="book-publisher" className="form-label">Penerbit</label>
                <input
                  id="book-publisher"
                  className="form-control"
                  value={form.publisher}
                  onChange={e => setForm({ ...form, publisher: e.target.value })}
                  placeholder="Nama penerbit"
                  disabled={loading}
                />
              </div>
              <div>
                <label htmlFor="book-isbn" className="form-label">ISBN</label>
                <input
                  id="book-isbn"
                  className="form-control"
                  value={form.isbn}
                  onChange={e => setForm({ ...form, isbn: e.target.value })}
                  placeholder="978-..."
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <label htmlFor="book-desc" className="form-label">Sinopsis / Ringkasan Buku</label>
              <textarea
                id="book-desc"
                rows={3}
                className="form-control resize-none"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Tuliskan sinopsis singkat mengenai isi buku..."
                disabled={loading}
              />
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}