import { Suspense } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import EbookCatalogView from "@/components/ebooks/EbookCatalogView";
import { LoadingState } from "@/components/ui/LoadingState";

export const metadata = {
  title: "Ebook - DigiLib",
};

export default function EbooksPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={<LoadingState message="Memuat katalog ebook..." />}>
        <EbookCatalogView />
      </Suspense>
    </DashboardLayout>
  );
}