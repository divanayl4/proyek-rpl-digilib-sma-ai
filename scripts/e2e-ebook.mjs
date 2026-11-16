/**
 * End-to-end verification of the Pinjam & Baca Ebook flow.
 *
 * Usage:
 *   npm run build && PORT=3111 npm start &
 *   node scripts/e2e-ebook.mjs
 *
 * Reads BASE_URL (default http://127.0.0.1:3111).
 * Exercises the whole lifecycle: borrow -> read -> cross-user denial ->
 * expiry lock -> return -> reborrow -> quota.
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3111";
const prisma = new PrismaClient();

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

const api = async (jar, path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Cookie: jar.header(),
    },
  });
  // Track every Set-Cookie (notably the path-scoped ebook_read credential).
  jar.absorb(res);
  return res;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

async function main() {
  const alice = await login("siswa@sma.id", "password123");
  const bob = await login("bela@sma.id", "password123");
  // Session-only cookie header, captured before any /access call, so the
  // "no credential" checks are not accidentally satisfied by the read cookie.
  const aliceSessionOnly = alice.header();
  const bobSessionOnly = bob.header();

  // Confirm both sessions really are authenticated.
  const meA = await api(alice, "/api/ebooks");
  const meB = await api(bob, "/api/ebooks");
  check("Alice session authenticated", meA.status === 200, `status ${meA.status}`);
  check("Bob session authenticated", meB.status === 200, `status ${meB.status}`);

  const noAuth = await fetch(`${BASE}/api/ebooks`);
  check("Anonymous request rejected", noAuth.status === 401, `status ${noAuth.status}`);

  const catalog = await (await api(alice, "/api/ebooks")).json();
  check("Ebook catalog is non-empty", catalog.ebooks.length > 0, `${catalog.ebooks.length} ebooks`);
  check(
    "Catalog never exposes filePath",
    catalog.ebooks.every((e) => !("filePath" in e)),
    "verified"
  );
  check(
    "Access window advertised as 5 days",
    catalog.summary.accessDurationDays === 5,
    `${catalog.summary.accessDurationDays} days`
  );

  const target = catalog.ebooks[0];
  const other = catalog.ebooks[1] || target;

  // --- Borrow -------------------------------------------------------------
  const borrowRes = await api(alice, "/api/ebooks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ bookId: target.id }),
  });
  const borrowBody = await borrowRes.json();
  check("Alice borrows the ebook", borrowRes.status === 201, `status ${borrowRes.status}`);

  const gap =
    new Date(borrowBody.loan.expiresAt).getTime() -
    new Date(borrowBody.loan.borrowedAt).getTime();
  check(
    "borrowedAt -> expiresAt is exactly 5 days",
    gap === 5 * 24 * 3600 * 1000,
    `${gap / 86400000} days`
  );

  const dupRes = await api(alice, "/api/ebooks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ bookId: target.id }),
  });
  check("Double borrow rejected", dupRes.status === 400, `status ${dupRes.status}`);

  // --- Read as owner ------------------------------------------------------
  const accessRes = await api(alice, `/api/ebooks/${target.id}/access`, { method: "POST" });
  const accessBody = await accessRes.json();
  check("Owner gets a read token", accessRes.status === 200, `status ${accessRes.status}`);
  check("Token state is ACTIVE", accessBody.accessState === "ACTIVE", accessBody.accessState);

  const setCookie = accessRes.headers.getSetCookie
    ? accessRes.headers.getSetCookie().join("; ")
    : accessRes.headers.get("set-cookie") || "";
  check(
    "Access response sets a path-scoped HttpOnly read cookie",
    /ebook_read=/.test(setCookie) &&
      /HttpOnly/i.test(setCookie) &&
      /SameSite=strict/i.test(setCookie) &&
      setCookie.includes(`/api/ebooks/${target.id}/file`),
    setCookie.slice(0, 60)
  );

  const fileRes = await api(alice, accessBody.fileUrl);
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  check("Owner receives the PDF", fileRes.status === 200, `status ${fileRes.status}`);
  check(
    "Served bytes are a real PDF",
    bytes.subarray(0, 5).toString() === "%PDF-",
    bytes.subarray(0, 8).toString()
  );
  check(
    "Response is not cacheable",
    (fileRes.headers.get("cache-control") || "").includes("no-store"),
    fileRes.headers.get("cache-control")
  );

  // The reader points the iframe at a stable URL with no token in it; the
  // credential rides in the cookie, so the document never reloads mid-read.
  const stableUrlRes = await api(alice, `/api/ebooks/${target.id}/file`);
  check(
    "Stable token-free file URL is authorised by the read cookie",
    stableUrlRes.status === 200,
    `status ${stableUrlRes.status}`
  );

  // --- Cross-user isolation ----------------------------------------------
  const bobAccess = await api(bob, `/api/ebooks/${target.id}/access`, { method: "POST" });
  check("Bob cannot get a token for Alice's ebook", bobAccess.status === 403, `status ${bobAccess.status}`);

  const bobFile = await api(bob, accessBody.fileUrl);
  check("Bob cannot read Alice's ebook with Alice's URL", bobFile.status === 403, `status ${bobFile.status}`);

  const bobCatalog = await (await api(bob, "/api/ebooks")).json();
  const targetForBob = bobCatalog.ebooks.find((e) => e.id === target.id);
  check(
    "Bob sees the ebook as not borrowed by him",
    targetForBob && targetForBob.accessState === "NOT_BORROWED",
    targetForBob ? targetForBob.accessState : "missing"
  );

  // --- No token -----------------------------------------------------------
  const noToken = await fetch(`${BASE}/api/ebooks/${target.id}/file`, {
    headers: { Cookie: aliceSessionOnly },
  });
  check("File request without a token is refused", noToken.status === 403, `status ${noToken.status}`);

  // --- Range request ------------------------------------------------------
  const rangeRes = await api(alice, accessBody.fileUrl, { headers: { Range: "bytes=0-99" } });
  const rangeBytes = Buffer.from(await rangeRes.arrayBuffer());
  check(
    "Range request returns 206 with 100 bytes",
    rangeRes.status === 206 && rangeBytes.length === 100,
    `status ${rangeRes.status}, ${rangeBytes.length} bytes`
  );

  // --- Expiry -------------------------------------------------------------
  await prisma.ebookLoan.updateMany({
    where: { returnedAt: null },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const expiredAccess = await api(alice, `/api/ebooks/${target.id}/access`, { method: "POST" });
  check("Expired loan gets no token (410)", expiredAccess.status === 410, `status ${expiredAccess.status}`);
  check(
    "Expired access response withholds the token",
    (await expiredAccess.json()).token === undefined,
    "no token in body"
  );

  const expiredFile = await api(alice, accessBody.fileUrl);
  check("Replay of the old file URL after expiry is locked (410)", expiredFile.status === 410, `status ${expiredFile.status}`);

  const expiredCatalog = await (await api(alice, "/api/ebooks")).json();
  const expiredEntry = expiredCatalog.ebooks.find((e) => e.id === target.id);
  check(
    "Catalog reports Kedaluwarsa state",
    expiredEntry.accessState === "EXPIRED",
    expiredEntry.accessState
  );
  check(
    "Countdown is clamped at zero once expired",
    expiredEntry.remainingMs === 0,
    `${expiredEntry.remainingMs} ms`
  );

  const pageRes = await api(alice, `/ebooks/${target.id}/baca`);
  check("Reader page still renders (server gate is what blocks)", pageRes.status === 200, `status ${pageRes.status}`);

  // --- Return -------------------------------------------------------------
  const returnRes = await api(alice, "/api/ebooks/return", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ loanId: borrowBody.loan.id }),
  });
  const returnBody = await returnRes.json();
  check("Expired loan returns as EXPIRED", returnBody.accessState === "EXPIRED", returnBody.accessState);

  const afterReturn = await api(alice, `/api/ebooks/${target.id}/access`, { method: "POST" });
  check("Returned ebook is unreadable again", afterReturn.status === 403, `status ${afterReturn.status}`);

  const reborrow = await api(alice, "/api/ebooks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ bookId: target.id }),
  });
  check("Ebook can be borrowed again after returning", reborrow.status === 201, `status ${reborrow.status}`);

  // --- Physical books are unaffected -------------------------------------
  const booksRes = await fetch(`${BASE}/api/books?pageSize=50`);
  const booksBody = await booksRes.json();
  check(
    "Existing /api/books still lists titles",
    booksBody.books.length > 0,
    `${booksBody.books.length} books`
  );
  const physicalBooks = booksBody.books.filter((b) => b.format === "PHYSICAL");
  check(
    "Physical books keep their PHYSICAL format",
    physicalBooks.length > 0,
    `${physicalBooks.length} physical`
  );

  // The physical borrow picker searches with availability=available; stock-0
  // digital copies must never surface there.
  const availableRes = await fetch(
    `${BASE}/api/books?availability=available&pageSize=50`
  );
  const availableBody = await availableRes.json();
  check(
    "Physical borrow picker never offers ebooks",
    availableBody.books.every((b) => b.format !== "EBOOK"),
    `${availableBody.books.length} available`
  );

  // Even a direct API call cannot turn an ebook into a physical loan.
  const sneakyBorrow = await api(alice, "/api/borrows", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ bookId: target.id }),
  });
  const sneakyBody = await sneakyBorrow.json();
  check(
    "Physical borrow endpoint rejects an ebook",
    sneakyBorrow.status === 400 && /ebook/i.test(sneakyBody.error || ""),
    `status ${sneakyBorrow.status}: ${sneakyBody.error}`
  );

  // --- Quota --------------------------------------------------------------
  const borrows = [];
  for (const ebook of (await (await api(bob, "/api/ebooks")).json()).ebooks) {
    if (ebook.canBorrow) {
      borrows.push(
        await api(bob, "/api/ebooks", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ bookId: ebook.id }),
        })
      );
    }
  }
  const quotaCatalog = await (await api(bob, "/api/ebooks")).json();
  check(
    "Bob hit the 3-ebook quota",
    quotaCatalog.summary.activeLoanCount === 3,
    `${quotaCatalog.summary.activeLoanCount} active`
  );
  check(
    "Quota blocks any further borrowing in the UI",
    quotaCatalog.ebooks.every((e) => e.canBorrow === false),
    quotaCatalog.ebooks.map((e) => `${e.accessState}:${e.canBorrow}`).join(", ")
  );

  await fs.promises.access("storage/ebooks").then(
    () => check("Ebook storage folder is present", true, "storage/ebooks"),
    () => check("Ebook storage folder is present", false, "missing")
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:", failed.map((f) => f.name).join(", "));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });