import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTransactionStats } from "@/lib/transactionStats";
import { EBOOK_FORMAT, PHYSICAL_FORMAT } from "@/lib/config/ebook";
import DashboardLayout from "@/components/layout/DashboardLayout";
import SystemActivityChart from "@/components/admin/SystemActivityChart";
import RecentUsersTable from "@/components/admin/RecentUsersTable";
import { Users, Library, History, BookOpen, FileText, BookMarked } from "lucide-react";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  // Otorisasi diperiksa di server sebelum data sensitif diambil, sehingga
  // halaman ini tidak bergantung pada middleware saja.
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  // Metrik transaksi memakai definisi yang sama dengan halaman Transaksi:
  // buku fisik hanya BorrowRecord, ebook hanya EbookLoan, total adalah
  // penjumlahan kedua sumber yang terpisah.
  const [totalUsers, totalPhysicalBooks, totalEbooks, transactionStats] = await Promise.all([
    prisma.user.count(),
    prisma.book.count({
      where: { archivedAt: null, format: PHYSICAL_FORMAT },
    }),
    prisma.book.count({
      where: { archivedAt: null, format: EBOOK_FORMAT },
    }),
    getTransactionStats(),
  ]);

  const stats = [
    { label: "Total Pengguna", value: totalUsers, icon: Users, accent: "icon-tile--purple" },
    { label: "Total Buku Fisik", value: totalPhysicalBooks, icon: Library, accent: "icon-tile--green" },
    { label: "Total Ebook", value: totalEbooks, icon: FileText, accent: "icon-tile--blue" },
    { label: "Total Transaksi Buku Fisik", value: transactionStats.physicalTotal, icon: BookMarked, accent: "icon-tile--yellow" },
    { label: "Total Transaksi Ebook", value: transactionStats.ebookTotal, icon: FileText, accent: "icon-tile--green" },
    { label: "Total Transaksi Keseluruhan", value: transactionStats.total, icon: History, accent: "icon-tile--purple" },
    { label: "Peminjaman Buku Fisik Aktif", value: transactionStats.physicalActive, icon: BookOpen, accent: "icon-tile--blue" },
    { label: "Sesi Ebook Aktif", value: transactionStats.ebookActive, icon: BookOpen, accent: "icon-tile--blue" },
  ];

  return (
    <DashboardLayout>
      <div className="page-shell">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-heading">Dasbor Administrator</h1>
            <p className="page-description">Ikhtisar sistem perpustakaan hari ini.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SystemActivityChart />
          <RecentUsersTable />
        </div>
      </div>
    </DashboardLayout>
  );
}
