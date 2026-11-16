-- AlterTable: soft-delete / arsip buku
ALTER TABLE "Book" ADD COLUMN "archivedAt" DATETIME;

-- AlterTable: rincian denda (keterlambatan + kerusakan) dan kondisi pengembalian
ALTER TABLE "BorrowRecord" ADD COLUMN "lateFineAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BorrowRecord" ADD COLUMN "damageFineAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BorrowRecord" ADD COLUMN "damageFineRate" INTEGER;
ALTER TABLE "BorrowRecord" ADD COLUMN "returnCondition" TEXT;

-- CreateIndex
CREATE INDEX "Book_archivedAt_idx" ON "Book"("archivedAt");
