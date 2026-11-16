"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { ArrowLeft, BookOpen, Hash, Calendar, Building, CheckCircle, AlertTriangle, FileText, GraduationCap, Layers, Briefcase } from "lucide-react";
import { BookCard } from "./BookCard";
import BorrowRequestModal from "@/components/borrows/BorrowRequestModal";
import { LIBRARY_CONFIG } from "@/lib/config/library";
import { canBorrowEbook, canManageEbooks } from "@/lib/config/ebook";

export default function BookDetailView({ bookId }: { bookId: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [book, setBook] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [borrowing, setBorrowing] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [borrowResult, setBorrowResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const fetchBookAndRecommendations = async () => {
      try {
        const res = await fetch(`/api/books/${bookId}`);
        if (!res.ok) {
          setError("Buku tidak ditemukan");
          return;
        }
        const data = await res.json();
        setBook(data.book);

        // Fetch recommendations (same category)
        if (data.book.categoryId) {
          const recRes = await fetch(`/api/books?category=${data.book.categoryId}`);
          if (recRes.ok) {
            const recData = await recRes.json();
            // Filter out current book, take up to 4
            const recs = recData.books
              .filter((b: any) => b.id !== data.book.id)
              .slice(0, 4);
            setRecommendations(recs);
          }
        } else {
          // If no category, just get latest
          const recRes = await fetch(`/api/books`);
          if (recRes.ok) {
            const recData = await recRes.json();
            const recs = recData.books
              .filter((b: any) => b.id !== data.book.id)
              .slice(0, 4);
            setRecommendations(recs);
          }
        }
      } catch (err) {
        setError("Gagal memuat detail buku");
      } finally {
        setLoading(false);
      }
    };

    fetchBookAndRecommendations();
  }, [bookId]);

  const handleBorrowSuccess = async (data: { status?: string }) => {
    setIsRequestModalOpen(false);
    if (data.status === "REQUESTED") {
      setBorrowResult({
        type: "success",
        message: `Pengajuan peminjaman "${book.title}" terkirim. Menunggu persetujuan pustakawan.`,
      });
    } else {
      setBorrowResult({ type: "success", message: `Berhasil meminjam "${book.title}". Silakan ambil di perpustakaan.` });
    }
    // Refresh book availability
    const refreshed = await fetch(`/api/books/${bookId}`);
    if (refreshed.ok) { const d = await refreshed.json(); setBook(d.book); }
  };

  const handleEbookAction = async () => {
    if (!session?.user) { router.push("/login"); return; }
    setBorrowing(true);
    setBorrowResult(null);
    try {
      const res = await fetch("/api/ebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId }),
      });
      const data = await res.json();
      if (res.ok || (data.error && String(data.error).includes("masih aktif"))) {
        // Either just borrowed, or already within an active window – open reader.
        router.push(`/ebooks/${bookId}/baca`);
        return;
      }
      setBorrowResult({ type: "error", message: data.error || "Gagal membuka ebook" });
    } catch {
      setBorrowResult({ type: "error", message: "Terjadi kesalahan jaringan" });
    } finally {
      setBorrowing(false);
    }
  };

  // Physical books follow the library borrower roles; ebooks follow the
  // ebook-specific roles (Siswa/Guru only – Admin & Pustakawan excluded).
  const canBorrow = session?.user && LIBRARY_CONFIG.borrowerRoles.includes(session.user.role);
  const canBorrowDigital = session?.user && canBorrowEbook(session.user.role);
  // Admin/Pustakawan may read any ebook PDF directly ("Lihat Buku") without
  // borrowing; this never creates a transaction.
  const canManageDigital = session?.user && canManageEbooks(session.user.role);

  if (loading) return <div className="py-20"><LoadingState message="Memuat detail buku..." /></div>;
  if (error) return (
    <div className="flex flex-col items-center justify-center py-20">
      <BookOpen size={48} className="text-muted mb-4 opacity-50" />
      <h2 className="text-xl font-bold text-main">{error}</h2>
      <Button variant="secondary" className="mt-4" onClick={() => router.back()}>Kembali</Button>
    </div>
  );
  if (!book) return null;

  const isEbook = book.format === "EBOOK";
  const isReadableEbook = isEbook && book.hasEbookFile;
  const isAvailable = !isEbook && book.available > 0;

  return (
    <div className="page-shell">
      {/* Back button */}
      <div>
        <button 
          onClick={() => router.back()} 
          className="inline-flex items-center gap-2 min-h-11 px-2 rounded-lg text-muted hover:text-primary hover:bg-base transition-colors font-medium"
        >
          <ArrowLeft size={18} aria-hidden="true" /> Kembali ke Katalog
        </button>
      </div>

      <div className="bg-surface rounded-3xl p-5 sm:p-6 md:p-10 shadow-sm border border-border min-w-0">
        <div className="flex flex-col md:flex-row gap-6 md:gap-8 lg:gap-12 min-w-0">
          {/* Cover */}
          <div className="w-full md:w-1/3 lg:w-1/4 max-w-sm mx-auto md:mx-0 flex-shrink-0">
            <div className="aspect-[2/3] relative rounded-2xl overflow-hidden shadow-xl border border-border/50 bg-base">
              {book.coverUrl ? (
                <Image
                  src={book.coverUrl}
                  alt={book.title}
                  fill
                  sizes="(max-width: 768px) 100vw, 25vw"
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted gap-2 bg-gradient-to-br">
                  <BookOpen size={64} className="opacity-20" />
                </div>
              )}
            </div>
            
            <div className="mt-6 flex flex-col gap-3">
              {/* Borrow result feedback */}
              {borrowResult && (
                <div
                  className="flex items-start gap-2 p-3 rounded-xl text-sm"
                  role={borrowResult.type === "error" ? "alert" : "status"}
                  style={{
                    backgroundColor: borrowResult.type === "success" ? "var(--color-success-bg)" : "var(--color-danger-bg)",
                    color: borrowResult.type === "success" ? "var(--color-success-text)" : "var(--color-danger-text)",
                  }}
                >
                  {borrowResult.type === "success" ? <CheckCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} /> : <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />}
                  <span>{borrowResult.message}</span>
                </div>
              )}
              {isEbook ? (
                isReadableEbook ? (
                  canBorrowDigital ? (
                    <Button
                      className="w-full text-lg py-6 rounded-xl"
                      disabled={borrowing}
                      onClick={handleEbookAction}
                    >
                      <FileText size={20} className="mr-2" />
                      {borrowing ? "Memproses..." : "Pinjam & Baca Ebook"}
                    </Button>
                  ) : canManageDigital ? (
                    <Button
                      className="w-full text-lg py-6 rounded-xl"
                      onClick={() => router.push(`/ebooks/${bookId}/baca`)}
                    >
                      <FileText size={20} className="mr-2" />
                      Lihat Buku
                    </Button>
                  ) : session?.user ? (
                    <p className="text-xs text-muted text-center">Hubungi pustakawan untuk meminjam ebook ini.</p>
                  ) : (
                    <Button className="w-full text-lg py-6 rounded-xl" onClick={() => router.push("/login")}>
                      Login untuk Membaca
                    </Button>
                  )
                ) : (
                  <div className="flex items-start gap-2 p-3 rounded-xl text-sm bg-warning-bg" style={{ color: "var(--color-warning-text)" }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                    <span>Berkas PDF ebook ini belum diunggah. Silakan cek kembali nanti.</span>
                  </div>
                )
              ) : canBorrow ? (
                <Button
                  className="w-full text-lg py-6 rounded-xl"
                  disabled={!isAvailable}
                  onClick={() => {
                    setBorrowResult(null);
                    setIsRequestModalOpen(true);
                  }}
                >
                  {isAvailable ? "Ajukan Peminjaman" : "Buku Sedang Dipinjam"}
                </Button>
              ) : session?.user ? (
                <p className="text-xs text-muted text-center">Hubungi pustakawan untuk meminjam buku ini.</p>
              ) : (
                <Button className="w-full text-lg py-6 rounded-xl" onClick={() => router.push("/login")}>
                  Login untuk Meminjam
                </Button>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="mb-6">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {book.category && (
                  <Badge variant="info" className="text-sm px-3 py-1">{book.category.name}</Badge>
                )}
                {isEbook && (
                  <Badge variant="warning" className="text-sm px-3 py-1">
                    <FileText size={14} className="mr-1" /> Ebook
                  </Badge>
                )}
                {!isEbook && (
                  <Badge variant={isAvailable ? "success" : "danger"} className="text-sm px-3 py-1">
                    {isAvailable ? "Tersedia" : "Sedang Dipinjam"}
                  </Badge>
                )}
                {isEbook && !isReadableEbook && (
                  <Badge variant="danger" className="text-sm px-3 py-1">PDF Belum Ada</Badge>
                )}
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-main leading-tight tracking-tight mb-2">
                {book.title}
              </h1>
              <p className="text-lg sm:text-xl text-primary font-medium">{book.author}</p>
            </div>

            <div className="flex items-center gap-6 mb-8 py-5 px-4 rounded-xl bg-surface-blue border border-border-blue">
              {isEbook ? (
                <div className="flex flex-col">
                  <span className="text-muted text-sm mb-1">Jenis Koleksi</span>
                  <span className="text-xl sm:text-2xl font-bold text-main">Ebook Digital</span>
                </div>
              ) : (
                <div className="flex flex-col">
                  <span className="text-muted text-sm mb-1">Tersedia</span>
                  <span className="text-xl sm:text-2xl font-bold text-main">{book.available} <span className="text-base font-normal text-muted">/ {book.stock} eks</span></span>
                </div>
              )}
            </div>

            <div className="mb-8">
              <h2 className="text-lg font-semibold text-main mb-3">Sinopsis</h2>
              <p className="text-muted leading-relaxed whitespace-pre-line text-base sm:text-lg">
                {book.description || "Belum ada sinopsis untuk buku ini."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-auto">
              {(book.grade || book.subject || book.major) && (
                <>
                  {book.grade && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-purple border border-border-purple min-w-0">
                      <GraduationCap className="text-accent-purple mt-0.5 flex-shrink-0" size={20} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted mb-0.5">Kelas</p>
                        <p className="font-medium text-main break-all">{book.grade}</p>
                      </div>
                    </div>
                  )}
                  {book.subject && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-blue border border-border-blue min-w-0">
                      <Layers className="text-accent-blue mt-0.5 flex-shrink-0" size={20} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted mb-0.5">Mata Pelajaran</p>
                        <p className="font-medium text-main break-all">{book.subject}</p>
                      </div>
                    </div>
                  )}
                  {book.major && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-yellow border border-border-yellow min-w-0">
                      <Briefcase className="text-accent-yellow mt-0.5 flex-shrink-0" size={20} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted mb-0.5">Jurusan</p>
                        <p className="font-medium text-main break-all">{book.major}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-green border border-border-green min-w-0">
                <Hash className="text-accent-green mt-0.5 flex-shrink-0" size={20} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-muted mb-0.5">ISBN</p>
                  <p className="font-medium text-main break-all">{book.isbn || "-"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-bg-subtle border border-border min-w-0">
                <Building className="text-muted mt-0.5 flex-shrink-0" size={20} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-muted mb-0.5">Penerbit</p>
                  <p className="font-medium text-main break-all">{book.publisher || "-"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-bg-subtle border border-border min-w-0">
                <Calendar className="text-muted mt-0.5 flex-shrink-0" size={20} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-muted mb-0.5">Tahun Terbit</p>
                  <p className="font-medium text-main break-all">{book.year || "-"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <section aria-labelledby="rekomendasi-terkait">
          <div className="page-header mb-4 sm:mb-6">
            <h2 id="rekomendasi-terkait" className="section-heading text-2xl">Rekomendasi Terkait</h2>
            {book.category && (
              <Link href={`/catalog?category=${book.category.id}`} className="text-primary hover:underline text-sm font-medium min-h-11 inline-flex items-center">
                Lihat Semua {book.category.name}
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {recommendations.map(rec => (
              <BookCard key={rec.id} book={rec} />
            ))}
          </div>
        </section>
      )}

      <BorrowRequestModal
        isOpen={isRequestModalOpen}
        book={{ id: book.id, title: book.title, author: book.author }}
        onClose={() => setIsRequestModalOpen(false)}
        onSuccess={handleBorrowSuccess}
      />
    </div>
  );
}
