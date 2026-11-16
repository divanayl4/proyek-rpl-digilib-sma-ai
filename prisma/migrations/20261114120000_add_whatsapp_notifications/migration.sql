-- Migrasi Telegram → WhatsApp (Fonnte).
--
-- 1. Menghapus tabel riwayat Telegram yang sudah tidak dipakai.
-- 2. Menghapus kolom pengaitan Telegram dari User.
-- 3. Menambahkan kolom nomor WhatsApp + status verifikasi pada User.
-- 4. Membuat tabel riwayat/anti-duplikat pengiriman WhatsApp.
--
-- Tidak ada data pengguna, buku, peminjaman, pengembalian, denda, atau
-- transaksi lain yang dihapus. Nilai kolom baru memakai default yang aman
-- (belum diverifikasi, notifikasi aktif saat nomor tersedia).

-- DropIndex
DROP INDEX "TelegramDelivery_createdAt_idx";

-- DropIndex
DROP INDEX "TelegramDelivery_eventKey_key";

-- DropTable (riwayat pengiriman Telegram – bukan data transaksi DigiLib)
PRAGMA foreign_keys=off;
DROP TABLE "TelegramDelivery";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "WhatsAppDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "userId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'ACCOUNT',
    "recipientNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "errorMessage" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables (User): buang kolom Telegram, tambah kolom WhatsApp.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "gender" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "identityNumber" TEXT,
    "class" TEXT,
    "whatsappNumber" TEXT,
    "whatsappVerified" BOOLEAN NOT NULL DEFAULT false,
    "whatsappVerifiedAt" DATETIME,
    "whatsappNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappVerificationCodeHash" TEXT,
    "whatsappVerificationExpiresAt" DATETIME,
    "whatsappVerificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "whatsappVerificationSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("class", "createdAt", "email", "gender", "id", "identityNumber", "isActive", "name", "passwordHash", "role", "updatedAt")
SELECT "class", "createdAt", "email", "gender", "id", "identityNumber", "isActive", "name", "passwordHash", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_whatsappNumber_key" ON "User"("whatsappNumber");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_isActive_idx" ON "User"("isActive");
CREATE INDEX "User_whatsappVerificationCodeHash_idx" ON "User"("whatsappVerificationCodeHash");
CREATE INDEX "User_whatsappNumber_idx" ON "User"("whatsappNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppDelivery_eventKey_key" ON "WhatsAppDelivery"("eventKey");

-- CreateIndex
CREATE INDEX "WhatsAppDelivery_userId_idx" ON "WhatsAppDelivery"("userId");

-- CreateIndex
CREATE INDEX "WhatsAppDelivery_status_idx" ON "WhatsAppDelivery"("status");

-- CreateIndex
CREATE INDEX "WhatsAppDelivery_category_idx" ON "WhatsAppDelivery"("category");

-- CreateIndex
CREATE INDEX "WhatsAppDelivery_createdAt_idx" ON "WhatsAppDelivery"("createdAt");
