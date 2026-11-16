/**
 * Kurasi katalog sekali-jalan (idempoten).
 *
 * Tujuan:
 *  1. Memisahkan "kategori koleksi" dari "mata pelajaran". Kategori hanya boleh
 *     berisi jenis koleksi; mata pelajaran tetap tersimpan di Book.subject.
 *  2. Mengarsipkan (soft delete) buku berjurusan/konsentrasi keahlian dari
 *     katalog aktif TANPA menghapusnya — riwayat peminjaman/denda tetap utuh.
 *  3. Mengganti kategori buku lama ke kategori koleksi yang benar.
 *
 * Jalankan: npx tsx prisma/catalog-curation.ts
 */
import { PrismaClient } from "@prisma/client";
import { SMK_MAJORS } from "../src/lib/config/smk";

const prisma = new PrismaClient();

const COLLECTION_CATEGORIES = [
  "Buku Teks Pelajaran",
  "Buku Referensi",
  "Fiksi",
  "Nonfiksi",
  "Cerita Pendek",
  "Novel",
  "Ensiklopedia",
  "Pengetahuan Umum",
  "Modul",
  "Ebook",
];

/** Kategori lama yang mencampur mata pelajaran/jurusan dengan jenis koleksi. */
const CONFLATED_CATEGORIES = [
  "Mata Pelajaran Umum",
  "Mata Pelajaran Kejuruan",
  "Sains",
  "Teknologi",
  "Sastra",
  "Sejarah",
];

async function categoryId(name: string): Promise<string | null> {
  const row = await prisma.category.findUnique({ where: { name } });
  return row?.id ?? null;
}

async function main() {
  for (const name of COLLECTION_CATEGORIES) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }

  const vocationalSubjects = new Set(
    SMK_MAJORS.flatMap((m) => m.subjects.map((s) => s.trim().toLowerCase()))
  );
  const majorNames = new Set(SMK_MAJORS.map((m) => m.name.trim().toLowerCase()));

  // 1. Arsipkan buku kejuruan (punya major atau mata pelajaran kejuruan).
  const allBooks = await prisma.book.findMany();
  let archivedCount = 0;
  for (const book of allBooks) {
    if (book.archivedAt) continue;
    const major = (book.major ?? "").trim().toLowerCase();
    const subject = (book.subject ?? "").trim().toLowerCase();
    const isVocational =
      major.length > 0 ||
      (subject.length > 0 && vocationalSubjects.has(subject)) ||
      (major.length > 0 && majorNames.has(major));
    if (isVocational) {
      await prisma.book.update({ where: { id: book.id }, data: { archivedAt: new Date() } });
      archivedCount += 1;
      console.log(`Diarsipkan: "${book.title}" (major=${book.major ?? "-"})`);
    }
  }

  // 2. Pindahkan SEMUA buku (aktif maupun arsip) ke kategori koleksi yang tepat.
  //    Nama kategori lama dipakai sebagai sinyal agar novel tetap "Fiksi".
  const teksId = await categoryId("Buku Teks Pelajaran");
  const ebookId = await categoryId("Ebook");
  const fiksiId = await categoryId("Fiksi");
  const cerpenId = await categoryId("Cerita Pendek");

  const nameById = new Map(
    (await prisma.category.findMany()).map((c) => [c.id, c.name] as const)
  );

  const allBooksWithCat = await prisma.book.findMany({
    include: { category: { select: { name: true } } },
  });
  let recategorized = 0;
  for (const book of allBooksWithCat) {
    const title = book.title.toLowerCase();
    const originalName = book.category?.name ?? "";
    let target: string | null = null;

    const wasFiction =
      originalName === "Fiksi" || originalName === "Sastra" || originalName === "Novel";

    if (book.format === "EBOOK") target = ebookId;
    else if (title.includes("cerpen") || title.includes("cerita pendek")) target = cerpenId;
    else if (wasFiction) target = fiksiId;
    // Buku pelajaran selalu punya tingkat kelas; tanpa kelas → koleksi fiksi/referensi.
    else if (!book.grade) target = fiksiId;
    else if (book.subject) target = teksId;

    if (target && book.categoryId !== target) {
      await prisma.book.update({ where: { id: book.id }, data: { categoryId: target } });
      recategorized += 1;
      console.log(`Kategori diubah: "${book.title}" -> ${nameById.get(target) ?? target}`);
    }
  }

  // 3. Hapus kategori campuran yang kini kosong (tidak ada buku menunjuk).
  let removedCategories = 0;
  for (const name of CONFLATED_CATEGORIES) {
    const row = await prisma.category.findUnique({
      where: { name },
      include: { _count: { select: { books: true } } },
    });
    if (row && row._count.books === 0) {
      await prisma.category.delete({ where: { id: row.id } });
      removedCategories += 1;
      console.log(`Kategori campuran dihapus: ${name}`);
    } else if (row) {
      console.log(`Kategori ${name} masih dipakai (${row._count.books} buku) — dilewati.`);
    }
  }

  console.log(
    `\nSelesai. Diarsipkan=${archivedCount}, kategori diubah=${recategorized}, kategori dihapus=${removedCategories}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
