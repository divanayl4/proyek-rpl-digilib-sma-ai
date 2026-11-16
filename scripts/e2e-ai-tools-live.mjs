/**
 * Uji live: AI Assistant menjawab pertanyaan seputar fitur DigiLib dengan
 * tool-calling terhadap database NYATA.
 *
 * Usage:
 *   $env:PORT="3000"; node scripts/e2e-ai-tools-live.mjs
 *
 * Server harus sudah berjalan (npm run dev / npm start).
 */

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -> ${detail}` : ""}`);
}

class Jar {
  constructor() {
    this.cookies = new Map();
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res) {
    const raw =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of raw) {
      const [pair] = c.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
}

async function login(email, password) {
  const jar = new Jar();
  let res = await fetch(`${BASE}/api/auth/csrf`);
  jar.absorb(res);
  const { csrfToken } = await res.json();

  res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(),
    },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
    redirect: "manual",
  });
  jar.absorb(res);
  return jar;
}

async function postChat(jar, content) {
  const startedAt = Date.now();
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
  const ms = Date.now() - startedAt;
  return { status: res.status, body: await res.json().catch(() => ({})), ms };
}

async function main() {
  // --- Akses ditolak untuk peran yang tidak berhak ----------------------
  // Staf tidak termasuk role AI (hanya Siswa, Guru, Pustakawan, Admin).
  const staf = await login("staf@sma.id", "password123");
  let res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: staf.header() },
    body: JSON.stringify({ messages: [{ role: "user", content: "hai" }] }),
  });
  check("POST staf ditolak (403)", res.status === 403, `status ${res.status}`);

  // Admin dan Pustakawan kini memiliki akses AI dengan hak sesuai role.
  const adminCheck = await login("admin@sma.id", "password123");
  res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCheck.header() },
    body: JSON.stringify({ messages: [{ role: "user", content: "hai" }] }),
  });
  check("POST admin diizinkan", res.status === 200, `status ${res.status}`);

  const siswa = await login("siswa@sma.id", "password123");
  const guru = await login("guru@sma.id", "password123");

  // --- Sapaan personal --------------------------------------------------
  res = await fetch(`${BASE}/api/ai/chat`, { headers: { Cookie: siswa.header() } });
  let body = await res.json();
  check(
    "GET sapaan personal siswa",
    res.status === 200 && body.greeting === "Hai, Siswa Rajin. Ada yang bisa saya bantu?",
    JSON.stringify(body.greeting)
  );

  // --- Jalur deterministik tetap stabil ----------------------------------
  const det1 = await postChat(siswa, "Buku apa yang sedang saya pinjam?");
  check(
    "Deterministik: pinjaman aktif siswa",
    det1.status === 200 && det1.body.intent === "MY_LOANS" && det1.body.verified === true,
    `intent=${det1.body.intent}`
  );

  const det2 = await postChat(siswa, "Ada berapa buku di perpustakaan?");
  check(
    "Deterministik: jumlah buku = 4 judul",
    det2.status === 200 && det2.body.message.includes("4 judul"),
    det2.body.message
  );

  // --- Jalur model + tool-calling ---------------------------------------
  // Pertanyaan ini TIDAK cocok regex katalog lama ("koleksi" bukan kata kunci),
  // jadi harus dijawab model lewat tool list_available_books/search_books.
  const t1 = await postChat(siswa, "Tolong tampilkan semua koleksi buku yang ada di perpustakaan kita");
  check(
    "Tool: daftar koleksi menjawab dari data nyata",
    t1.status === 200 && /Fisika Dasar untuk SMA|Bumi Manusia/.test(t1.body.message ?? ""),
    `status=${t1.status} ${(t1.body.message ?? t1.body.error ?? "").slice(0, 120)}`
  );

  // Pertanyaan notifikasi — fitur yang sebelumnya tidak punya jalur data.
  const t2 = await postChat(siswa, "Notifikasi saya ada apa saja?");
  check(
    "Tool: notifikasi milik pengguna",
    t2.status === 200 && typeof t2.body.message === "string" && t2.body.message.length > 0,
    `status=${t2.status} ${(t2.body.message ?? t2.body.error ?? "").slice(0, 120)}`
  );

  // Pertanyaan ringkasan buku lewat model.
  const t3 = await postChat(siswa, "Buku 'Bumi Manusia' itu bagaimana?");
  check(
    "Tool: info buku dari metadata nyata",
    t3.status === 200 && /Pramoedya Ananta Toer/.test(t3.body.message ?? ""),
    `status=${t3.status} ${(t3.body.message ?? t3.body.error ?? "").slice(0, 120)}`
  );

  // Data guru tidak boleh bocor ke jawaban siswa.
  const t4 = await postChat(guru, "Berapa denda saya?");
  check(
    "Deterministik: denda guru miliknya sendiri",
    t4.status === 200 && /lunas/i.test(t4.body.message ?? ""),
    t4.body.message
  );

  // Pertanyaan kebijakan (tanpa tool) tetap dijawab wajar oleh model.
  const t5 = await postChat(siswa, "Bagaimana cara meminjam buku di DigiLib?");
  check(
    "Model: kebijakan peminjaman dijawab",
    t5.status === 200 && typeof t5.body.message === "string" && t5.body.message.length > 10,
    `status=${t5.status}`
  );

  // Pertanyaan coding murni tetap ditolak.
  const t6 = await postChat(siswa, "Buatkan program Python");
  check(
    "Penolakan coding tetap jalan",
    t6.status === 200 && /hanya dapat membantu/.test(t6.body.message ?? ""),
    (t6.body.message ?? "").slice(0, 80)
  );

  // Coding yang menyebut objek katalog ("buku tentang...") tetap dianggap
  // pertanyaan katalog, bukan permintaan kode.
  const t7 = await postChat(siswa, "Buatkan program Python untuk buku perpustakaan");
  check(
    "Coding berkata katalog tetap dianggap katalog",
    t7.status === 200 && !/hanya dapat membantu/.test(t7.body.message ?? ""),
    (t7.body.message ?? "").slice(0, 80)
  );

  const gagal = results.filter((r) => !r.pass).length;
  console.log(`\n=== ${results.length - gagal}/${results.length} lulus ===`);
  process.exitCode = gagal > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
