import DashboardLayout from "@/components/layout/DashboardLayout";
import PdfJsViewer from "@/components/ebooks/PdfJsViewer";

export const metadata = {
  title: "Baca Ebook - DigiLib",
};

export default function ReadEbookPage({ params }: { params: { id: string } }) {
  return (
    <DashboardLayout>
      <PdfJsViewer bookId={params.id} />
    </DashboardLayout>
  );
}