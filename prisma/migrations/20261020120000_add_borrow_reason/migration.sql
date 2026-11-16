-- AlterTable
-- Kolom nullable agar seluruh transaksi lama tetap valid tanpa alasan.
ALTER TABLE "BorrowRecord" ADD COLUMN "borrowReason" TEXT;
