import { normalizeQuery } from "@/lib/ai/intent";
test("args", () => {
  const q = "Siapa saja pengguna?";
  const nq = normalizeQuery(q);
  console.log("normalized:", nq);
  // replicate extractUserLookupTerm
  const raw = q.trim();
  const tokens = normalizeQuery(raw).split(/\s+/).filter(t => t.length >= 3 && !/^\d{1,3}$/.test(t));
  console.log("tokens:", tokens);
});
