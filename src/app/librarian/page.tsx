import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Table, TableContainer, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Library, BookOpen, AlertTriangle, Clock, FileText } from "lucide-react";

export default async function LibrarianPage() {
  const session = await getServerSession(authOptions);

  // Otorisasi diperiksa di server sebelum statistik operasional diambil.
  if (!session?.user) {
    redirect("/login");
  }
  if (!["ADMIN", "LIBRARIAN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  // Fetch stats operasional seluruh perpustakaan
  const now = new Date();
  const activeStatuses = ["BORROWED", "OVERDUE"];

  const [
    totalBooks,
    borrowedPhysicalBooks,
    activeEbooks,
    pendingRequests,
    lateBooks,
    recentBorrows,
  ] = await Promise.all([
    prisma.book.count({ where: { archivedAt: null } }),
    prisma.borrowRecord.count({ where: { status: { in: activeStatuses } } }),
    prisma.ebookLoan.count({
      where: { returnedAt: null, expiresAt: { gt: now } },
    }),
    prisma.borrowRecord.count({ where: { status: "REQUESTED" } }),
    prisma.borrowRecord.count({
      where: { status: { in: activeStatuses }, dueDate: { lt: now } },
    }),
    prisma.borrowRecord.findMany({
      take: 5,
      orderBy: { borrowDate: "desc" },
      include: {
        user: { select: { name: true } },
        book: { select: { title: true } },
      },
    }),
  ]);

  const stats = [
    { label: "Total Koleksi", value: totalBooks, icon: Library, accent: "icon-tile--purple" },
    { label: "Total Buku Fisik Dipinjam", value: borrowedPhysicalBooks, icon: BookOpen, accent: "icon-tile--blue" },
    { label: "Total Ebook Dipinjam", value: activeEbooks, icon: FileText, accent: "icon-tile--green" },
    { label: "Menunggu Persetujuan", value: pendingRequests, icon: Clock, accent: "icon-tile--yellow" },
    { label: "Buku Terlambat", value: lateBooks, icon: AlertTriangle, accent: "icon-tile--danger" },
  ];

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">Dasbor Pustakawan</h1>
            <p className="page-description">Kelola koleksi dan peminjaman buku.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {stats.map((stat, index) => (
            <div key={index} className="stat-card">
              <div className={`stat-card__icon ${stat.accent}`} aria-hidden="true">
                <stat.icon size={24} />
              </div>
              <div className="min-w-0">
                <p className="stat-card__label">{stat.label}</p>
                <p className="stat-card__value">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>

        <Card className="card-accent-blue">
          <CardHeader>
            <CardTitle>Aktivitas Peminjaman Terbaru</CardTitle>
            <CardDescription>Daftar transaksi peminjaman buku terakhir</CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            {recentBorrows.length > 0 ? (
              <TableContainer className="border-none shadow-none rounded-none">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Peminjam</Th>
                      <Th>Buku</Th>
                      <Th>Tanggal Pinjam</Th>
                      <Th>Tenggat Waktu</Th>
                      <Th>Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {recentBorrows.map((borrow) => {
                      const isReturned = borrow.status === 'RETURNED';
                      const isCancelled = borrow.status === 'CANCELLED';
                      const isRequested = borrow.status === 'REQUESTED';
                      const isRejected = borrow.status === 'REJECTED';
                      const isOverdue =
                        borrow.status === 'OVERDUE' ||
                        (borrow.status === 'BORROWED' && borrow.dueDate < now);
                      return (
                      <Tr key={borrow.id}>
                        <Td className="font-medium text-main">{borrow.user.name}</Td>
                        <Td>{borrow.book.title}</Td>
                        <Td>{new Date(borrow.borrowDate).toLocaleDateString('id-ID')}</Td>
                        <Td>{new Date(borrow.dueDate).toLocaleDateString('id-ID')}</Td>
                        <Td>
                          <Badge variant={
                            isOverdue ? 'danger' :
                            isRejected ? 'danger' :
                            isReturned ? 'success' :
                            isRequested ? 'warning' :
                            isCancelled ? 'default' : 'info'
                          }>
                            {isOverdue ? 'Terlambat' :
                             isRejected ? 'Ditolak' :
                             isReturned ? 'Dikembalikan' :
                             isRequested ? 'Menunggu' :
                             isCancelled ? 'Dibatalkan' : 'Dipinjam'}
                          </Badge>
                        </Td>
                      </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </TableContainer>
            ) : (
              <EmptyState 
                title="Belum ada transaksi" 
                description="Saat ini belum ada aktivitas peminjaman buku yang tercatat di sistem."
              />
            )}
          </CardBody>
        </Card>
      </div>
    </DashboardLayout>
  );
}
