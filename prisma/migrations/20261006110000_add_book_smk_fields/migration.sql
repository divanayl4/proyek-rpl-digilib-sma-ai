-- AlterTable
ALTER TABLE "Book" ADD COLUMN "grade" TEXT;
ALTER TABLE "Book" ADD COLUMN "subject" TEXT;
ALTER TABLE "Book" ADD COLUMN "major" TEXT;

-- CreateIndex
CREATE INDEX "Book_grade_idx" ON "Book"("grade");

-- CreateIndex
CREATE INDEX "Book_subject_idx" ON "Book"("subject");

-- CreateIndex
CREATE INDEX "Book_major_idx" ON "Book"("major");