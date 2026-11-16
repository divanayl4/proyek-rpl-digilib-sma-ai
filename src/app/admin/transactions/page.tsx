import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

// Admin transactions page - delegates to the librarian borrows view
// via dynamic client component
import AdminTransactionsView from "@/components/borrows/AdminTransactionsView";

export default async function AdminTransactionsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/login");
  }

  return <AdminTransactionsView />;
}
