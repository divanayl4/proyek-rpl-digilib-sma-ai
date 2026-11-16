import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen, History, Library } from "lucide-react";
import Link from "next/link";

export default async function StaffPage() {
  const session = await getServerSession(authOptions);

  // Otorisasi diperiksa di server sebelum data pribadi diambil.
  if (!session?.user) {
    redirect("/login");
  }
  if (!["ADMIN", "STAFF"].includes(session.user.role)) {
    redirect("/dashboard");
  }
  const userId = session.user.id;

  // Fetch data
  const now = new Date();
  const activeStatuses = ["BORROWED", "OVERDUE"];

  const borrowedBooksCount = await prisma.borrowRecord.count({
    where: { userId, status: { in: activeStatuses } }
  });

  const activeBorrows = await prisma.borrowRecord.findMany({
    where: { userId, status: { in: activeStatuses } },
    include: { book: true },
    orderBy: { dueDate: 'asc' },
    take: 3
  });

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">Dasbor Staf</h1>
            <p className="page-description">Selamat datang, {session?.user?.name}.</p>
          </div>
          <div className="page-actions">
            <Link href="/catalog">
              <Button variant="primary">
                <Library size={18} /> Katalog Perpustakaan
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="stat-card">
            <div className="stat-card__icon icon-tile--blue" aria-hidden="true">
              <BookOpen size={24} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Buku Dipinjam</p>
              <p className="stat-card__value">{borrowedBooksCount}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon icon-tile--purple" aria-hidden="true">
              <History size={24} />
            </div>
            <div className="min-w-0">
              <p className="stat-card__label">Akses Riwayat</p>
              <p className="stat-card__value text-lg">
                <Link href="/staff/history" className="text-primary hover:underline">Lihat Semua</Link>
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <Card className="card-accent-blue">
            <CardHeader>
              <CardTitle>Sedang Dipinjam</CardTitle>
              <CardDescription>Buku yang ada di tangan Anda saat ini</CardDescription>
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
                  description="Anda belum meminjam buku apa pun saat ini."
                  action={<Link href="/catalog"><Button>Lihat Katalog</Button></Link>}
                />
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
