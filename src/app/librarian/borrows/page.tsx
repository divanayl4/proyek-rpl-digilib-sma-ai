import BorrowManagementView from "@/components/borrows/BorrowManagementView";

export const dynamic = "force-dynamic";

export default function LibrarianBorrowsPage() {
  return (
    <BorrowManagementView
      title="Manajemen Peminjaman"
      subtitle="Kelola pengajuan, peminjaman, pengembalian, dan denda buku"
    />
  );
}
