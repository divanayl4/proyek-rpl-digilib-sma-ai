import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserActiveLoans, getUserHistoryTotals } from "@/lib/transactionStats";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen, Clock, FileText, History, Search } from "lucide-react";
import Link from "next/link";
import { getRecommendationsForUser } from "@/lib/recommendations";

export default async function StudentPage() {
  const session = await getServerSession(authOptions);

  // Otorisasi diperiksa di server sebelum data pribadi diambil.
  if (!session?.user) {
    redirect("/login");
  }
  if (!["ADMIN", "STUDENT"].includes(session.user.role)) {
    redirect("/dashboard");
  }
  const userId = session.user.id;

  // Fetch data
  // Status peminjaman aktif buku fisik adalah BORROWED atau OVERDUE (bukan "LATE").
  // Status peminjaman aktif ebook adalah returnedAt = null dan expiresAt > now.
  const now = new Date();
  const activeStatuses = ["BORROWED", "OVERDUE"];

  const [activeLoans, lateBooksCount, historyTotals, activeBorrows, recommendations] =
    await Promise.all([
      getUserActiveLoans(userId, now),
      prisma.borrowRecord.count({
        where: { userId, status: { in: activeStatuses }, dueDate: { lt: now } },
      }),
      // Total Riwayat = buku fisik (BorrowRecord) + ebook (EbookLoan) milik
      // pengguna yang login, memakai definisi yang sama dengan /api/borrows.
      getUserHistoryTotals(userId),
      prisma.borrowRecord.findMany({
        where: { userId, status: { in: activeStatuses } },
        include: { book: true },
        orderBy: { dueDate: "asc" },
        take: 3,
      }),
      getRecommendationsForUser(userId, 3),
    ]);

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">Dasbor Siswa</h1>
            <p className="page-description">
              Selamat datang, {session?.user?.name}. Ini ringkasan peminjamanmu.
            </p>
          </div>
          <div className="page-actions">
            <Link href="/catalog">
              <Button variant="primary">
                <Search size={18} /> Cari Buku
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--blue" aria-hidden="true">
              <BookOpen size={24} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Total Buku Fisik Dipinjam</p>
              <p className="stat-card__value">{activeLoans.physicalActive}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon icon-tile--purple" aria-hidden="true">
              <FileText size={24} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Total Ebook Dipinjam</p>
              <p className="stat-card__value">{activeLoans.ebookActive}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon icon-tile--danger" aria-hidden="true">
              <Clock size={24} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Terlambat</p>
              <p className="stat-card__value">{lateBooksCount}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon icon-tile--green" aria-hidden="true">
              <History size={24} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Total Riwayat</p>
              <p className="stat-card__value">{historyTotals.total}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="card-accent-blue">
            <CardHeader>
              <CardTitle>Sedang Dipinjam</CardTitle>
              <CardDescription>Perhatikan batas waktu pengembalian buku</CardDescription>
            </CardHeader>
            <CardBody className="pt-0">
              {activeBorrows.length > 0 ? (
                <div className="space-y-4">
                  {activeBorrows.map(borrow => {
                    const isLate = borrow.status === 'OVERDUE' || borrow.dueDate < now;
                    return (
                    <div
                      key={borrow.id}
                      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 border border-border rounded-xl bg-surface hover:bg-base transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className="w-12 h-16 bg-bg-subtle rounded-lg flex-shrink-0 flex items-center justify-center border border-border"
                          aria-hidden="true"
                        >
                          <BookOpen size={20} className="text-muted" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-main line-clamp-1">{borrow.book.title}</p>
                          <p className="text-xs text-muted mt-1">
                            Kembalikan pada: {new Date(borrow.dueDate).toLocaleDateString('id-ID')}
                          </p>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <Badge variant={isLate ? 'danger' : 'info'}>
                          {isLate ? 'Terlambat' : 'Aktif'}
                        </Badge>
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState 
                  title="Tidak ada buku" 
                  description="Kamu belum meminjam buku apa pun saat ini."
                  action={<Link href="/catalog"><Button>Cari Buku</Button></Link>}
                />
              )}
            </CardBody>
          </Card>

          <Card className="card-accent-purple">
            <CardHeader>
              <CardTitle>Rekomendasi Untukmu</CardTitle>
              <CardDescription>Buku-buku terbaru yang mungkin kamu suka</CardDescription>
            </CardHeader>
            <CardBody className="pt-0">
              {recommendations.length > 0 ? (
                <div className="space-y-4">
                  {recommendations.map(book => (
                    <div
                      key={book.id}
                      className="flex items-start gap-4 p-3 rounded-xl hover:bg-base transition-colors"
                    >
                      <div
                        className="w-12 h-16 bg-surface-purple rounded-lg flex-shrink-0 flex items-center justify-center"
                        aria-hidden="true"
                      >
                        <BookOpen size={20} className="text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-main line-clamp-2">{book.title}</p>
                        <p className="text-xs text-muted mt-1">{book.author}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState 
                  title="Belum ada rekomendasi" 
                  description="Katalog buku masih kosong."
                />
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
