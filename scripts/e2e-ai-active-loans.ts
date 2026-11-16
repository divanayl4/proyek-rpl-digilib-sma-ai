/**
 * Uji jalur data pribadi AI dengan data AKTIF nyata (dibuat lalu dibersihkan).
 * Membuat borrow aktif/terlambat/request + ebook aktif/kedaluwarsa untuk
 * "Siswa Rajin", menjalankan buildPersonalAnswer dan POST /api/ai/chat
 * (sesi disimulasikan), lalu MENGHAPUS kembali semua data uji.
 *
 * Jalankan: npx tsx scripts/e2e-ai-active-loans.ts
 */
import { prisma } from "../src/lib/prisma";
import { buildPersonalAnswer } from "../src/lib/ai/personal";
import { detectIntent } from "../src/lib/ai/intent";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const CASES = [
  "Buku apa yang sedang saya pinjam?",
  "Kapan jatuh tempo peminjaman saya?",
  "Ada buku yang terlambat?",
  "Buku apa yang jatuh temponya paling dekat?",
  "Berapa jumlah peminjaman aktif saya?",
  "Apakah saya masih punya peminjaman aktif?",
  "Ebook apa yang sedang saya baca?",
  "Sisa masa akses ebook saya berapa hari?",
  "Kapan masa akses ebook saya berakhir?",
  "Sejak kapan saya mulai membaca ebook?",
  "Riwayat peminjaman saya",
  "Riwayat ebook saya",
  "Buku terakhir yang saya kembalikan apa?",
  "Buku apa saja yang pernah saya pinjam bulan ini?",
  "Berapa denda saya?",
];

async function main() {
  const student = await prisma.user.findFirst({
    where: { name: "Siswa Rajin", role: "STUDENT" },
    select: { id: true },
  });
  if (!student) throw new Error("Siswa Rajin tidak ditemukan");

  const bukuFisika = await prisma.book.findFirst({
    where: { title: "Fisika Dasar untuk SMA" },
    select: { id: true },
  });
  const ebookFisika = await prisma.book.findFirst({
    where: { title: "Fisika Dasar untuk SMA (Ebook)" },
    select: { id: true },
  });
  if (!bukuFisika || !ebookFisika) throw new Error("Buku uji tidak ditemukan");

  const now = new Date();
  const createdBorrowIds: string[] = [];
  const createdLoanIds: string[] = [];

  try {
    const activeBorrow = await prisma.borrowRecord.create({
      data: {
        userId: student.id,
        bookId: bukuFisika.id,
        borrowDate: new Date(now.getTime() - 2 * MS_PER_DAY),
        dueDate: new Date(now.getTime() + 3 * MS_PER_DAY),
        status: "BORROWED",
      },
      select: { id: true },
    });
    createdBorrowIds.push(activeBorrow.id);

    const overdueBorrow = await prisma.borrowRecord.create({
      data: {
        userId: student.id,
        bookId: bukuFisika.id,
        borrowDate: new Date(now.getTime() - 16 * MS_PER_DAY),
        dueDate: new Date(now.getTime() - 2 * MS_PER_DAY),
        status: "BORROWED",
      },
      select: { id: true },
    });
    createdBorrowIds.push(overdueBorrow.id);

    const requested = await prisma.borrowRecord.create({
      data: {
        userId: student.id,
        bookId: bukuFisika.id,
        borrowDate: now,
        dueDate: new Date(now.getTime() + 7 * MS_PER_DAY),
        status: "REQUESTED",
        requestedAt: now,
      },
      select: { id: true },
    });
    createdBorrowIds.push(requested.id);

    const activeEbook = await prisma.ebookLoan.create({
      data: {
        userId: student.id,
        bookId: ebookFisika.id,
        borrowedAt: new Date(now.getTime() - 3 * MS_PER_DAY),
        expiresAt: new Date(now.getTime() + 2 * MS_PER_DAY),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    createdLoanIds.push(activeEbook.id);

    // Ebook kedaluwarsa dengan kolom status sengaja STALE (ACTIVE).
    // Aturan timestamp harus menang: ini kedaluwarsa, bukan aktif.
    const staleExpiredEbook = await prisma.ebookLoan.create({
      data: {
        userId: student.id,
        bookId: ebookFisika.id,
        borrowedAt: new Date(now.getTime() - 9 * MS_PER_DAY),
        expiresAt: new Date(now.getTime() - 4 * MS_PER_DAY),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    createdLoanIds.push(staleExpiredEbook.id);

    console.log(`[data uji dibuat: ${createdBorrowIds.length} borrow, ${createdLoanIds.length} ebook loan]\n`);

    for (const query of CASES) {
      const intent = detectIntent(query, false);
      let message: string;
      try {
        if (intent === "MY_LOANS" || intent === "MY_HISTORY" || intent === "MY_FINES") {
          message = (await buildPersonalAnswer(intent, query, student.id)).message;
        } else {
          message = `(intent ${intent} — bukan jalur data pribadi)`;
        }
      } catch (error) {
        message = `!! GAGAL: ${error instanceof Error ? error.message : String(error)}`;
      }
      console.log("──────────────────────────────────────────────");
      console.log(`TANYA : ${query}`);
      console.log(`INTENT: ${intent}`);
      console.log(
        message
          .split("\n")
          .map((l) => `        ${l}`)
          .join("\n")
      );
    }
  } finally {
    // Bersihkan seluruh data uji apa pun hasilnya.
    if (createdLoanIds.length > 0) {
      await prisma.ebookLoan.deleteMany({ where: { id: { in: createdLoanIds } } });
    }
    if (createdBorrowIds.length > 0) {
      await prisma.borrowRecord.deleteMany({ where: { id: { in: createdBorrowIds } } });
    }
    const [sisaBorrow, sisaLoan] = await Promise.all([
      prisma.borrowRecord.count({ where: { userId: student.id, status: { in: ["BORROWED", "REQUESTED"] } } }),
      prisma.ebookLoan.count({ where: { userId: student.id, returnedAt: null } }),
    ]);
    console.log(`\n[bersih] sisa borrow aktif/request: ${sisaBorrow}, sisa ebook loan terbuka: ${sisaLoan}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
