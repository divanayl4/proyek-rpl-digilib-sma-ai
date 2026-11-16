import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserActiveLoans } from "@/lib/transactionStats";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen, FileText, GraduationCap, Search } from "lucide-react";
import Link from "next/link";

export default async function TeacherPage() {
  const session = await getServerSession(authOptions);

  // Otorisasi diperiksa di server sebelum data pribadi diambil.
  if (!session?.user) {
    redirect("/login");
  }
  if (!["ADMIN", "TEACHER"].includes(session.user.role)) {
    redirect("/dashboard");
  }
  const userId = session.user.id;

  // Fetch data
  const now = new Date();
  const activeStatuses = ["BORROWED", "OVERDUE"];

  const [activeLoans, activeBorrows, references] = await Promise.all([
    getUserActiveLoans(userId, now),
    prisma.borrowRecord.findMany({
      where: { userId, status: { in: activeStatuses } },
      include: { book: true },
      orderBy: { dueDate: "asc" },
      take: 3,
    }),
    prisma.book.findMany({
      where: { archivedAt: null },
      take: 3,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">Dasbor Guru</h1>
            <p className="page-description">
              Selamat datang, {session?.user?.name}. Jelajahi referensi mengajar.
            </p>
          </div>
          <div className="page-actions">
            <Link href="/catalog">
              <Button variant="primary">
                <Search size={18} /> Cari Referensi
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
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
            <div className="stat-card__icon icon-tile--green" aria-hidden="true">
              <FileText size={24} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Total Ebook Dipinjam</p>
              <p className="stat-card__value">{activeLoans.ebookActive}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon icon-tile--purple" aria-hidden="true">
              <GraduationCap size={24} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Materi Pembelajaran Baru</p>
              <p className="stat-card__value">{references.length}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="card-accent-blue">
            <CardHeader>
              <CardTitle>Bahan Ajar Sedang Dipinjam</CardTitle>
              <CardDescription>Buku referensi yang ada di tangan Anda</CardDescription>
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
                  description="Anda belum meminjam buku referensi apa pun saat ini."
                  action={<Link href="/catalog"><Button>Cari Referensi</Button></Link>}
                />
              )}
            </CardBody>
          </Card>

          <Card className="card-accent-purple">
            <CardHeader>
              <CardTitle>Rekomendasi Referensi Mengajar</CardTitle>
              <CardDescription>Pilihan literatur untuk mendukung KBM</CardDescription>
            </CardHeader>
            <CardBody className="pt-0">
              {references.length > 0 ? (
                <div className="space-y-4">
                  {references.map(book => (
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
                  description="Katalog buku referensi masih kosong."
                />
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
