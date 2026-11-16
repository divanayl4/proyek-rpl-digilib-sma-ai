import { detectIntent, normalizeQuery } from "../src/lib/ai/intent";
import { executeTool } from "../src/lib/ai/tools";

const ADMIN = "5a7af1f3-0d69-4a81-951a-f7982e1e3d1a";
const LIB = "acb57ba5-a215-45a4-9892-f5c4f3977ed5";
const STUDENT = "8927e4eb-db71-44f2-999d-ac1f17d96f39";

const queries = [
  "Siapa yang sedang meminjam?",
  "siapa aja yang minjem sekarang",
  "Siapa yang mempunyai denda?",
  "kategori apa aja yang ada?",
  "buku yang lagi gue pinjem apa aja",
  "Berapa jumlahnya?",
  "Sekarang buku apa saja?",
  "Kalau kategori sejarah?",
  "Apakah buku Bumi Manusia tersedia?",
  "Berapa jumlah buku?",
];

async function main() {
  for (const q of queries) {
    console.log(
      JSON.stringify({
        q,
        normalized: normalizeQuery(q),
        intent: detectIntent(q, false),
      })
    );
  }

  console.log("\n--- TOOLS ---");
  const tools = [
    ["get_active_loans", { format: "PHYSICAL" }, LIB],
    ["get_fines_overview", {}, LIB],
    ["get_user_count", {}, ADMIN],
    ["catalog_stats", {}, ADMIN],
  ] as const;
  for (const [name, args, uid] of tools) {
    const raw = await executeTool(name, args as any, uid, name === "get_fines_overview" ? "LIBRARIAN" : "ADMIN");
    console.log(`\n[${name}] ${raw.slice(0, 1500)}`);
  }

  console.log("\n--- personal loans (student) ---");
  const personal = await executeTool("get_my_loans", { format: "ALL" }, STUDENT, "STUDENT");
  console.log(personal.slice(0, 1500));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
