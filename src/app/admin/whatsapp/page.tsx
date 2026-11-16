import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import WhatsAppSettingsView from "@/components/admin/WhatsAppSettingsView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Notifikasi WhatsApp - DigiLib Admin",
};

/**
 * Halaman khusus Administrator. Middleware sudah memblokir /admin untuk role
 * lain, tetapi pemeriksaan sesi tetap dilakukan di server (defense-in-depth).
 */
export default async function AdminWhatsAppPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  return (
    <DashboardLayout>
      <WhatsAppSettingsView />
    </DashboardLayout>
  );
}
