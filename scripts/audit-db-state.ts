/**
 * Audit read-only kondisi database DigiLib.
 * Tidak menulis/mengubah data. Hanya membaca untuk membandingkan jawaban chatbot.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  console.log("=== SETTINGS ===");
  for (const row of settings) {
    const isSecret = row.key.includes("secret");
    console.log(
      `${row.key} = ${isSecret ? `[secret redacted, ${row.value.length} chars]` : row.value}`
    );
  }

  const [users, books, categories, borrows, fines, ebookLoans, sessions, auditLogs] =
    await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true, role: true, isActive: true, class: true } }),
      prisma.book.findMany({
        select: { id: true, title: true, format: true, stock: true, archivedAt: true, category: { select: { name: true } } },
      }),
      prisma.category.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
      prisma.borrowRecord.findMany({
        select: {
          id: true,
          status: true,
          borrowDate: true,
          dueDate: true,
          returnDate: true,
          fineAmount: true,
          finePaid: true,
          user: { select: { name: true, role: true } },
          book: { select: { title: true } },
        },
        orderBy: { borrowDate: "desc" },
      }),
      prisma.borrowRecord.findMany({
        where: { fineAmount: { gt: 0 } },
        select: { id: true, fineAmount: true, finePaid: true, user: { select: { name: true, role: true } } },
      }),
      prisma.ebookLoan.findMany({
        select: { id: true, status: true, borrowedAt: true, expiresAt: true, returnedAt: true, user: { select: { name: true } }, book: { select: { title: true } } },
        orderBy: { borrowedAt: "desc" },
      }),
      prisma.ebookReadingSession.count(),
      prisma.auditLog.count(),
    ]);

  console.log("\n=== USERS ===");
  console.log(`count=${users.length}`);
  for (const u of users) console.log(`${u.name} | ${u.role} | active=${u.isActive} | class=${u.class ?? "-"}`);

  console.log("\n=== BOOKS ===");
  console.log(`count=${books.length}`);
  for (const b of books) {
    console.log(`${b.title} | ${b.format} | stock=${b.stock} | archived=${b.archivedAt ? "yes" : "no"} | category=${b.category?.name ?? "-"}`);
  }

  console.log("\n=== CATEGORIES ===");
  console.log(categories.map((c) => c.name).join(", "));

  console.log("\n=== BORROWS ===");
  console.log(`count=${borrows.length}`);
  const byStatus: Record<string, number> = {};
  for (const b of borrows) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  console.log("byStatus:", byStatus);
  for (const b of borrows.slice(0, 30)) {
    console.log(`${b.user.name} | ${b.book.title} | ${b.status} | borrow=${b.borrowDate.toISOString().slice(0, 10)} | due=${b.dueDate.toISOString().slice(0, 10)} | return=${b.returnDate?.toISOString().slice(0, 10) ?? "-"} | fine=${b.fineAmount}/${b.finePaid}`);
  }

  console.log("\n=== FINES ===");
  console.log(`rows=${fines.length}`);
  for (const f of fines) console.log(`${f.user.name} (${f.user.role}) | Rp${f.fineAmount} | paid=${f.finePaid}`);

  console.log("\n=== EBOOK LOANS ===");
  console.log(`count=${ebookLoans.length}`);
  for (const l of ebookLoans.slice(0, 20)) {
    console.log(`${l.user.name} | ${l.book.title} | ${l.status} | ${l.borrowedAt.toISOString().slice(0, 10)} -> ${l.expiresAt.toISOString().slice(0, 10)} | returned=${l.returnedAt ? "yes" : "no"}`);
  }

  console.log(`\n=== OTHER ===\nsessions=${sessions} auditLogs=${auditLogs}`);
  console.log(`\nserverNow=${new Date().toISOString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
