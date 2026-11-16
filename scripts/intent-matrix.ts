/**
 * Matriks intent: menjalankan banyak variasi pertanyaan lewat jalur route
 * (intent + jawaban deterministik) untuk menemukan pola yang salah jawab.
 *
 * Jalankan: npx tsx scripts/intent-matrix.ts
 */
import { prisma } from "../src/lib/prisma";
import { detectIntent } from "../src/lib/ai/intent";
import { buildPersonalAnswer } from "../src/lib/ai/personal";
import { buildCatalogAnswer } from "../src/lib/ai/catalog";

const QUERIES = [
  // --- riwayat / ebook ---
  "riwayat ebook saya",
  "riwayat peminjaman ebook saya",
  "riwayat bacaan saya",
  "sejarah ebook saya",
  "daftar ebook yang pernah saya pinjam",
  "ebook yang sudah saya kembalikan",
  "kapan terakhir saya mengembalikan ebook?",
  "berapa ebook yang pernah saya pinjam?",
  "berapa judul ebook yang pernah saya baca?",
  // --- pinjaman aktif ---
  "buku apa yang sedang saya pinjam?",
  "sedang membaca ebook apa?",
  "peminjaman aktif saya apa saja?",
  "apa saja yang masih saya pinjam?",
  "buku yang harus saya kembalikan",
  "buku yang jatuh temponya paling dekat",
  "kapan saya harus mengembalikan buku?",
  "apakah ada buku terlambat milik saya?",
  "buku terlambat saya yang mana?",
  // --- denda ---
  "berapa denda saya?",
  "denda saya kenapa ada?",
  "status pembayaran denda saya",
  // --- katalog ---
  "ada berapa buku di perpustakaan?",
  "ada berapa ebook yang bisa dibaca?",
  "buku apa saja yang tersedia?",
  "rekomendasikan buku fisika",
  "buku kelas X",
  "cari buku pemrograman",
  "berapa buku kategori fiksi?",
  // --- ringkasan ---
  "ringkas buku bumi manusia",
  "ringkas buku fisika dasar untuk sma ebook",
];

// Pertanyaan yang harusnya masuk jalur data pribadi (bukan katalog).
const SHOULD_BE_PERSONAL = [
  "riwayat ebook saya",
  "riwayat peminjaman ebook saya",
  "ebook yang sudah saya kembalikan",
  "berapa ebook yang pernah saya pinjam?",
  "berapa judul ebook yang pernah saya baca?",
  "buku yang harus saya kembalikan",
  "buku terlambat saya yang mana?",
];

async function main() {
  const student = await prisma.user.findFirst({
    where: { name: "Siswa Rajin", role: "STUDENT" },
    select: { id: true },
  });
  if (!student) throw new Error("Siswa Rajin tidak ditemukan");

  let masalah = 0;

  for (const query of QUERIES) {
    const intent = detectIntent(query, false);
    let message: string;
    try {
      if (intent === "MY_LOANS" || intent === "MY_HISTORY" || intent === "MY_FINES") {
        message = (await buildPersonalAnswer(intent, query, student.id)).message;
      } else if (intent === "CATALOG" || intent === "BOOK_SUMMARY" || intent === "STATS") {
        message = (await buildCatalogAnswer(intent, query)).message;
      } else {
        message = `(intent ${intent} → model)`;
      }
    } catch (error) {
      message = `!! GAGAL: ${error instanceof Error ? error.message : String(error)}`;
    }

    const salahIntent = SHOULD_BE_PERSONAL.includes(query) && !intent.startsWith("MY_");
    if (salahIntent) masalah += 1;

    console.log("──────────────────────────────────────────────");
    console.log(`TANYA : ${query}`);
    console.log(`INTENT: ${intent}${salahIntent ? "   <<< SALAH (harusnya MY_*)" : ""}`);
    const firstLine = message.split("\n")[0];
    console.log(`JAWAB : ${firstLine}`);
  }

  console.log(`\n=== Ringkasan: ${masalah} pertanyaan personal salah intent ===`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
