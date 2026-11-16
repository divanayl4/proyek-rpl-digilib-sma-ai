/**
 * Catalog maintenance for DigiLib.
 *
 * Commands (run with `npx tsx prisma/catalog-maintenance.ts <command>`):
 *   analyze  – dry inspection of the catalog and any "placeholder" legacy rows.
 *   backup   – copy prisma/dev.db to a timestamped backup file.
 *   purge    – delete placeholder legacy rows (requires --apply to actually run).
 *
 * Placeholder = an EBOOK row with no filePath (metadata-only catalog entry that
 * was auto-seeded, never uploaded). Deletion NEVER touches physical books, ebook
 * files, users, borrow transactions, or ebook loans: a placeholder that is
 * referenced by any transaction is skipped and reported.
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const command = args[0] ?? "analyze";
const apply = args.includes("--apply");

const DB_PATH = path.join(process.cwd(), "prisma", "dev.db");

type BookRow = {
  id: string;
  title: string;
  format: string;
  filePath: string | null;
  subject: string | null;
  major: string | null;
  grade: string | null;
};

function isPlaceholder(book: BookRow): boolean {
  return book.format === "EBOOK" && !book.filePath;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function backup(): Promise<string> {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const dest = `${DB_PATH}.backup-catalog-${stamp}`;
  fs.copyFileSync(DB_PATH, dest);
  console.log(`Backup dibuat: ${dest} (${formatSize(fs.statSync(dest).size)})`);
  return dest;
}

async function referencedIds(ids: string[]) {
  if (ids.length === 0) {
    return { borrowRefs: new Map<string, number>(), loanRefs: new Map<string, number>() };
  }

  const [borrows, loans] = await Promise.all([
    prisma.borrowRecord.groupBy({
      by: ["bookId"],
      where: { bookId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.ebookLoan.groupBy({
      by: ["bookId"],
      where: { bookId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const borrowRefs = new Map(borrows.map((b) => [b.bookId, b._count._all]));
  const loanRefs = new Map(loans.map((l) => [l.bookId, l._count._all]));
  return { borrowRefs, loanRefs };
}

async function analyze() {
  const books = (await prisma.book.findMany({
    select: {
      id: true,
      title: true,
      format: true,
      filePath: true,
      subject: true,
      major: true,
      grade: true,
    },
  })) as BookRow[];

  const placeholders = books.filter(isPlaceholder);
  const withFile = books.filter((b) => b.format === "EBOOK" && b.filePath);
  const physical = books.filter((b) => b.format !== "EBOOK");

  const { borrowRefs, loanRefs } = await referencedIds(placeholders.map((b) => b.id));

  const referenced = placeholders.filter(
    (b) => (borrowRefs.get(b.id) ?? 0) > 0 || (loanRefs.get(b.id) ?? 0) > 0
  );
  const safeToDelete = placeholders.filter(
    (b) => (borrowRefs.get(b.id) ?? 0) === 0 && (loanRefs.get(b.id) ?? 0) === 0
  );

  const byMajor = new Map<string, number>();
  for (const b of placeholders) {
    const key = b.major ?? "(mata pelajaran umum)";
    byMajor.set(key, (byMajor.get(key) ?? 0) + 1);
  }

  const agribisnis = placeholders.filter(
    (b) =>
      (b.major ?? "").toLowerCase().includes("agribisnis") ||
      (b.subject ?? "").toLowerCase().includes("agribisnis") ||
      (b.title ?? "").toLowerCase().includes("agribisnis")
  );

  console.log("=== RINGKASAN KATALOG ===");
  console.log(`Total buku           : ${books.length}`);
  console.log(`  Buku fisik         : ${physical.length}`);
  console.log(`  Ebook (ada berkas) : ${withFile.length}`);
  console.log(`  Placeholder (kosong): ${placeholders.length}`);
  console.log("");
  console.log("=== PLACEHOLDER YANG AMAN DIHAPUS ===");
  console.log(`Tidak dipakai transaksi apapun: ${safeToDelete.length}`);
  console.log(`MASIH DIPAKAI transaksi       : ${referenced.length}`);
  if (referenced.length > 0) {
    for (const b of referenced) {
      console.log(
        `  ! ${b.title} (borrows=${borrowRefs.get(b.id) ?? 0}, loans=${loanRefs.get(b.id) ?? 0})`
      );
    }
  }
  console.log("");
  console.log("=== PLACEHOLDER PER JURUSAN ===");
  const majorRows = Array.from(byMajor.entries()).sort((a, b) => b[1] - a[1]);
  for (const [major, count] of majorRows) {
    console.log(`  ${count.toString().padStart(3)}  ${major}`);
  }
  console.log("");
  console.log(`Placeholder terkait Agribisnis: ${agribisnis.length}`);
  for (const b of agribisnis) {
    console.log(`  - ${b.title}`);
  }
}

async function purge() {
  const books = (await prisma.book.findMany({
    select: {
      id: true,
      title: true,
      format: true,
      filePath: true,
      subject: true,
      major: true,
      grade: true,
    },
  })) as BookRow[];

  const placeholders = books.filter(isPlaceholder);
  const { borrowRefs, loanRefs } = await referencedIds(placeholders.map((b) => b.id));

  const safeToDelete = placeholders.filter(
    (b) => (borrowRefs.get(b.id) ?? 0) === 0 && (loanRefs.get(b.id) ?? 0) === 0
  );
  const blocked = placeholders.filter(
    (b) => (borrowRefs.get(b.id) ?? 0) > 0 || (loanRefs.get(b.id) ?? 0) > 0
  );

  console.log(`Placeholder akan dihapus: ${safeToDelete.length}`);
  if (blocked.length > 0) {
    console.log(`Placeholder DILEWATI karena punya transaksi: ${blocked.length}`);
    for (const b of blocked) console.log(`  - ${b.title}`);
  }

  if (!apply) {
    console.log("Mode DRY-RUN. Tambahkan --apply untuk benar-benar menghapus.");
    return;
  }

  if (safeToDelete.length === 0) {
    console.log("Tidak ada yang perlu dihapus.");
    return;
  }

  await backup();

  const result = await prisma.book.deleteMany({
    where: { id: { in: safeToDelete.map((b) => b.id) } },
  });
  console.log(`Terhapus: ${result.count} placeholder. Transaksi & pengguna tidak tersentuh.`);
}

async function main() {
  switch (command) {
    case "analyze":
      await analyze();
      break;
    case "backup":
      await backup();
      break;
    case "purge":
      await purge();
      break;
    default:
      console.error(`Perintah tidak dikenal: ${command}`);
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
