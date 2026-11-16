import DashboardLayout from "@/components/layout/DashboardLayout";
import { BookManagement } from "@/components/books/BookManagement";

export const metadata = {
  title: "Manajemen Buku - Admin",
};

export default function AdminBooksPage() {
  return (
    <DashboardLayout>
      <BookManagement />
    </DashboardLayout>
  );
}
