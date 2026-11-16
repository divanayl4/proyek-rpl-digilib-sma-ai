import DashboardLayout from "@/components/layout/DashboardLayout";
import AuditLogView from "@/components/admin/AuditLogView";

export const dynamic = "force-dynamic";

export default function AdminAuditPage() {
  return (
    <DashboardLayout>
      <AuditLogView />
    </DashboardLayout>
  );
}
