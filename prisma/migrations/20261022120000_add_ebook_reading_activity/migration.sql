-- Additive migration: real ebook reading-activity sessions.
-- Does not modify or delete EbookLoan/BorrowRecord/Book/User data.
-- No historical activity or progress is backfilled.

-- CreateTable
CREATE TABLE "EbookReadingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "loanId" TEXT,
    "openKey" TEXT,
    "firstOpenedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "lastPage" INTEGER,
    "progressPercent" REAL,
    "activityCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EbookReadingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EbookReadingSession_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EbookReadingSession_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "EbookLoan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EbookReadingSession_openKey_key" ON "EbookReadingSession"("openKey");

-- CreateIndex
CREATE INDEX "EbookReadingSession_userId_lastActivityAt_idx" ON "EbookReadingSession"("userId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "EbookReadingSession_bookId_lastActivityAt_idx" ON "EbookReadingSession"("bookId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "EbookReadingSession_lastActivityAt_idx" ON "EbookReadingSession"("lastActivityAt");

-- CreateIndex
CREATE INDEX "EbookReadingSession_loanId_idx" ON "EbookReadingSession"("loanId");

-- CreateIndex
CREATE INDEX "EbookReadingSession_endedAt_idx" ON "EbookReadingSession"("endedAt");
