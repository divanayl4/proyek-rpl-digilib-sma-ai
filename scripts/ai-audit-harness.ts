/**
 * Harness audit chatbot DigiLib — menjalankan pertanyaan nyata lewat pipeline
 * dan menyimpan intent, status verifikasi, serta jawaban akhir.
 *
 * Jalankan: npx tsx scripts/ai-audit-harness.ts
 */
import { processChat, resetRateLimits } from "../src/lib/ai/pipeline";

const USERS = {
  ADMIN: "5a7af1f3-0d69-4a81-951a-f7982e1e3d1a",
  LIBRARIAN: "acb57ba5-a215-45a4-9892-f5c4f3977ed5",
  TEACHER: "520a8b5b-b16c-4e40-a1b4-718d16a26a07",
  STUDENT: "8927e4eb-db71-44f2-999d-ac1f17d96f39",
  STAFF: "50823bdc-e3cf-434c-b90c-38313f79aa34",
} as const;

type Role = keyof typeof USERS;

interface Case {
  id: string;
  role: Role;
  turns: string[];
  expect?: string;
}

const CASES: Case[] = [
  { id: "U01", role: "ADMIN", turns: ["Siapa saja pengguna?"], expect: "8 pengguna: Andi, Endi, Guru, Siswa Rajin, Staf Tata Usaha, Bela Nuraini, Najla, Marza Bulan" },
  { id: "U02", role: "ADMIN", turns: ["Ada berapa pengguna?"], expect: "8" },
  { id: "U03", role: "ADMIN", turns: ["Siapa administrator?"], expect: "Andi" },
  { id: "U04", role: "ADMIN", turns: ["Berapa jumlah buku?"], expect: "2 judul buku fisik (5 buku total termasuk ebook)" },
  { id: "U05", role: "ADMIN", turns: ["Buku apa yang tersedia?"], expect: "Bumi Manusia, Fisika Dasar untuk SMA" },
  { id: "U06", role: "ADMIN", turns: ["Apakah buku Bumi Manusia tersedia?"], expect: "tersedia, stok 5" },
  { id: "U07", role: "LIBRARIAN", turns: ["Siapa yang sedang meminjam?"], expect: "tidak ada peminjaman aktif (3 baris REJECTED bukan pinjaman)" },
  { id: "U08", role: "LIBRARIAN", turns: ["Siapa yang terlambat mengembalikan?"], expect: "tidak ada" },
  { id: "U09", role: "LIBRARIAN", turns: ["Berapa total denda?"], expect: "Rp166.000 (5 catatan, semua lunas)" },
  { id: "U10", role: "LIBRARIAN", turns: ["Siapa yang mempunyai denda?"], expect: "Najla, Guru, Marza Bulan" },
  { id: "U11", role: "ADMIN", turns: ["Model AI apa yang digunakan?"], expect: "OpenRouter openai/gpt-4o" },
  { id: "U12", role: "STUDENT", turns: ["Apa yang dimaksud dengan sistem perpustakaan digital?"], expect: "penjelasan konsep, bukan data internal" },
  { id: "U13", role: "STUDENT", turns: ["Siapa presiden Indonesia sekarang?"], expect: "di luar cakupan" },

  { id: "V01", role: "ADMIN", turns: ["ada brp buku sih"], expect: "jumlah buku" },
  { id: "V02", role: "ADMIN", turns: ["jumlah buku dong"], expect: "jumlah buku" },
  { id: "V03", role: "ADMIN", turns: ["bukunya ada berapa?"], expect: "jumlah buku" },
  { id: "V04", role: "LIBRARIAN", turns: ["siapa aja yang minjem sekarang"], expect: "peminjaman aktif" },
  { id: "V05", role: "LIBRARIAN", turns: ["ada yang telat balikin?"], expect: "keterlambatan" },
  { id: "V06", role: "ADMIN", turns: ["kategori apa aja yang ada?"], expect: "10 kategori" },
  { id: "V07", role: "ADMIN", turns: ["buku sejarah ada?"], expect: "jawaban jujur (kemungkinan tidak ada)" },
  { id: "V08", role: "ADMIN", turns: ["total denda yang belum dibayar"], expect: "Rp0 (semua lunas)" },
  { id: "V09", role: "STUDENT", turns: ["buku yang lagi gue pinjem apa aja"], expect: "pinjaman sendiri" },
  { id: "V10", role: "ADMIN", turns: ["berapa ebook yang tersedia"], expect: "2 ebook aktif (1 arsip)" },

  { id: "M01", role: "ADMIN", turns: ["Ada berapa buku?", "Kalau kategori sejarah?"], expect: "jumlah buku kategori sejarah" },
  { id: "M02", role: "LIBRARIAN", turns: ["Siapa yang sedang meminjam?", "Yang paling lama siapa?"], expect: "referensi daftar peminjam sebelumnya" },
  { id: "M03", role: "ADMIN", turns: ["Buku apa saja yang tersedia?", "Berapa jumlahnya?"], expect: "2 judul" },
  { id: "M04", role: "ADMIN", turns: ["Buku apa saja yang tersedia?", "Ada versi ebook?", "Berapa jumlahnya?"], expect: "2 ebook" },
  { id: "M05", role: "ADMIN", turns: ["Ada berapa pengguna?", "Sekarang buku apa saja?"], expect: "topik berganti ke buku" },
  { id: "M06", role: "STUDENT", turns: ["Apakah saya punya denda?", "Kalau pinjaman saya?"], expect: "topik berganti ke pinjaman" },
];

async function runCase(c: Case) {
  resetRateLimits();
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const turnResults: Array<Record<string, unknown>> = [];

  for (const turn of c.turns) {
    messages.push({ role: "user", content: turn });
    try {
      const r = await processChat({ userId: USERS[c.role], messages: [...messages] });
      turnResults.push({
        turn,
        intent: r.intent,
        verified: r.verified,
        message: r.message,
        ai: r.ai ?? null,
      });
      messages.push({ role: "assistant", content: r.message });
    } catch (error) {
      const err = error as { status?: number; code?: string; message?: string };
      turnResults.push({
        turn,
        error: err.message,
        status: err.status,
        code: err.code,
      });
      messages.push({ role: "assistant", content: `[error] ${err.message}` });
    }
  }

  return { id: c.id, role: c.role, expect: c.expect, turns: turnResults };
}

async function main() {
  const only = process.argv[2];
  const cases = only ? CASES.filter((c) => c.id === only) : CASES;
  const out: unknown[] = [];
  for (const c of cases) {
    out.push(await runCase(c));
    process.stderr.write(`done ${c.id}\n`);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("AUDIT_ERROR", e);
  process.exit(1);
});
