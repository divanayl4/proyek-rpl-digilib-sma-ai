import DashboardLayout from "@/components/layout/DashboardLayout";
import { BookManagement } from "@/components/books/BookManagement";

export const metadata = {
  title: "Manajemen Buku - Pustakawan",
};

export default function LibrarianBooksPage() {
  return (
    <DashboardLayout>
      <BookManagement />
    </DashboardLayout>
  );
}
