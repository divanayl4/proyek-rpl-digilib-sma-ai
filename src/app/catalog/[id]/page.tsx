import DashboardLayout from "@/components/layout/DashboardLayout";
import BookDetailView from "@/components/books/BookDetailView";

export const metadata = {
  title: "Detail Buku - DigiLib",
};

export default function BookDetailPage({ params }: { params: { id: string } }) {
  return (
    <DashboardLayout>
      <BookDetailView bookId={params.id} />
    </DashboardLayout>
  );
}
