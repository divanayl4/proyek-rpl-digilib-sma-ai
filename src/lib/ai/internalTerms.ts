/**
 * Pencegahan kebocoran istilah internal ke jawaban pengguna.
 *
 * Model sesekali menyebut nama fungsi/tool internal (mis. `get_my_history`),
 * menyuruh pengguna "memanggil fungsi", atau menyebut istilah implementasi
 * (intent, pipeline, endpoint, tool). Semua itu adalah detail implementasi yang
 * TIDAK boleh muncul pada jawaban akhir.
 *
 * Modul ini murni (tanpa akses jaringan/database) sehingga dapat diuji, dan
 * menjadi lapisan pertahanan terakhir setelah jawaban model: kalimat yang
 * memuat istilah internal dibuang, dan bila jawaban tinggal terlalu sedikit,
 * diganti dengan pesan aman.
 */

/** Nama seluruh tool/fungsi internal yang dikenali sistem. */
export const INTERNAL_TOOL_NAMES: string[] = [
  "search_books",
  "list_available_books",
  "book_summary",
  "catalog_stats",
  "get_my_loans",
  "get_my_history",
  "get_my_fines",
  "get_my_notifications",
  "get_my_profile",
  "get_all_borrows",
  "get_overdue_borrows",
  "get_fines_overview",
  "get_all_ebook_loans",
  "get_borrows_by_date",
  "get_user_count",
  "get_user_stats",
  "get_system_settings",
  "get_user_audit_history",
];

/**
 * Pola yang menandai istilah internal:
 * - nama tool yang eksplisit;
 * - pola umum fungsi internal bergaya `snake_case` diawali `get_`/`search_`;
 * - frasa yang menunjukkan pemanggilan fungsi/tool atau istilah teknis.
 */
const INTERNAL_TERM_PATTERNS: RegExp[] = [
  // Nama tool eksplisit (word-boundary, case-insensitive).
  ...INTERNAL_TOOL_NAMES.map(
    (name) => new RegExp(`(?<![\\w])${name}(?![\\w])`, "i")
  ),
  // Pola umum: get_sesuatu / search_sesuatu / list_sesuatu / book_summary dsb.
  /\b(?:get|search|list|fetch|find|load)_[a-z][a-z0-9_]*\b/i,
  /\b[bB]ook_summary\b/,
  // Frasa pemanggilan fungsi/tool.
  /\b(?:memanggil|panggil|panggilkan|memakai|pakai|menggunakan|gunakan|gunakanlah|menjalankan|jalankan)\s+(?:fungsi|function|tool|api)\b/i,
  /\bfungsi\s+(?:internal|khusus|backend|bawaan|sistem)\b/i,
  // Nama fungsi bergaya identifier (mis. "fungsi get_my_history", "function getX").
  /\b(?:fungsi|function)\s+[a-z]+_[a-z0-9_]+\b/i,
  /\b(?:tool|tools)\s+(?:internal|ai|khusus)\b/i,
  /\b(?:internal|khusus)\s+(?:tool|function|fungsi)\b/i,
  // Istilah implementasi internal.
  /\bintent\s+[a-z_]+\b/i,
  /\bpipeline\b/i,
  /\bendpoint\s+(?:api|internal|aplikasi)?\b/i,
  /\b(?:system\s+prompt|prompt\s+sistem)\b/i,
];

/** True bila teks memuat istilah internal yang tidak boleh ditampilkan. */
export function containsInternalTermLeak(text: string): boolean {
  if (!text) return false;
  return INTERNAL_TERM_PATTERNS.some((pattern) => pattern.test(text));
}

/** Pecah satu baris menjadi kalimat tanpa merusak angka seperti "Rp15.000". */
function splitSentences(text: string): string[] {
  const result: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    current += ch;
    if (ch === "." || ch === "!" || ch === "?") {
      const next = text[i + 1];
      // Akhiri kalimat hanya bila diikuti spasi/akhir baris (bukan desimal).
      if (next === undefined || next === " ") {
        result.push(current.trim());
        current = "";
      }
    }
  }
  if (current.trim().length > 0) result.push(current.trim());
  return result;
}

/**
 * Buang kalimat/segmen yang memuat istilah internal, sisakan yang aman.
 * Baris yang seluruhnya kosong dipertahankan agar struktur tetap enak dibaca.
 */
export function stripInternalTerms(text: string): string {
  const lines = text.split("\n");
  const keptLines: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) {
      keptLines.push("");
      continue;
    }
    const kept = splitSentences(line).filter(
      (sentence) => sentence.length > 0 && !containsInternalTermLeak(sentence)
    );
    if (kept.length > 0) keptLines.push(kept.join(" "));
  }

  return keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Pesan aman bila setelah penyaringan jawaban tidak menyisakan isi bermakna.
 * Tidak memuat istilah internal apa pun dan mengarahkan ke fitur yang tersedia.
 */
export const INTERNAL_TERM_REFUSAL =
  "Maaf, saya tidak dapat menampilkan detail teknis internal aplikasi. " +
  "Silakan ajukan pertanyaan lain seputar layanan perpustakaan DigiLib.";

/** Panjang isi bermakna (tanpa spasi) yang dianggap jawaban masih layak. */
const MIN_MEANINGFUL_LENGTH = 25;

/**
 * Bersihkan jawaban model dari istilah internal. Mengembalikan pesan aman bila
 * tidak ada lagi isi yang layak setelah penyaringan.
 */
export function sanitizeInternalTerms(answer: string): string {
  if (!containsInternalTermLeak(answer)) return answer;
  const cleaned = stripInternalTerms(answer);
  if (cleaned.replace(/\s+/g, "").length < MIN_MEANINGFUL_LENGTH) {
    return INTERNAL_TERM_REFUSAL;
  }
  return cleaned;
}
