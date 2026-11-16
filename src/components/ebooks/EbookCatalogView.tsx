"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { EbookCard, EbookListItem } from "./EbookCard";
import { EBOOK_CONFIG, canBorrowEbook, canManageEbooks } from "@/lib/config/ebook";
import { FileText, ShieldCheck, AlertTriangle, CheckCircle } from "lucide-react";

const STATE_OPTIONS = [
  { value: "", label: "Semua Status" },
  { value: "NOT_BORROWED", label: "Belum Dipinjam" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "EXPIRED", label: "Kedaluwarsa" },
];

export default function EbookCatalogView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  // Admin dan Pustakawan hanya menelusuri katalog (tanpa aksi peminjaman),
  // tetapi boleh membaca isi ebook lewat "Lihat Buku".
  const viewerCanBorrow = canBorrowEbook(session?.user?.role);
  const viewerCanManage = canManageEbooks(session?.user?.role);

  const [ebooks, setEbooks] = useState<EbookListItem[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [majors, setMajors] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState({
    activeLoanCount: 0,
    maxActiveLoansPerUser: EBOOK_CONFIG.maxActiveLoansPerUser,
    accessDurationDays: EBOOK_CONFIG.accessDurationDays,
  });

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [categoryId, setCategoryId] = useState(() => searchParams.get("category") ?? "");
  const [grade, setGrade] = useState(() => searchParams.get("grade") ?? "");
  const [subject, setSubject] = useState(() => searchParams.get("subject") ?? "");
  const [major, setMajor] = useState(() => searchParams.get("major") ?? "");
  const [state, setState] = useState(() => searchParams.get("state") ?? "");

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchCategories = useCallback(async () => {
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
  }, []);

  const fetchEbooks = useCallback(
    async (p = page, s = search, c = categoryId, st = state, g = grade, subj = subject, mj = major) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          search: s,
          category: c,
          state: st,
          grade: g,
          subject: subj,
          major: mj,
        });
        const res = await fetch(`/api/ebooks?${params}`);
        if (res.ok) {
          const data = await res.json();
          setEbooks(data.ebooks);
          setTotal(data.total);
          setTotalPages(data.totalPages);
          setSummary(data.summary);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    },
    [page, search, categoryId, state, grade, subject, major]
  );

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchEbooks();
  }, [fetchEbooks]);

  const refresh = useCallback(
    (st: string = state) => {
      fetchEbooks(page, search, categoryId, st);
    },
    [fetchEbooks, page, search, categoryId, state]
  );

  const handleBorrow = async (ebook: EbookListItem) => {
    if (!session?.user) {
      router.push("/login");
      return;
    }
    setBusyId(ebook.id);
    setFeedback(null);
    try {
      const res = await fetch("/api/ebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: ebook.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({
          type: "success",
          message: `Ebook "${ebook.title}" berhasil dipinjam. Masa akses ${data.accessDurationDays} hari.`,
        });
      } else {
        setFeedback({ type: "error", message: data.error || "Gagal meminjam ebook" });
      }
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan" });
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const handleReturn = async (ebook: EbookListItem) => {
    setBusyId(ebook.id);
    setFeedback(null);
    try {
      const res = await fetch("/api/ebooks/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: ebook.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: "success", message: `Ebook "${ebook.title}" telah dikembalikan.` });
      } else {
        setFeedback({ type: "error", message: data.error || "Gagal mengembalikan ebook" });
      }
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan" });
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchEbooks(1, value, categoryId, state, grade, subject, major), 400);
  };

  const handleCategoryChange = (value: string) => {
    setCategoryId(value);
    setPage(1);
    fetchEbooks(1, search, value, state, grade, subject, major);
  };

  const handleGradeChange = (value: string) => {
    setGrade(value);
    setPage(1);
    fetchEbooks(1, search, categoryId, state, value, subject, major);
  };

  const handleSubjectChange = (value: string) => {
    setSubject(value);
    setPage(1);
    fetchEbooks(1, search, categoryId, state, grade, value, major);
  };

  const handleMajorChange = (value: string) => {
    setMajor(value);
    setPage(1);
    fetchEbooks(1, search, categoryId, state, grade, subject, value);
  };

  const handleStateChange = (value: string) => {
    setState(value);
    setPage(1);
    fetchEbooks(1, search, categoryId, value, grade, subject, major);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading">Ebook</h1>
          <p className="page-description">
            {viewerCanBorrow
              ? `Pinjam dan baca ${total} ebook langsung di DigiLib`
              : viewerCanManage
              ? `Tinjau dan baca ${total} koleksi ebook DigiLib`
              : `Telusuri ${total} koleksi ebook DigiLib`}
          </p>
        </div>
      </div>

      {/* Access policy banner (borrowers only) */}
      {viewerCanBorrow && (
      <div className="flex items-start gap-3 p-4 rounded-xl bg-info-bg border border-border">
        <ShieldCheck size={20} style={{ color: "var(--color-info-text)" }} className="mt-0.5 flex-shrink-0" />
        <p className="text-sm" style={{ color: "var(--color-info-text)" }}>
          Setiap peminjaman memberi akses baca selama{" "}
          <strong>{summary.accessDurationDays} hari</strong>. Setelah masa akses habis,
          ebook terkunci otomatis dan hanya bisa dikembalikan. Maksimal{" "}
          {summary.maxActiveLoansPerUser} ebook aktif secara bersamaan.
        </p>
      </div>
      )}

      {/* Manager banner (Admin/Pustakawan) */}
      {!viewerCanBorrow && viewerCanManage && (
      <div className="flex items-start gap-3 p-4 rounded-xl bg-info-bg border border-border">
        <ShieldCheck size={20} style={{ color: "var(--color-info-text)" }} className="mt-0.5 flex-shrink-0" />
        <p className="text-sm" style={{ color: "var(--color-info-text)" }}>
          Sebagai pengelola, klik <strong>Lihat Buku</strong> untuk membaca isi ebook
          tanpa meminjam. Aktivitas ini tidak membuat transaksi dan tidak mengubah
          masa akses peminjaman pengguna.
        </p>
      </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="min-w-0 sm:col-span-2 lg:col-span-1">
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Cari judul, penulis, mapel, jurusan, atau ISBN..."
            aria-label="Cari ebook"
            wrapperClassName="min-w-0"
          />
        </div>
        <Select
          value={grade}
          onChange={(e) => handleGradeChange(e.target.value)}
          className="w-full"
          aria-label="Filter kelas"
        >
          <option value="">Semua Kelas</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              Kelas {g}
            </option>
          ))}
        </Select>
        <Select
          value={subject}
          onChange={(e) => handleSubjectChange(e.target.value)}
          className="w-full"
          aria-label="Filter mata pelajaran"
        >
          <option value="">Semua Mata Pelajaran</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          value={major}
          onChange={(e) => handleMajorChange(e.target.value)}
          className="w-full"
          aria-label="Filter jurusan"
        >
          <option value="">Semua Jurusan</option>
          {majors.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select
          value={categoryId}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="w-full"
          aria-label="Filter kategori"
        >
          <option value="">Semua Kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {!viewerCanManage && (
          <Select
            value={state}
            onChange={(e) => handleStateChange(e.target.value)}
            className="w-full"
            aria-label="Filter status peminjaman"
          >
            {STATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        )}
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className="flex items-start gap-2 p-3 rounded-xl text-sm"
          style={{
            backgroundColor:
              feedback.type === "success" ? "var(--color-success-bg)" : "var(--color-danger-bg)",
            color:
              feedback.type === "success"
                ? "var(--color-success-text)"
                : "var(--color-danger-text)",
          }}
        >
          {feedback.type === "success" ? (
            <CheckCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
          ) : (
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <LoadingState message="Memuat katalog ebook..." />
      ) : ebooks.length === 0 ? (
        <EmptyState
          title="Ebook tidak ditemukan"
          description="Tidak ada ebook yang cocok dengan filter yang dipilih."
          icon={<FileText size={32} />}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch("");
                setCategoryId("");
                setGrade("");
                setSubject("");
                setMajor("");
                setState("");
                setPage(1);
                fetchEbooks(1, "", "", "", "", "", "");
              }}
            >
              Reset Filter
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {ebooks.map((ebook) => (
            <EbookCard
              key={ebook.id}
              ebook={ebook}
              isBusy={busyId === ebook.id}
              maxActiveLoans={summary.maxActiveLoansPerUser}
              canBorrowRole={viewerCanBorrow}
              canManage={viewerCanManage}
              onBorrow={handleBorrow}
              onReturn={handleReturn}
              onOpenReader={(e) => router.push(`/ebooks/${e.id}/baca`)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}