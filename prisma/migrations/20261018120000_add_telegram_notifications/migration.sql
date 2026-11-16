-- AlterTable (aditif): kolom pengaitan Telegram pada User.
-- Semua kolom nullable sehingga baris lama tidak terpengaruh.
ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramLinkCode" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramLinkCodeExpiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "telegramLinkedAt" DATETIME;

-- CreateIndex
CREATE INDEX "User_telegramLinkCode_idx" ON "User"("telegramLinkCode");

-- CreateTable: pencatatan pengiriman Telegram (anti-duplikat per peristiwa).
CREATE TABLE "TelegramDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramDelivery_eventKey_key" ON "TelegramDelivery"("eventKey");

-- CreateIndex
CREATE INDEX "TelegramDelivery_createdAt_idx" ON "TelegramDelivery"("createdAt");
