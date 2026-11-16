import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const EBOOK_STORAGE_DIR = path.join(process.cwd(), 'storage', 'ebooks');

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Builds a small but valid multi-page PDF without pulling in a PDF library.
 * Enough for the seeded sample ebooks to be readable in the browser viewer.
 *
 * Object layout: 1 catalog, 2 page tree, 3 regular font, 4 bold font,
 * then alternating page / content-stream objects from 5 upwards.
 */
function buildPdf(title: string, subtitle: string, chapters: string[]): Buffer {
  const CATALOG = 1;
  const PAGE_TREE = 2;
  const FONT_REGULAR = 3;
  const FONT_BOLD = 4;
  const FIRST_DYNAMIC = 5;

  const pages: string[][] = [
    [title, subtitle, '', 'DigiLib - SMA Negeri 1', 'Demo ebook untuk pengujian fitur Pinjam & Baca.'],
  ];

  chapters.forEach((chapter, index) => {
    const body: string[] = [`${title} - Bab ${index + 1}`, chapter, ''];
    for (let p = 1; p <= 4; p++) {
      body.push(
        `${index + 1}.${p}  ${chapter} Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`
      );
    }
    pages.push(body);
  });

  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  let nextNum = FIRST_DYNAMIC;
  for (let i = 0; i < pages.length; i++) {
    pageObjNums.push(nextNum++);
    contentObjNums.push(nextNum++);
  }

  const bodies = new Map<number, string>();

  bodies.set(CATALOG, `<< /Type /Catalog /Pages ${PAGE_TREE} 0 R >>`);
  bodies.set(
    PAGE_TREE,
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`
  );
  bodies.set(
    FONT_REGULAR,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  bodies.set(
    FONT_BOLD,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );

  pages.forEach((lines, index) => {
    const pageNum = pageObjNums[index];
    const contentNum = contentObjNums[index];

    let y = 780;
    let stream = '';
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const isHeading = lineIndex === 0;
      const font = isHeading ? `/${FONT_BOLD}` : `/${FONT_REGULAR}`;
      const size = isHeading ? 20 : lineIndex === 1 ? 13 : 11;
      stream += `BT ${font} ${size} Tf 60 ${y} Td (${escapePdfText(line)}) Tj ET\n`;
      y -= isHeading ? 34 : 18;
    }

    bodies.set(
      pageNum,
      `<< /Type /Page /Parent ${PAGE_TREE} 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 ${FONT_REGULAR} 0 R /F2 ${FONT_BOLD} 0 R >> >> ` +
        `/Contents ${contentNum} 0 R >>`
    );
    bodies.set(
      contentNum,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`
    );
  });

  const totalObjects = nextNum - 1;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (let num = 1; num <= totalObjects; num++) {
    offsets[num] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${num} 0 obj\n${bodies.get(num) ?? '<< >>'}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');

  pdf += `xref\n0 ${totalObjects + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let num = 1; num <= totalObjects; num++) {
    pdf += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjects + 1} /Root ${CATALOG} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

function writeEbookFile(fileName: string, buffer: Buffer): string {
  fs.mkdirSync(EBOOK_STORAGE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EBOOK_STORAGE_DIR, fileName), buffer);
  return fileName;
}

async function main() {
  console.log('Start seeding...');

  // Password for all demo users
  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Create Users (Roles: ADMIN, LIBRARIAN, STUDENT, TEACHER, STAFF)
  const users = [
    {
      name: 'Admin Utama',
      email: 'admin@sma.id',
      passwordHash,
      role: 'ADMIN',
      gender: 'MALE',
      isActive: true,
    },
    {
      name: 'Budi Pustakawan',
      email: 'pustakawan@sma.id',
      passwordHash,
      role: 'LIBRARIAN',
      gender: 'MALE',
      identityNumber: 'PTK001',
      isActive: true,
    },
    {
      name: 'Pak Guru',
      email: 'guru@sma.id',
      passwordHash,
      role: 'TEACHER',
      gender: 'MALE',
      identityNumber: 'NIP19850410201001',
      isActive: true,
    },
    {
      name: 'Siswa Rajin',
      email: 'siswa@sma.id',
      passwordHash,
      role: 'STUDENT',
      gender: 'MALE',
      identityNumber: '2024001',
      class: 'XII IPA 1',
      isActive: true,
    },
    {
      // Sengaja tanpa gender untuk menguji sapaan memakai nama polos.
      name: 'Staf Tata Usaha',
      email: 'staf@sma.id',
      passwordHash,
      role: 'STAFF',
      gender: null,
      identityNumber: 'STF001',
      isActive: true,
    },
    // Extra students for pagination testing
    { name: 'Andi Pratama', email: 'andi@sma.id', passwordHash, role: 'STUDENT', gender: 'MALE', identityNumber: '2024002', class: 'XII IPA 2', isActive: true },
    { name: 'Bela Nuraini', email: 'bela@sma.id', passwordHash, role: 'STUDENT', gender: 'FEMALE', identityNumber: '2024003', class: 'XII IPS 1', isActive: true },
    { name: 'Citra Dewi', email: 'citra@sma.id', passwordHash, role: 'STUDENT', gender: 'FEMALE', identityNumber: '2024004', class: 'XI IPA 1', isActive: false },
    { name: 'Doni Saputra', email: 'doni@sma.id', passwordHash, role: 'STUDENT', gender: 'MALE', identityNumber: '2024005', class: 'XI IPA 2', isActive: true },
    { name: 'Eva Marlina', email: 'eva@sma.id', passwordHash, role: 'STUDENT', gender: 'FEMALE', identityNumber: '2024006', class: 'XI IPS 1', isActive: true },
    { name: 'Fajar Nugroho', email: 'fajar@sma.id', passwordHash, role: 'STUDENT', gender: 'MALE', identityNumber: '2024007', class: 'X IPA 1', isActive: true },
    { name: 'Gita Permata', email: 'gita@sma.id', passwordHash, role: 'STUDENT', gender: 'FEMALE', identityNumber: '2024008', class: 'X IPA 2', isActive: true },
    { name: 'Hendra Wijaya', email: 'hendra@sma.id', passwordHash, role: 'STUDENT', gender: 'MALE', identityNumber: '2024009', class: 'X IPS 1', isActive: true },
    { name: 'Ika Rahmawati', email: 'ika@sma.id', passwordHash, role: 'STUDENT', gender: 'FEMALE', identityNumber: '2024010', class: 'X IPS 2', isActive: false },
    { name: 'Joko Susanto', email: 'joko@sma.id', passwordHash, role: 'STUDENT', gender: 'MALE', identityNumber: '2024011', class: 'XII IPA 1', isActive: true },
    { name: 'Kartini Sari', email: 'kartini@sma.id', passwordHash, role: 'TEACHER', gender: 'FEMALE', identityNumber: 'NIP19901205201501', isActive: true },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { gender: user.gender },
      create: user,
    });
  }
  console.log('Users seeded');

  // 2. Create Categories — HANYA kategori koleksi. Mata pelajaran disimpan pada
  //    Book.subject, bukan sebagai kategori, agar keduanya tidak tercampur.
  const categoryNames = [
    'Buku Teks Pelajaran',
    'Buku Referensi',
    'Fiksi',
    'Nonfiksi',
    'Cerita Pendek',
    'Novel',
    'Ensiklopedia',
    'Pengetahuan Umum',
    'Modul',
    'Ebook',
  ];
  for (const name of categoryNames) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log('Categories seeded');

  // 3. Create Books
  const categories = await prisma.category.findMany();
  if (categories.length > 0) {
    const novelId = categories.find((c) => c.name === 'Novel')?.id;
    const teksId = categories.find((c) => c.name === 'Buku Teks Pelajaran')?.id;

    const books = [
      {
        title: 'Bumi Manusia',
        author: 'Pramoedya Ananta Toer',
        isbn: '9789799731234',
        publisher: 'Hasta Mitra',
        year: 1980,
        stock: 5,
        categoryId: novelId,
        description: 'Buku pertama dari Tetralogi Buru.',
        grade: null,
        subject: 'Bahasa Indonesia',
        major: null,
      },
      {
        title: 'Fisika Dasar untuk SMA',
        author: 'Yohanes Surya',
        isbn: '9786021234567',
        publisher: 'Kandel',
        year: 2010,
        stock: 10,
        categoryId: teksId,
        description: 'Buku wajib fisika untuk anak SMA.',
        grade: 'X',
        subject: 'Fisika',
        major: null,
      },
    ];

    for (const book of books) {
      // Using first book title as unique identifier for seeding just for simplicity,
      // Ideally we check by ISBN, but ISBN is optional in our schema
      const existingBook = await prisma.book.findFirst({
        where: { title: book.title },
      });

      if (!existingBook) {
        await prisma.book.create({
          data: book,
        });
      } else {
        // Lengkapi dimensi kurikulum + kategori koleksi pada data lama.
        await prisma.book.update({
          where: { id: existingBook.id },
          data: {
            grade: book.grade,
            subject: book.subject,
            major: book.major,
            ...(book.categoryId ? { categoryId: book.categoryId } : {}),
          },
        });
      }
    }
    console.log('Books seeded');
  }

  // 4. Create Ebooks (digital copies read through a 5-day loan)
  const allCategories = await prisma.category.findMany();
  const ebookCategoryId = allCategories.find((c) => c.name === 'Ebook')?.id;

  // Hanya ebook mata pelajaran umum. Buku kejuruan (mis. Pemrograman Dasar/RPL)
  // sengaja tidak dibuat agar katalog umum bebas dari konsentrasi keahlian.
  const ebookSpecs = [
    {
      fileName: 'fisika-dasar-untuk-sma.pdf',
      title: 'Fisika Dasar untuk SMA (Ebook)',
      author: 'Yohanes Surya',
      isbn: '9786021234568',
      publisher: 'Kandel',
      year: 2010,
      categoryId: ebookCategoryId,
      description: 'Materi fisika lengkap untuk jenjang SMA, dapat dibaca langsung secara daring.',
      chapters: ['Besaran dan Satuan', 'Kinematika', 'Dinamika', 'Energi dan Usaha'],
      grade: 'X',
      subject: 'Fisika',
      major: null,
    },
    {
      fileName: 'kumpulan-cerpen-singkat.pdf',
      title: 'Kumpulan Cerpen Singkat (Ebook)',
      author: 'Ratih Kumala',
      isbn: '9786029999002',
      publisher: 'DigiLib Press',
      year: 2021,
      categoryId: ebookCategoryId,
      description: 'Kumpulan cerita pendek karya siswa SMA.',
      chapters: ['Senja di Halte', 'Surat yang Tak Terkirim', 'Rahasia'],
      grade: 'X',
      subject: 'Bahasa Indonesia',
      major: null,
    },
  ];

  for (const spec of ebookSpecs) {
    const existing = await prisma.book.findFirst({ where: { title: spec.title } });
    if (existing) {
      // Lengkapi dimensi kurikulum pada ebook yang sudah ada.
      await prisma.book.update({
        where: { id: existing.id },
        data: { grade: spec.grade, subject: spec.subject, major: spec.major },
      });
      continue;
    }

    const buffer = buildPdf(spec.title, `${spec.author} - Terbit ${spec.year}`, spec.chapters);
    const filePath = writeEbookFile(spec.fileName, buffer);

    await prisma.book.create({
      data: {
        title: spec.title,
        author: spec.author,
        isbn: spec.isbn,
        publisher: spec.publisher,
        year: spec.year,
        // Digital copies have no physical stock; availability is governed by loans.
        stock: 0,
        description: spec.description,
        categoryId: spec.categoryId,
        format: 'EBOOK',
        filePath,
        pageCount: spec.chapters.length + 1,
        grade: spec.grade,
        subject: spec.subject,
        major: spec.major,
      },
    });
  }
  console.log('Ebooks seeded');

  // Catatan: katalog referensi/placeholder lama (mapel umum & kejuruan SMK)
  // sengaja TIDAK dibuat lagi di sini agar seed tidak memasukkan kembali data
  // katalog kosong. Buku hanya ditambahkan melalui unggahan resmi Admin/Pustakawan.

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
