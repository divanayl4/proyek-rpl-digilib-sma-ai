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
    "notes" TEXT,
    CONSTRAINT "BorrowRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BorrowRecord_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BorrowRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BorrowRecord" ("bookId", "borrowDate", "dueDate", "id", "returnDate", "status", "userId") SELECT "bookId", "borrowDate", "dueDate", "id", "returnDate", "status", "userId" FROM "BorrowRecord";
DROP TABLE "BorrowRecord";
ALTER TABLE "new_BorrowRecord" RENAME TO "BorrowRecord";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
