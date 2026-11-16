-- CreateTable
CREATE TABLE "EbookLoan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "borrowedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "returnedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EbookLoan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EbookLoan_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "isbn" TEXT,
    "publisher" TEXT,
    "year" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "coverUrl" TEXT,
    "description" TEXT,
    "format" TEXT NOT NULL DEFAULT 'PHYSICAL',
    "filePath" TEXT,
    "pageCount" INTEGER,
    "categoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Book_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Book" ("author", "categoryId", "coverUrl", "createdAt", "description", "id", "isbn", "publisher", "stock", "title", "year") SELECT "author", "categoryId", "coverUrl", "createdAt", "description", "id", "isbn", "publisher", "stock", "title", "year" FROM "Book";
DROP TABLE "Book";
ALTER TABLE "new_Book" RENAME TO "Book";
CREATE INDEX "Book_categoryId_idx" ON "Book"("categoryId");
CREATE INDEX "Book_title_idx" ON "Book"("title");
CREATE INDEX "Book_format_idx" ON "Book"("format");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "EbookLoan_userId_idx" ON "EbookLoan"("userId");

-- CreateIndex
CREATE INDEX "EbookLoan_bookId_idx" ON "EbookLoan"("bookId");

-- CreateIndex
CREATE INDEX "EbookLoan_status_idx" ON "EbookLoan"("status");

-- CreateIndex
CREATE INDEX "EbookLoan_expiresAt_idx" ON "EbookLoan"("expiresAt");

-- CreateIndex
CREATE INDEX "EbookLoan_userId_status_idx" ON "EbookLoan"("userId", "status");

-- CreateIndex
CREATE INDEX "EbookLoan_bookId_status_idx" ON "EbookLoan"("bookId", "status");