-- CreateTable
CREATE TABLE "FinePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "borrowId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinePayment_borrowId_fkey" FOREIGN KEY ("borrowId") REFERENCES "BorrowRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinePayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BorrowRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "borrowDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME NOT NULL,
    "returnDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'BORROWED',
    "createdById" TEXT,
    "requestedAt" DATETIME,
    "approvedAt" DATETIME,
    "approvedById" TEXT,
    "rejectReason" TEXT,
    "notes" TEXT,
    "fineAmount" INTEGER NOT NULL DEFAULT 0,
    "fineRate" INTEGER,
    "finePaid" BOOLEAN NOT NULL DEFAULT false,
    "finePaidAt" DATETIME,
    "finePaidById" TEXT,
    CONSTRAINT "BorrowRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BorrowRecord_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BorrowRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BorrowRecord_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BorrowRecord_finePaidById_fkey" FOREIGN KEY ("finePaidById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BorrowRecord" ("bookId", "borrowDate", "createdById", "dueDate", "id", "notes", "returnDate", "status", "userId") SELECT "bookId", "borrowDate", "createdById", "dueDate", "id", "notes", "returnDate", "status", "userId" FROM "BorrowRecord";
DROP TABLE "BorrowRecord";
ALTER TABLE "new_BorrowRecord" RENAME TO "BorrowRecord";
CREATE INDEX "BorrowRecord_userId_idx" ON "BorrowRecord"("userId");
CREATE INDEX "BorrowRecord_bookId_idx" ON "BorrowRecord"("bookId");
CREATE INDEX "BorrowRecord_status_idx" ON "BorrowRecord"("status");
CREATE INDEX "BorrowRecord_dueDate_idx" ON "BorrowRecord"("dueDate");
CREATE INDEX "BorrowRecord_userId_status_idx" ON "BorrowRecord"("userId", "status");
CREATE INDEX "BorrowRecord_bookId_status_idx" ON "BorrowRecord"("bookId", "status");
CREATE INDEX "BorrowRecord_finePaid_idx" ON "BorrowRecord"("finePaid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FinePayment_borrowId_idx" ON "FinePayment"("borrowId");

-- CreateIndex
CREATE INDEX "FinePayment_createdAt_idx" ON "FinePayment"("createdAt");
