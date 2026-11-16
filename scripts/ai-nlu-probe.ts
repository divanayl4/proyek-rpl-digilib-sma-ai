/**
 * Probe NLU + RBAC cepat. Menjalankan pertanyaan melalui pipeline nyata dan
 * menulis hasil ke file JSON (log server tidak mencampuri file).
 *
 * Jalankan: npx tsx scripts/ai-nlu-probe.ts [output.json]
 */
import { writeFileSync } from "node:fs";
import { processChat, resetRateLimits } from "../src/lib/ai/pipeline";

const USERS: Record<string, string> = {
  ADMIN: "5a7af1f3-0d69-4a81-951a-f7982e1e3d1a",
  LIBRARIAN: "acb57ba5-a215-45a4-9892-f5c4f3977ed5",
  TEACHER: "520a8b5b-b16c-4e40-a1b4-718d16a26a07",
  STUDENT: "8927e4eb-db71-44f2-999d-ac1f17d96f39",
  STAFF: "50823bdc-e3cf-434c-b90c-38313f79aa34",
};

const CASES: Array<{ role: keyof typeof USERS; turns: string[] }> = [
  // ADMIN — direktori, statistik, operasional
  { role: "ADMIN", turns: ["Siapa administrator?"] },
  { role: "ADMIN", turns: ["Siapa saja pengguna?"] },
  { role: "ADMIN", turns: ["Ada berapa pengguna?"] },
  { role: "ADMIN", turns: ["Siapa guru?"] },
  { role: "ADMIN", turns: ["Berapa pengguna per role?"] },
  { role: "ADMIN", turns: ["Tampilkan semua siswa"] },
  { role: "ADMIN", turns: ["Siapa saja siswa kelas XII IPA 1?"] },
  { role: "ADMIN", turns: ["Berapa jumlah buku?"] },
  { role: "ADMIN", turns: ["Buku apa yang tersedia?"] },
  { role: "ADMIN", turns: ["Apakah Bumi Manusia tersedia?"] },
  { role: "ADMIN", turns: ["Berapa stok Bumi Manusia?"] },
  { role: "ADMIN", turns: ["Buku sejarah ada?"] },
  { role: "ADMIN", turns: ["Kategori apa saja yang ada?"] },
  { role: "ADMIN", turns: ["Berapa buku per kategori?"] },
  { role: "ADMIN", turns: ["Siapa yang sedang meminjam?"] },
  { role: "ADMIN", turns: ["Siapa yang terlambat mengembalikan?"] },
  { role: "ADMIN", turns: ["Berapa total denda?"] },
  { role: "ADMIN", turns: ["Siapa yang mempunyai denda?"] },
  { role: "ADMIN", turns: ["Total denda yang belum dibayar"] },
  { role: "ADMIN", turns: ["Tampilkan transaksi peminjaman terbaru"] },
  { role: "ADMIN", turns: ["Berapa transaksi peminjaman bulan Oktober?"] },
  { role: "ADMIN", turns: ["Siapa yang paling sering meminjam?"] },
  { role: "ADMIN", turns: ["Aktivitas membaca ebook"] },
  { role: "ADMIN", turns: ["Pengaturan sistem apa saja?"] },
  { role: "ADMIN", turns: ["Siapa yang membuat akun terbaru?"] },
  { role: "ADMIN", turns: ["Model AI apa yang digunakan?"] },
  { role: "ADMIN", turns: ["Apa itu perpustakaan digital?"] },
  { role: "ADMIN", turns: ["Siapa presiden Indonesia sekarang?"] },
  { role: "ADMIN", turns: ["halo"] },
  { role: "ADMIN", turns: ["Siapa nama saya?"] },
  { role: "ADMIN", turns: ["Berapa denda saya?"] },
  { role: "ADMIN", turns: ["Pinjaman saya apa saja?"] },

  // LIBRARIAN — operasional boleh, direktori/denda tertarget tidak
  { role: "LIBRARIAN", turns: ["Siapa administrator?"] },
  { role: "LIBRARIAN", turns: ["Berapa jumlah pengguna?"] },
  { role: "LIBRARIAN", turns: ["Tampilkan riwayat peminjaman Najla"] },
  { role: "LIBRARIAN", turns: ["Berapa denda Najla?"] },
  { role: "LIBRARIAN", turns: ["Berapa denda saya?"] },
  { role: "LIBRARIAN", turns: ["Pengaturan sistem apa saja?"] },
  { role: "LIBRARIAN", turns: ["Siapa yang sedang meminjam?"] },
  { role: "LIBRARIAN", turns: ["Aktivitas membaca ebook"] },

  // STUDENT — hanya data sendiri + katalog
  { role: "STUDENT", turns: ["Buku apa saja yang pernah saya pinjam?"] },
  { role: "STUDENT", turns: ["Buku yang sedang saya pinjam apa saja?"] },
  { role: "STUDENT", turns: ["Apakah saya punya denda?"] },
  { role: "STUDENT", turns: ["Riwayat ebook saya"] },
  { role: "STUDENT", turns: ["Aktivitas membaca saya"] },
  { role: "STUDENT", turns: ["Tampilkan riwayat peminjaman Najla"] },
  { role: "STUDENT", turns: ["Berapa denda Najla?"] },
  { role: "STUDENT", turns: ["Siapa yang sedang meminjam?"] },
  { role: "STUDENT", turns: ["Berapa jumlah pengguna?"] },
  { role: "STUDENT", turns: ["Siapa administrator?"] },
  { role: "STUDENT", turns: ["Tugas saya apa?"] },
  { role: "STUDENT", turns: ["Tugas pustakawan apa?"] },
  { role: "STUDENT", turns: ["Model AI apa yang digunakan?"] },
  { role: "STUDENT", turns: ["Siapa nama saya?"] },
  { role: "STUDENT", turns: ["Buku apa saja yang tersedia?"] },

  // TEACHER
  { role: "TEACHER", turns: ["Berapa denda saya?"] },
  { role: "TEACHER", turns: ["Riwayat peminjaman saya"] },
  { role: "TEACHER", turns: ["Tampilkan denda seluruh siswa"] },
  { role: "TEACHER", turns: ["Berapa pengguna per role?"] },
  { role: "TEACHER", turns: ["Apa tugas guru?"] },

  // STAFF
  { role: "STAFF", turns: ["Siapa nama saya?"] },
  { role: "STAFF", turns: ["Buku apa saja yang tersedia?"] },
  { role: "STAFF", turns: ["Pinjaman saya apa saja?"] },
  { role: "STAFF", turns: ["Berapa denda saya?"] },
  { role: "STAFF", turns: ["Siapa yang sedang meminjam?"] },
  { role: "STAFF", turns: ["Tampilkan riwayat peminjaman Najla"] },
  { role: "STAFF", turns: ["Tugas staf apa?"] },
  { role: "STAFF", turns: ["Model AI apa yang digunakan?"] },

  // Follow-up & pergantian topik
  { role: "ADMIN", turns: ["Ada berapa buku?", "Kalau kategori sejarah?"] },
  { role: "ADMIN", turns: ["Buku apa saja yang tersedia?", "Berapa jumlahnya?"] },
  { role: "ADMIN", turns: ["Buku apa saja yang tersedia?", "Ada versi ebook?", "Berapa jumlahnya?"] },
  { role: "ADMIN", turns: ["Ada berapa pengguna?", "Sekarang buku apa saja?"] },
  { role: "STUDENT", turns: ["Apakah saya punya denda?", "Kalau pinjaman saya?"] },
  { role: "LIBRARIAN", turns: ["Siapa yang sedang meminjam?", "Yang paling lama siapa?"] },
  { role: "ADMIN", turns: ["Berapa total denda?", "Kalau yang sudah dibayar?"] },
];

async function main() {
  const out = process.argv[2] || "ai-nlu-probe.json";
  const rows: unknown[] = [];
  for (const c of CASES) {
    resetRateLimits();
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    const turns: unknown[] = [];
    for (const q of c.turns) {
      messages.push({ role: "user", content: q });
      try {
        const r = await processChat({ userId: USERS[c.role], messages: [...messages] });
        turns.push({
          q,
          intent: r.intent,
          verified: r.verified,
          ai: r.ai ?? null,
          answer: r.message,
        });
        messages.push({ role: "assistant", content: r.message });
      } catch (error) {
        const err = error as { message?: string; status?: number; code?: string };
        turns.push({ q, error: err.message, status: err.status, code: err.code });
        messages.push({ role: "assistant", content: `[error] ${err.message}` });
      }
    }
    rows.push({ role: c.role, turns });
  }
  writeFileSync(out, JSON.stringify(rows, null, 2), "utf8");
  console.log(`Wrote ${out} (${rows.length} conversations)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
