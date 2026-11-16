/**
 * End-to-end verification of the AI Assistant fixes.
 *
 * Usage:
 *   npm run build
 *   $env:PORT="3111"; npm start
 *   node scripts/e2e-ai-assistant.mjs
 *
 * Reads BASE_URL (default http://127.0.0.1:3111).
 * Set SKIP_PROVIDER=1 to skip checks that depend on the live AI provider.
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3111";
const SKIP_PROVIDER = process.env.SKIP_PROVIDER === "1";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -> ${detail}` : ""}`);
}
function skip(name, why) {
  results.push({ name, pass: true, skipped: true });
  console.log(`SKIP  ${name} -> ${why}`);
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

async function postChat(jar, messages) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ messages }),
  });
  const ms = Date.now() - started;
  return { status: res.status, body: await res.json().catch(() => ({})), ms };
}

async function main() {
  // --- Anonymous access ------------------------------------------------
  let res = await fetch(`${BASE}/api/ai/chat`);
  check("GET anonymous rejected", res.status === 401, `status ${res.status}`);

  res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hai" }] }),
  });
  check("POST anonymous rejected", res.status === 401, `status ${res.status}`);

  const guru = await login("guru@sma.id", "password123");

  // --- Personalized first greeting (no provider needed) ----------------
  res = await fetch(`${BASE}/api/ai/chat`, { headers: { Cookie: guru.header() } });
  let body = await res.json();
  check("GET identity greeting", res.status === 200 && body.greeting === "Hai, Pak Guru. Ada yang bisa saya bantu?", JSON.stringify(body.greeting));

  // --- Pure greeting answered deterministically ------------------------
  const greet = await postChat(guru, [{ role: "user", content: "halo" }]);
  check("Greeting personalized", greet.body.message === "Hai, Pak Guru. Ada yang bisa saya bantu?", JSON.stringify(greet.body.message));
  check("Greeting intent CHITCHAT", greet.body.intent === "CHITCHAT", greet.body.intent);

  // --- Input validation ------------------------------------------------
  const badLast = await postChat(guru, [
    { role: "user", content: "hai" },
    { role: "assistant", content: "hai juga" },
  ]);
  check("Rejects conversation not ending in user message", badLast.status === 400, `status ${badLast.status}`);

  const empty = await postChat(guru, [{ role: "user", content: "   " }]);
  check("Rejects empty message", empty.status === 400, `status ${empty.status}`);

  // --- Provider round-trip --------------------------------------------
  if (SKIP_PROVIDER) {
    skip("Provider chit-chat round-trip", "SKIP_PROVIDER=1");
    skip("Provider catalog recommendation", "SKIP_PROVIDER=1");
    skip("Provider catalog follow-up", "SKIP_PROVIDER=1");
  } else {
    const chat = await postChat(guru, [{ role: "user", content: "Hai, apa yang bisa kamu bantu?" }]);
    check(
      "Provider chit-chat answers without error",
      chat.status === 200 && typeof chat.body.message === "string" && chat.body.message.length > 0,
      `status ${chat.status}, ${chat.ms}ms, len ${chat.body.message?.length ?? 0}`
    );
    check("Provider chit-chat within time budget", chat.ms < 40_000, `${chat.ms}ms`);

    const siswa = await login("siswa@sma.id", "password123");
    const history = [{ role: "user", content: "Rekomendasi buku tentang jaringan komputer" }];
    const first = await postChat(siswa, history);
    check(
      "Catalog recommendation answered",
      first.status === 200 && typeof first.body.message === "string" && first.body.message.length > 0,
      `status ${first.status}, ${first.ms}ms`
    );
    check("Catalog intent detected", first.body.intent === "CATALOG", first.body.intent);

    const follow = await postChat(siswa, [
      ...history,
      { role: "assistant", content: first.body.message || "" },
      { role: "user", content: "Yang untuk kelas 11 ada?" },
    ]);
    check(
      "Catalog follow-up answered",
      follow.status === 200 && typeof follow.body.message === "string" && follow.body.message.length > 0,
      `status ${follow.status}, ${follow.ms}ms`
    );
    check("Catalog follow-up stays in catalog intent", follow.body.intent === "CATALOG", follow.body.intent);
  }

  const failed = results.filter((r) => !r.pass);
  const executed = results.filter((r) => !r.skipped).length;
  console.log(`\n${executed - failed.length}/${executed} checks passed (${results.length - executed} skipped)`);
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