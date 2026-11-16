/**
 * Uji integrasi chatbot pasca-optimasi NIM: katalog, peminjaman aktif,
 * riwayat, dan data pribadi — dengan jeda antar permintaan agar tidak
 * menabrak rate limit maupun limit provider.
 *
 * Usage: node scripts/e2e-ai-nim-check.mjs
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -> ${detail}` : ""}`);
}

async function login(email) {
  const jar = new Map();
  const absorb = (res) => {
    const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of raw) {
      const [pair] = c.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  };
  let res = await fetch(`${BASE}/api/auth/csrf`);
  absorb(res);
  const { csrfToken } = await res.json();
  res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: new URLSearchParams({ csrfToken, email, password: "password123", json: "true" }),
    redirect: "manual",
  });
  absorb(res);
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function chat(cookie, content) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ms: Date.now() - t0, body };
}

async function main() {
  const siswa = await login("siswa@sma.id");

  const cases = [
    {
      name: "Katalog: jumlah buku",
      q: "Ada berapa buku di perpustakaan?",
      expect: /4 judul/,
    },
    {
      name: "Peminjaman aktif siswa",
      q: "Buku apa yang sedang saya pinjam?",
      expect: /tidak memiliki peminjaman aktif|sedang meminjam/,
    },
    {
      name: "Riwayat peminjaman",
      q: "Buku apa saja yang pernah saya pinjam?",
      expect: /Riwayat peminjamanmu|belum memiliki riwayat/,
    },
    {
      name: "Denda pribadi",
      q: "Berapa denda saya?",
      expect: /denda/i,
    },
    {
      name: "Model+tool: daftar koleksi",
      q: "Tolong tampilkan semua koleksi buku yang ada di perpustakaan kita",
      expect: /Bumi Manusia|Fisika Dasar/,
    },
  ];

  for (const c of cases) {
    const r = await chat(siswa, c.q);
    const msg = r.body.message ?? r.body.error ?? "";
    const pass = r.status === 200 && c.expect.test(msg);
    check(`${c.name} (${(r.ms / 1000).toFixed(1)}s)`, pass, msg.slice(0, 100));
    await sleep(12000);
  }

  const gagal = results.filter((x) => !x.pass).length;
  console.log(`\n=== ${results.length - gagal}/${results.length} lulus ===`);
  process.exitCode = gagal > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
