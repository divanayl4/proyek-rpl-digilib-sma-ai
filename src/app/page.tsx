import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { BookCard } from "@/components/books/BookCard";
import { serializeBook } from "@/lib/books";
import { BookOpen, Users, Library, ArrowRight, Sparkles, Search } from "lucide-react";

export const metadata = {
  title: "Perpustakaan Digital SMA",
  description: "Akses ribuan koleksi buku digital dan fisik dengan mudah.",
};

async function getLandingData() {
  const [totalBooks, totalUsers, activeBorrows, recentBooks] = await Promise.all([
    prisma.book.count({ where: { archivedAt: null } }),
    prisma.user.count(),
    prisma.borrowRecord.count({ where: { status: { in: ["BORROWED", "OVERDUE"] } } }),
    prisma.book.findMany({
      where: { archivedAt: null },
      take: 4,
      orderBy: { createdAt: "desc" },
      include: { category: { select: { name: true } } },
    }),
  ]);

  const recentBooksWithAvailable = await Promise.all(
    recentBooks.map(async (book) => {
      const activeBorrows = await prisma.borrowRecord.count({
        where: { bookId: book.id, status: { in: ["BORROWED", "OVERDUE"] } },
      });
      // filePath (lokasi berkas ebook di server) tidak boleh ikut ke klien.
      return serializeBook({
        ...book,
        available: book.stock - activeBorrows,
      });
    })
  );

  return { totalBooks, totalUsers, activeBorrows, recentBooks: recentBooksWithAvailable };
}

export default async function Home() {
  const data = await getLandingData();

  return (
    <main className="min-h-screen bg-bg-base flex flex-col">
      {/* Navbar Minimalis */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 text-main font-bold text-lg sm:text-xl tracking-tight min-w-0">
            <span className="app-sidebar__logo brand-mark-sm" aria-hidden="true">
              <BookOpen size={21} />
            </span>
            <span className="truncate">DigiLib SMA</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <Link href="/catalog" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-primary transition-colors px-2 py-2">
              <Search size={15} /> Katalog
            </Link>
            <Link href="/login" className="px-4 sm:px-5 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary-600 rounded-full shadow-primary/20 transition-all hover:-translate-y-0.5 min-h-11 inline-flex items-center">
              Masuk
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-44 lg:pb-28 px-4 sm:px-6 overflow-hidden">
        {/* Ornamen Latar Belakang — empat warna pastel */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] max-w-[90vw] max-h-[90vw] bg-primary-300/30 rounded-full blur-3xl opacity-50 -z-10 animate-pulse" aria-hidden="true"></div>
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] max-w-[70vw] max-h-[70vw] bg-blue-300/20 rounded-full blur-3xl opacity-60 -z-10" aria-hidden="true"></div>
        <div className="absolute top-16 left-0 w-[300px] h-[300px] max-w-[60vw] max-h-[60vw] bg-green-pastel rounded-full blur-3xl opacity-40 -z-10" aria-hidden="true"></div>
        <div className="absolute bottom-10 left-1/3 w-[280px] h-[280px] max-w-[60vw] max-h-[60vw] bg-yellow-pastel rounded-full blur-3xl opacity-40 -z-10" aria-hidden="true"></div>
        
        <div className="max-w-5xl mx-auto text-center z-10">
          <span className="chip mb-6">
            <Sparkles size={14} /> Perpustakaan digital berbasis AI
          </span>
          <h1 className="text-5xl md:text-7xl font-extrabold text-main tracking-tight leading-[1.1] mb-6">
            Eksplorasi Dunia Tanpa Batas <br className="hidden md:block" />
            <span className="hero-gradient-text">
              Melalui Literasi
            </span>
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
            Akses ribuan koleksi buku digital, materi pembelajaran, dan referensi akademik di Perpustakaan Digital SMA secara instan.
          </p>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 max-w-md sm:max-w-none mx-auto">
            <Link 
              href="/catalog" 
              className="group px-8 py-4 text-base font-semibold text-white bg-primary rounded-full shadow-primary/20 hover:bg-primary-600 transition-all flex items-center justify-center gap-2 hover:-translate-y-1 min-h-12"
            >
              Mulai Membaca 
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link 
              href="/login" 
              className="px-8 py-4 text-base font-semibold text-main bg-white border border-border rounded-full hover:bg-surface-purple hover:border-primary-200 transition-all shadow-sm flex items-center justify-center min-h-12"
            >
              Masuk ke Akun
            </Link>
          </div>
        </div>
      </section>

      {/* Statistik Section */}
      <section className="py-10 sm:py-12 bg-white border-y border-border relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
            <div className="flex flex-col items-center p-5 rounded-2xl bg-surface-purple border border-border-purple">
              <div className="w-12 h-12 rounded-xl bg-white text-accent-purple flex items-center justify-center mb-3 shadow-xs">
                <BookOpen size={24} />
              </div>
              <h3 className="text-4xl font-extrabold text-main mb-1 tabular-nums">{data.totalBooks}</h3>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider text-center">Koleksi Buku</p>
            </div>
            
            <div className="flex flex-col items-center p-5 rounded-2xl bg-surface-green border border-border-green">
              <div className="w-12 h-12 rounded-xl bg-white text-accent-green flex items-center justify-center mb-3 shadow-xs">
                <Users size={24} />
              </div>
              <h3 className="text-4xl font-extrabold text-main mb-1 tabular-nums">{data.totalUsers}</h3>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider text-center">Anggota Aktif</p>
            </div>
            
            <div className="flex flex-col items-center p-5 rounded-2xl bg-surface-blue border border-border-blue">
              <div className="w-12 h-12 rounded-xl bg-white text-accent-blue flex items-center justify-center mb-3 shadow-xs">
                <Library size={24} />
              </div>
              <h3 className="text-4xl font-extrabold text-main mb-1 tabular-nums">{data.activeBorrows}</h3>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider text-center">Peminjaman Berjalan</p>
            </div>
          </div>
        </div>
      </section>

      {/* Koleksi Terbaru Section */}
      <section className="py-24 px-4 sm:px-6 bg-bg-base relative z-10 flex-1">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
            <div>
              <span className="chip mb-3">Koleksi pilihan</span>
              <h2 className="text-3xl font-bold text-main mb-2">Koleksi Terbaru</h2>
              <p className="text-muted max-w-2xl">Buku-buku fiksi dan non-fiksi yang baru ditambahkan ke perpustakaan.</p>
            </div>
            <Link 
              href="/catalog" 
              className="text-primary font-semibold hover:text-primary-700 flex items-center gap-1 group min-h-11"
            >
              Lihat Semua Katalog 
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {data.recentBooks.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-surface border-t border-border py-10 sm:py-12 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2.5 text-main font-bold text-lg sm:text-xl">
            <span className="app-sidebar__logo brand-mark-sm" aria-hidden="true">
              <BookOpen size={19} />
            </span>
            <span>DigiLib SMA</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <Link href="/catalog" className="text-muted hover:text-primary transition-colors">Katalog</Link>
            <Link href="/login" className="text-muted hover:text-primary transition-colors">Masuk</Link>
            <Link href="/register" className="text-muted hover:text-primary transition-colors">Daftar</Link>
          </div>
          <p className="text-muted text-xs sm:text-sm text-center">
            &copy; {new Date().getFullYear()} Perpustakaan Digital SMA. Hak Cipta Dilindungi.
          </p>
        </div>
      </footer>
    </main>
  );
}
