"use client";

// Admin transactions view - reuses the full borrowing management UI.
// Admins have the same capabilities as librarians + more.
import BorrowManagementView from "@/components/borrows/BorrowManagementView";

export default function AdminTransactionsView() {
  return (
    <BorrowManagementView
      title="Transaksi Peminjaman"
      subtitle="Kelola pengajuan, peminjaman, pengembalian, dan denda buku"
    />
  );
}
