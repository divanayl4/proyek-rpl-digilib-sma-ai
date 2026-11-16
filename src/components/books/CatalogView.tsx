"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookCard } from "./BookCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import { Search, Filter, BookOpen } from "lucide-react";

interface Filters {
  grades: string[];
  subjects: string[];
  majors: string[];
  categories: { id: string; name: string }[];
}

export default function CatalogView() {
  const searchParams = useSearchParams();

  const [books, setBooks] = useState<any[]>([]);
  const [filters, setFilters] = useState<Filters>({ grades: [], subjects: [], majors: [], categories: [] });
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [categoryId, setCategoryId] = useState(() => searchParams.get("category") ?? "");
  const [grade, setGrade] = useState(() => searchParams.get("grade") ?? "");
  const [subject, setSubject] = useState(() => searchParams.get("subject") ?? "");
  const [major, setMajor] = useState(() => searchParams.get("major") ?? "");
  const [availability, setAvailability] = useState(() => searchParams.get("availability") ?? "");

  const [loading, setLoading] = useState(true);

  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchFilters = async () => {
    try {
      const res = await fetch("/api/books/filters");
      if (res.ok) setFilters(await res.json());
    } catch {}
  };

  const fetchBooks = useCallback(
    async (
      p = page,
      s = search,
      c = categoryId,
      a = availability,
      g = grade,
      subj = subject,
      mj = major
    ) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          search: s,
          category: c,
          availability: a,
          grade: g,
          subject: subj,
          major: mj,
        });
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
    },
    [page, search, categoryId, availability, grade, subject, major]
  );

  useEffect(() => {
    fetchFilters();
    fetchBooks();
  }, [fetchBooks]);

  const restart = (overrides: Record<string, unknown> = {}) => {
    const next = { search, categoryId, availability, grade, subject, major, ...overrides };
    setPage(1);
    fetchBooks(1, next.search as string, next.categoryId as string, next.availability as string, next.grade as string, next.subject as string, next.major as string);
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => restart({ search: val }), 400);
  };

  const handleCategoryChange = (val: string) => { setCategoryId(val); restart({ categoryId: val }); };
  const handleGradeChange = (val: string) => { setGrade(val); restart({ grade: val }); };
  const handleSubjectChange = (val: string) => { setSubject(val); restart({ subject: val }); };
  const handleMajorChange = (val: string) => { setMajor(val); restart({ major: val }); };
  const handleAvailabilityChange = (val: string) => { setAvailability(val); restart({ availability: val }); };

  const hasActiveFilter = Boolean(search || categoryId || grade || subject || major || availability);

  const resetFilters = () => {
    setSearch(""); setCategoryId(""); setGrade(""); setSubject(""); setMajor(""); setAvailability("");
    setPage(1);
    fetchBooks(1, "", "", "", "", "", "");
  };

  const selectClass =
    "w-full bg-bg-base border border-border text-main rounded-xl px-4 py-3 appearance-none focus:outline-none focus:ring-2 focus:ring-primary transition-all";

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading">Katalog Buku</h1>
          <p className="page-description">Jelajahi {total} koleksi buku di perpustakaan kami</p>
        </div>
      </div>

      {/* Filter Section */}
      <section
        aria-label="Filter katalog"
        className="pastel-panel pastel-panel--purple flex flex-col gap-4 p-4 sm:p-5"
      >
        <div className="relative w-full">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            aria-label="Cari buku"
            className="w-full bg-surface border border-border text-main rounded-xl pl-11 pr-4 py-3 min-h-11 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            placeholder="Cari judul, penulis, mata pelajaran, jurusan, atau ISBN..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true" />
            <select aria-label="Filter kelas" className={`${selectClass} pl-9`} value={grade} onChange={e => handleGradeChange(e.target.value)}>
              <option value="">Semua Kelas</option>
              {filters.grades.map(g => <option key={g} value={g}>Kelas {g}</option>)}
            </select>
          </div>

          <select aria-label="Filter mata pelajaran" className={selectClass} value={subject} onChange={e => handleSubjectChange(e.target.value)}>
            <option value="">Semua Mata Pelajaran</option>
            {filters.subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select aria-label="Filter jurusan" className={selectClass} value={major} onChange={e => handleMajorChange(e.target.value)}>
            <option value="">Semua Jurusan</option>
            {filters.majors.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <select aria-label="Filter kategori" className={selectClass} value={categoryId} onChange={e => handleCategoryChange(e.target.value)}>
            <option value="">Semua Kategori</option>
            {filters.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <select aria-label="Filter ketersediaan" className={selectClass} value={availability} onChange={e => handleAvailabilityChange(e.target.value)}>
            <option value="">Semua Status</option>
            <option value="available">Tersedia</option>
          </select>
        </div>

        {hasActiveFilter && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={resetFilters}>Reset Filter</Button>
          </div>
        )}
      </section>

      {/* Content */}
      {loading ? (
        <div className="py-20">
          <LoadingState message="Mencari buku..." />
        </div>
      ) : books.length === 0 ? (
        <div className="py-10">
          <EmptyState
            title="Buku tidak ditemukan"
            description={hasActiveFilter ? "Tidak ada buku yang sesuai dengan kriteria pencarian Anda." : "Belum ada koleksi buku di katalog ini."}
            action={hasActiveFilter ? <Button onClick={resetFilters}>Reset Pencarian</Button> : undefined}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 sm:gap-6">
            {books.map(book => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>

          <div className="flex justify-center">
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={p => setPage(p)} />
          </div>
        </div>
      )}
    </div>
  );
}