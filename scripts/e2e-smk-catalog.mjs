/**
 * End-to-end verification of the SMK catalog: curriculum dimensions
 * (kelas / mata pelajaran / jurusan), search+filter, filePath protection, and
 * the ebook placeholder + upload paths.
 *
 * Usage:
 *   npm run build
 *   $env:PORT="3111"; npm run start    (separate shell)
 *   node scripts/e2e-smk-catalog.mjs
 *
 * Reads BASE_URL (default http://127.0.0.1:3111).
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

async function getJson(jar, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: jar ? { Cookie: jar.header() } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
  // --- Public catalog + filters -------------------------------------------
  const anon = await getJson(null, "/api/books?pageSize=5");
  check("Anonymous can browse catalog", anon.status === 200, `status ${anon.status}`);

  const filters = await getJson(null, "/api/books/filters");
  check("Filters endpoint responds", filters.status === 200, `status ${filters.status}`);
  const { grades = [], subjects = [], majors = [] } = filters.body;
  check("Grades cover X, XI, XII", ["X", "XI", "XII"].every((g) => grades.includes(g)), JSON.stringify(grades));
  check("Subjects are populated", subjects.length > 0, `${subjects.length} subjects`);
  check("Majors are populated", majors.length > 0, `${majors.length} majors`);
  check("Includes a general subject", subjects.includes("Matematika"), "Matematika present");
  check(
    "Includes a vocational major",
    majors.includes("Rekayasa Perangkat Lunak"),
    "RPL present"
  );

  // --- Filtering by each dimension ----------------------------------------
  const byGrade = await getJson(null, "/api/books?grade=X&pageSize=50");
  check(
    "Filter by kelas X",
    byGrade.status === 200 && byGrade.body.books.length > 0 && byGrade.body.books.every((b) => b.grade === "X"),
    `${byGrade.body.books?.length ?? 0} books`
  );

  const subject = subjects[0];
  const bySubject = await getJson(null, `/api/books?subject=${encodeURIComponent(subject)}&pageSize=50`);
  check(
    `Filter by mapel "${subject}"`,
    bySubject.status === 200 &&
      bySubject.body.books.length > 0 &&
      bySubject.body.books.every((b) => b.subject === subject),
    `${bySubject.body.books?.length ?? 0} books`
  );

  const major = majors[0];
  const byMajor = await getJson(null, `/api/books?major=${encodeURIComponent(major)}&pageSize=50`);
  check(
    `Filter by jurusan "${major}"`,
    byMajor.status === 200 &&
      byMajor.body.books.length > 0 &&
      byMajor.body.books.every((b) => b.major === major),
    `${byMajor.body.books?.length ?? 0} books`
  );

  const search = await getJson(null, "/api/books?search=Jaringan&pageSize=50");
  const searchHit = search.body.books?.some(
    (b) =>
      (b.subject || "").toLowerCase().includes("jaringan") ||
      (b.major || "").toLowerCase().includes("jaringan") ||
      (b.title || "").toLowerCase().includes("jaringan")
  );
  check("Search reaches subject/major", search.body.books?.length > 0 && searchHit, `${search.body.books?.length ?? 0} books`);

  // --- filePath must never reach the client -------------------------------
  const allBooks = await getJson(null, "/api/books?pageSize=50");
  const anyLeak = (allBooks.body.books || []).some((b) => "filePath" in b);
  const allHaveFlag = (allBooks.body.books || []).every((b) => typeof b.hasEbookFile === "boolean");
  check("No filePath leaked in catalog", !anyLeak, anyLeak ? "LEAKED" : "clean");
  check("hasEbookFile flag present", allHaveFlag, allHaveFlag ? "ok" : "missing");

  // --- Admin: placeholder ebook + upload guard ----------------------------
  const admin = await login("admin@sma.id", "password123");

  const createRes = await fetch(`${BASE}/api/books`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.header() },
    body: JSON.stringify({
      title: `E2E Placeholder ${Date.now()}`,
      author: "Tim Penyusun",
      grade: "X",
      subject: "Informatika",
      major: "Rekayasa Perangkat Lunak",
      format: "EBOOK",
    }),
  });
  const created = await createRes.json();
  check("Admin creates ebook placeholder", createRes.status === 201, `status ${createRes.status}`);
  check("Placeholder has no file yet", created.hasEbookFile === false, String(created.hasEbookFile));
  check("Placeholder keeps its dimensions", created.grade === "X" && created.major === "Rekayasa Perangkat Lunak", `${created.grade}/${created.major}`);
  check("Placeholder response hides filePath", !("filePath" in created), "clean");

  // A non-PDF upload must be rejected before it is stored.
  const badForm = new FormData();
  badForm.append("file", new Blob(["not a pdf"], { type: "application/pdf" }), "fake.pdf");
  const badUpload = await fetch(`${BASE}/api/upload/ebook`, {
    method: "POST",
    headers: { Cookie: admin.header() },
    body: badForm,
  });
  check("Upload rejects a non-PDF payload", badUpload.status === 400, `status ${badUpload.status}`);

  // Detail endpoint serializes the same way.
  if (created.id) {
    const detail = await getJson(admin, `/api/books/${created.id}`);
    check("Detail hides filePath", !("filePath" in (detail.body.book || {})), "clean");
    check("Detail reports hasEbookFile=false", detail.body.book?.hasEbookFile === false, String(detail.body.book?.hasEbookFile));

    // Editing without a file keeps the placeholder a valid catalog entry.
    const patchRes = await fetch(`${BASE}/api/books/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: admin.header() },
      body: JSON.stringify({ subject: "Matematika", grade: "XI" }),
    });
    const patched = await patchRes.json();
    check("Admin edits curriculum fields", patchRes.status === 200 && patched.subject === "Matematika" && patched.grade === "XI", `${patched.subject}/${patched.grade}`);

    // Clean up the placeholder so repeated runs do not accumulate rows.
    const del = await fetch(`${BASE}/api/books/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: admin.header() },
    });
    check("Cleanup deletes the placeholder", del.status === 200, `status ${del.status}`);
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