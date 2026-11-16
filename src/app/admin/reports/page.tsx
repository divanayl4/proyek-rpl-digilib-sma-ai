import DashboardLayout from "@/components/layout/DashboardLayout";
import ReportsDashboard from "@/components/reports/ReportsDashboard";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Laporan & Analitik - DigiLib Admin",
};

export default async function AdminReportsPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/login");
  }

  return (
    <DashboardLayout>
      <ReportsDashboard />
    </DashboardLayout>
  );
}
