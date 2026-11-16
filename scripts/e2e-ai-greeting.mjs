/**
 * End-to-end verification of AI personal greeting.
 *
 * Usage:
 *   npm run build && PORT=3111 npm start &
 *   node scripts/e2e-ai-greeting.mjs
 *
 * Reads BASE_URL (default http://127.0.0.1:3111).
 * A pure greeting is answered deterministically, so no AI provider call is
 * needed. Verifies each account is greeted with its own name/title only.
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3111";

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

async function greet(jar, content) {
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
  const anonymous = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hai" }] }),
  });
  check("Anonymous request rejected", anonymous.status === 401, `status ${anonymous.status}`);

  const cases = [
    { label: "guru (male teacher)", email: "guru@sma.id", own: "Pak Guru", expect: "Hai, Pak Guru. Ada yang bisa saya bantu?" },
    { label: "kartini (female teacher)", email: "kartini@sma.id", own: "Bu Kartini Sari", expect: "Hai, Bu Kartini Sari. Ada yang bisa saya bantu?" },
    { label: "siswa (male student)", email: "siswa@sma.id", own: "Siswa Rajin", expect: "Hai, Siswa Rajin. Ada yang bisa saya bantu?" },
    { label: "bela (female student)", email: "bela@sma.id", own: "Bela Nuraini", expect: "Hai, Bela Nuraini. Ada yang bisa saya bantu?" },
    { label: "staf (gender unknown)", email: "staf@sma.id", own: "Staf Tata Usaha", expect: "Hai, Staf Tata Usaha. Ada yang bisa saya bantu?" },
  ];

  const others = cases.map((c) => c.own);

  for (const c of cases) {
    const jar = await login(c.email, "password123");
    const res = await greet(jar, "hai");

    check(`[${c.label}] greeting answered`, res.status === 200, `status ${res.status}`);
    check(`[${c.label}] exact greeting`, res.body.message === c.expect, JSON.stringify(res.body.message));
    check(`[${c.label}] intent is CHITCHAT`, res.body.intent === "CHITCHAT", res.body.intent);

    const leaked = others.some((name) => name !== c.own && res.body.message.includes(name));
    check(`[${c.label}] no other account name leaked`, !leaked, leaked ? "leaked" : "clean");
  }

  // Variations of a pure greeting should all be personalized identically.
  const guru = await login("guru@sma.id", "password123");
  for (const variant of ["Halo", "Hai!", "selamat pagi", "apa kabar"]) {
    const res = await greet(guru, variant);
    check(
      `variant "${variant}" personalized`,
      res.body.message === "Hai, Pak Guru. Ada yang bisa saya bantu?",
      JSON.stringify(res.body.message)
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error(`\n${failed.length} FAILED:`);
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});