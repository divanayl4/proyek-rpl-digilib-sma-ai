/**
 * Cek cepat: "tampilkan semua koleksi" harus menjadi permintaan daftar penuh,
 * bukan pencarian dengan kata kunci sisa.
 *
 * Jalankan: npx tsx scripts/verify-catalog-words.ts
 */
import { extractSearchTerms, resolveCatalogQuery } from "../src/lib/ai/catalog";

const queries = [
  "Tolong tampilkan semua koleksi buku yang ada di perpustakaan kita",
  "Tampilkan semua buku yang tersedia",
  "Daftar buku kelas X",
  "Cari buku fisika untuk kelas 11",
  "Rekomendasikan buku cerpen untuk jurusan TKJ",
];

let masalah = 0;
for (const q of queries) {
  const { terms } = resolveCatalogQuery(q);
  console.log(`TANYA: ${q}`);
  console.log(`  terms: ${JSON.stringify(terms)}`);
  // Permintaan daftar tidak boleh menyisakan kata kunci sisa.
  if (q.toLowerCase().includes("tampilkan") && q.toLowerCase().includes("semua") && terms.length > 0) {
    console.log("  <<< MASALAH: sisa kata kunci pada permintaan daftar");
    masalah += 1;
  }
}
console.log(`\n masalah: ${masalah}`);
process.exitCode = masalah > 0 ? 1 : 0;
