import DashboardLayout from "@/components/layout/DashboardLayout";
import SettingsView from "@/components/admin/SettingsView";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  return (
    <DashboardLayout>
      <SettingsView />
    </DashboardLayout>
  );
}
