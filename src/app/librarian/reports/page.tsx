import DashboardLayout from "@/components/layout/DashboardLayout";
import ReportsDashboard from "@/components/reports/ReportsDashboard";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Laporan Perpustakaan - DigiLib Pustakawan",
};

export default async function LibrarianReportsPage() {
  const session = await getServerSession(authOptions);
  
  // ADMIN ikut diizinkan: laporan yang sama dipakai oleh kedua peran, dan
  // mengarahkan Admin ke /login akan menyesatkan.
  if (!session?.user || (session.user.role !== "LIBRARIAN" && session.user.role !== "ADMIN")) {
    redirect("/login");
  }

  return (
    <DashboardLayout>
      <ReportsDashboard />
    </DashboardLayout>
  );
}
