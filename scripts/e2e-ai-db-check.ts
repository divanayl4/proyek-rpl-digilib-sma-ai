/**
 * Uji end-to-end lapisan jawaban AI terhadap DATABASE NYATA (tanpa model).
 * Menjalankan alur yang sama seperti route /api/ai/chat untuk intent
 * MY_LOANS / MY_HISTORY / MY_FINES / CATALOG / STATS / BOOK_SUMMARY.
 *
 * Jalankan: npx tsx scripts/e2e-ai-db-check.ts
 */
import { prisma } from "../src/lib/prisma";
import { buildCatalogAnswer, mergeCatalogQuery } from "../src/lib/ai/catalog";
import { buildPersonalAnswer } from "../src/lib/ai/personal";
import { detectIntent } from "../src/lib/ai/intent";

const CASES: Array<{ user: string; query: string }> = [
  // Katalog / ketersediaan
  { user: "Siswa Rajin", query: "Rekomendasikan buku Fisika di perpustakaan." },
  { user: "Siswa Rajin", query: "Ada berapa buku di perpustakaan?" },
  { user: "Siswa Rajin", query: "Buku apa saja yang tersedia?" },
  { user: "Siswa Rajin", query: "Ada berapa ebook yang bisa dibaca?" },
  { user: "Bela Nuraini", query: "Cari buku pemrograman" },
  { user: "Siswa Rajin", query: "Ringkas buku Bumi Manusia" },
  // Peminjaman ebook milik sendiri
  { user: "Siswa Rajin", query: "Ebook apa yang sedang saya baca?" },
  { user: "Siswa Rajin", query: "Sisa masa akses ebook saya berapa hari?" },
  { user: "Siswa Rajin", query: "Riwayat peminjaman ebook saya" },
  { user: "Bela Nuraini", query: "Ebook apa yang sedang saya baca?" },
  { user: "Bela Nuraini", query: "Riwayat ebook saya" },
  { user: "Pak Guru", query: "Riwayat peminjaman saya" },
  { user: "Pak Guru", query: "Buku apa yang sedang saya pinjam?" },
  { user: "Siswa Rajin", query: "Buku apa yang sedang saya pinjam?" },
  { user: "Siswa Rajin", query: "Buku apa saja yang pernah saya pinjam?" },
  { user: "Siswa Rajin", query: "Berapa denda saya?" },
  { user: "Siswa Rajin", query: "Kapan jatuh tempo peminjaman saya?" },
  { user: "Pak Guru", query: "Berapa denda saya?" },
];

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true },
  });
  const byName = new Map(users.map((u) => [u.name, u]));

  for (const testCase of CASES) {
    const user = byName.get(testCase.user);
    if (!user) {
      console.log(`!! User "${testCase.user}" tidak ditemukan`);
      continue;
    }

    const intent = detectIntent(testCase.query, false);
    let answer: string;
    let refs: unknown[] = [];

    try {
      if (
        intent === "MY_LOANS" ||
        intent === "MY_HISTORY" ||
        intent === "MY_FINES"
      ) {
        const result = await buildPersonalAnswer(intent, testCase.query, user.id);
        answer = result.message;
        refs = result.references;
      } else if (
        intent === "CATALOG" ||
        intent === "BOOK_SUMMARY" ||
        intent === "STATS"
      ) {
        const result = await buildCatalogAnswer(intent, testCase.query);
        answer = result.message;
        refs = result.references;
      } else {
        answer = `(intent ${intent} — tidak deterministik, akan memakai model)`;
      }
    } catch (error) {
      answer = `!! GAGAL: ${error instanceof Error ? error.message : String(error)}`;
    }

    console.log("──────────────────────────────────────────────");
    console.log(`USER  : ${testCase.user} (${user.role})`);
    console.log(`TANYA : ${testCase.query}`);
    console.log(`INTENT: ${intent}`);
    console.log(`JAWAB :`);
    console.log(
      answer
        .split("\n")
        .map((l) => `        ${l}`)
        .join("\n")
    );
    if (refs.length > 0) {
      console.log(`REF   : ${JSON.stringify(refs)}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
