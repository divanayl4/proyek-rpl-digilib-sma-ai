import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import FineManagementView from "@/components/fines/FineManagementView";
import { LIBRARY_CONFIG } from "@/lib/config/library";

export const metadata = {
  title: "Manajemen Denda - DigiLib",
};

export default async function LibrarianFinesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !LIBRARY_CONFIG.librarianRoles.includes(session.user.role)) {
    redirect("/login");
  }

  return (
    <FineManagementView
      title="Manajemen Denda"
      subtitle="Pantau dan catat pembayaran denda keterlambatan pengembalian buku"
    />
  );
}
