import { Suspense } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import CatalogView from "@/components/books/CatalogView";
import { LoadingState } from "@/components/ui/LoadingState";

export const metadata = {
  title: "Katalog Buku - DigiLib",
};

export default function CatalogPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={<LoadingState message="Memuat katalog buku..." />}>
        <CatalogView />
      </Suspense>
    </DashboardLayout>
  );
}
