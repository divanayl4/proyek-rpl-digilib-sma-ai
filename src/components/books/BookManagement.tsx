"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Plus, Search, Filter, Edit2, Trash2, BookOpen, Layers } from "lucide-react";
import { BookFormModal } from "./BookFormModal";
import { CategoryFormModal } from "./CategoryFormModal";

export function BookManagement() {
  const [books, setBooks] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [majors, setMajors] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [major, setMajor] = useState("");
  
  const [loading, setLoading] = useState(true);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [editBook, setEditBook] = useState<any | null>(null);
  const [deleteBook, setDeleteBook] = useState<any | null>(null);
  
  const [showCategoryModal, setShowCategoryModal] = useState(false);

  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/books/filters");
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories ?? []);
        setGrades(data.grades ?? []);
        setSubjects(data.subjects ?? []);
        setMajors(data.majors ?? []);
      }
    } catch {}
  };

  const fetchBooks = useCallback(async (p = page, s = search, c = categoryId, g = grade, subj = subject, mj = major) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), search: s, category: c, grade: g, subject: subj, major: mj });
      const res = await fetch(`/api/books?${params}`);
      if (res.ok) {
        const data = await res.json();
        setBooks(data.books);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryId, grade, subject, major]);

  useEffect(() => {
    fetchCategories();
    fetchBooks();
  }, [fetchBooks]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchBooks(1, val, categoryId, grade, subject, major), 400);
  };

  const handleCategoryChange = (val: string) => {
    setCategoryId(val);
    setPage(1);
    fetchBooks(1, search, val, grade, subject, major);
  };

  const handleGradeChange = (val: string) => {
    setGrade(val);
    setPage(1);
    fetchBooks(1, search, categoryId, val, subject, major);
  };

  const handleSubjectChange = (val: string) => {
    setSubject(val);
    setPage(1);
    fetchBooks(1, search, categoryId, grade, val, major);
  };

  const handleMajorChange = (val: string) => {
    setMajor(val);
    setPage(1);
    fetchBooks(1, search, categoryId, grade, subject, val);
  };

  const handleDelete = async () => {
    if (!deleteBook) return;
    try {
      const res = await fetch(`/api/books/${deleteBook.id}`, { method: "DELETE" });
      if (res.ok) {
        fetchBooks();
      } else {
        const data = await res.json();
        alert(data.error || "Gagal menghapus buku");
      }
    } catch {}
    setDeleteBook(null);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <BookOpen size={24} className="flex-shrink-0" aria-hidden="true" /> Katalog Buku
          </h1>
          <p className="page-description">Total {total} buku terdaftar di sistem</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => setShowCategoryModal(true)}>
            <Layers size={18} className="mr-2" /> Kategori
          </Button>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus size={18} className="mr-2" /> Tambah Buku
          </Button>
        </div>
      </div>

      <Card>
        <div className="p-4 flex flex-col lg:flex-row gap-3 lg:flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              className="form-control pl-9"
              placeholder="Cari judul, penulis, mata pelajaran, jurusan, atau ISBN..."
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              aria-label="Cari buku"
            />
          </div>
          <select className="form-control lg:w-40" value={grade} onChange={e => handleGradeChange(e.target.value)} aria-label="Filter kelas">
            <option value="">Semua Kelas</option>
            {grades.map(g => <option key={g} value={g}>Kelas {g}</option>)}
          </select>
          <select className="form-control lg:w-48" value={subject} onChange={e => handleSubjectChange(e.target.value)} aria-label="Filter mata pelajaran">
            <option value="">Semua Mata Pelajaran</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-control lg:w-48" value={major} onChange={e => handleMajorChange(e.target.value)} aria-label="Filter jurusan">
            <option value="">Semua Jurusan</option>
            {majors.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <select
              className="form-control pl-9 lg:w-48"
              value={categoryId}
              onChange={e => handleCategoryChange(e.target.value)}
              aria-label="Filter kategori"
            >
              <option value="">Semua Kategori</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {loading ? (
        <LoadingState message="Memuat daftar buku..." />
      ) : books.length === 0 ? (
        <EmptyState
          title="Tidak ada buku"
          description={search || categoryId || grade || subject || major ? "Coba ubah kata kunci atau filter yang dipilih." : "Mulai dengan menambahkan buku baru ke katalog."}
          action={!search && !categoryId && !grade && !subject && !major ? <Button onClick={() => setShowAddModal(true)}><Plus size={16}/> Tambah Buku</Button> : undefined}
        />
      ) : (
        <TableContainer>
          <Table>
            <Thead>
              <Tr>
                <Th>Judul Buku</Th>
                <Th>Penulis / ISBN</Th>
                <Th>Kategori</Th>
                <Th>Kurikulum</Th>
                <Th>Ketersediaan</Th>
                <Th className="text-right">Aksi</Th>
              </Tr>
            </Thead>
            <Tbody>
              {books.map(book => (
                <Tr key={book.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-14 bg-bg-subtle rounded border border-border flex-shrink-0 overflow-hidden relative">
                        {book.coverUrl ? (
                          <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted">
                            <BookOpen size={16} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-main line-clamp-1">{book.title}</p>
                        <p className="text-xs text-muted mt-0.5 truncate">{book.publisher || "Tanpa penerbit"} {book.year ? `(${book.year})` : ""}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <p className="font-medium text-main text-sm">{book.author}</p>
                    <p className="text-xs text-muted">{book.isbn || "-"}</p>
                  </Td>
                  <Td>
                    {book.category ? (
                      <Badge variant="info">{book.category.name}</Badge>
                    ) : (
                      <span className="text-muted text-sm italic">Belum kategori</span>
                    )}
                    {book.format === "EBOOK" && (
                      <Badge variant="warning" className="ml-1">Ebook</Badge>
                    )}
                  </Td>
                  <Td>
                    {book.grade || book.subject || book.major ? (
                      <div className="flex flex-col gap-0.5 text-xs">
                        {book.grade && <span className="text-main font-medium">Kelas {book.grade}</span>}
                        {book.subject && <span className="text-muted">{book.subject}</span>}
                        {book.major && <span className="text-muted line-clamp-1">{book.major}</span>}
                      </div>
                    ) : (
                      <span className="text-muted text-sm italic">-</span>
                    )}
                  </Td>
                  <Td>
                    {book.format === "EBOOK" ? (
                      book.hasEbookFile ? (
                        <Badge variant="success">PDF Siap</Badge>
                      ) : (
                        <Badge variant="warning">PDF Belum Ada</Badge>
                      )
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-base rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${book.available > 0 ? "bg-success" : "bg-danger"}`}
                            style={{ width: `${book.stock > 0 ? (book.available / book.stock) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-main">{book.available} / {book.stock}</span>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Edit"
                        aria-label={`Edit buku ${book.title}`}
                        onClick={() => setEditBook(book)}
                        className="row-action hover:bg-base hover:text-primary transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        title="Hapus"
                        aria-label={`Hapus buku ${book.title}`}
                        onClick={() => setDeleteBook(book)}
                        className="row-action hover:bg-danger-bg hover:text-danger transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <div className="px-6 py-3 border-t border-border">
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={p => setPage(p)} />
          </div>
        </TableContainer>
      )}

      {/* Modals */}
      <BookFormModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => fetchBooks(1)}
      />

      {editBook && (
        <BookFormModal
          isOpen={!!editBook}
          onClose={() => setEditBook(null)}
          onSuccess={() => { setEditBook(null); fetchBooks(); }}
          editBook={editBook}
        />
      )}

      <CategoryFormModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
      />

      <ConfirmationDialog
        isOpen={!!deleteBook}
        onClose={() => setDeleteBook(null)}
        onConfirm={handleDelete}
        title="Hapus Buku?"
        message={`Tindakan ini akan menghapus buku "${deleteBook?.title}". Jika buku ini sedang dipinjam atau memiliki riwayat peminjaman, sistem tidak akan mengizinkan penghapusan.`}
        confirmText="Ya, Hapus Buku"
        isDestructive
      />
    </div>
  );
}
