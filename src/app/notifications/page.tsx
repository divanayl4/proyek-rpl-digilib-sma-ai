import DashboardLayout from "@/components/layout/DashboardLayout";
import NotificationsView from "@/components/notifications/NotificationsView";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Notifikasi - DigiLib",
};

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto w-full">
        <NotificationsView />
      </div>
    </DashboardLayout>
  );
}
