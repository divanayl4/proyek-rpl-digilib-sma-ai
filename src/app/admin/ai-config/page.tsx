import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import AIConfigView from "@/components/admin/AIConfigView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Konfigurasi AI - DigiLib Admin",
};

/**
 * Pemeriksaan role di server. Middleware sudah memblokir /admin untuk non-ADMIN,
 * tetapi halaman ini tetap memeriksa sesi sendiri (defense-in-depth) agar tidak
 * bergantung pada konfigurasi matcher middleware.
 */
export default async function AdminAIConfigPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  return (
    <DashboardLayout>
      <AIConfigView />
    </DashboardLayout>
  );
}
