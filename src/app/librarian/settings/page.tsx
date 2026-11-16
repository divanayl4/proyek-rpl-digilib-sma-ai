import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import SettingsView from "@/components/admin/SettingsView";
import { LIBRARY_CONFIG } from "@/lib/config/library";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tarif Denda - DigiLib",
};

/**
 * Pengaturan tarif denda untuk Pustakawan.
 *
 * Halaman ini hanya memakai kembali komponen SettingsView yang sudah ada
 * (keterlambatan + kondisi buku). Pengaturan sistem lain tetap milik ADMIN.
 */
export default async function LibrarianFineSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !LIBRARY_CONFIG.librarianRoles.includes(session.user.role)) {
    redirect("/login");
  }

  return (
    <DashboardLayout>
      <SettingsView
        heading="Pengaturan Tarif Denda"
        description="Kelola tarif denda keterlambatan dan kondisi buku perpustakaan."
      />
    </DashboardLayout>
  );
}
