import { extractPartialDay, resolveJakartaDateRange, resolveJakartaPeriod } from "./datetime";
import { EBOOK_FORMAT_QUERY, PHYSICAL_FORMAT_QUERY } from "./catalogFormat";
import { AIChatMessage } from "./types";

export type Intent =
  | "CHITCHAT"
  | "LEARNING"
  | "CATALOG"
  | "BOOK_PHYSICAL"
  | "EBOOK_CATALOG"
  | "BOOK_SUMMARY"
  | "STATS"
  | "MY_LOANS"
  | "MY_HISTORY"
  | "MY_FINES"
  | "FINE_RATE"
  | "MY_PROFILE"
  | "MY_CAPABILITIES"
  | "ADMIN_CAPABILITIES"
  | "CLARIFY"
  | "PASSWORD"
  | "LIBRARY_GUIDE"
  | "CODING"
  | "OUT_OF_SCOPE"
  | "OPERATIONAL"
  | "USER_COUNT"
  | "USER_DIRECTORY"
  | "USER_AUDIT"
  | "SYSTEM_SETTINGS"
  | "MUTATION";

/** Peran yang sah untuk riwayat percakapan yang dikirim klien. */
const ALLOWED_HISTORY_ROLES = new Set(["user", "assistant"]);

/** Berapa banyak pesan terakhir yang dikirim ke provider sebagai konteks. */
export const MAX_HISTORY_MESSAGES = 12;

/** Batas panjang satu pesan pengguna. */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * Normalisasi teks bahasa Indonesia untuk pemahaman bahasa alami (NLU):
 * - Menangani singkatan umum (yg, aja, gak/ga/nggak, gimana, bgt, klo/kalo, sy).
 * - Menangani variasi istilah ebook (e-book, buku digital, buku elektronik, bacaan digital).
 * - Menangani istilah peminjaman & pengembalian (balikin, pinjem, kupinjam, pinjamanku, dendaku).
 * Catatan: Normalisasi ini murni untuk pemahaman maksud pertanyaan dan tidak mengubah data database.
 */
export function normalizeQuery(query: string): string {
  let q = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\be\s*-?\s*books?\b|\bebooks?\b/g, "ebook")
    .replace(/\bbuku\s+digital(?:nya)?\b/g, "ebook")
    .replace(/\bbuku\s+elektronik(?:nya)?\b/g, "ebook")
    .replace(/\bbacaan\s+digital\b/g, "ebook");

  q = q.replace(/-/g, " ");

  q = ` ${q.replace(/\s+/g, " ").trim()} `
    .replace(/\byg\b/g, "yang")
    .replace(/\baja\b/g, "saja")
    .replace(/\b(?:gak|ga|nggak|g)\b/g, "tidak")
    .replace(/\bgimana\b/g, "bagaimana")
    .replace(/\bbgt\b/g, "banget")
    .replace(/\b(?:klo|kalo)\b/g, "kalau")
    .replace(/\bsy\b/g, "saya")
    // Kata ganti orang pertama ragam percakapan. Tanpa normalisasi ini,
    // "buku yang lagi gue pinjam" dianggap pihak ketiga (nama) dan salah
    // diarahkan ke klarifikasi, bukan ke data pinjaman pengguna sendiri.
    .replace(/\b(?:gue|gw|gua|ane|akoe)\b/g, "saya")
    .replace(/\b(?:sdg|lg)\b/g, "lagi")
    .replace(/\b(?:blm|lom)\b/g, "belum")
    .replace(/\bsdh\b/g, "sudah")
    .replace(/\bdgn\b/g, "dengan")
    .replace(/\butk\b/g, "untuk")
    .replace(/\bpd\b/g, "pada")
    .replace(/\bdr\b/g, "dari")
    .replace(/\bhrs\b/g, "harus")
    .replace(/\b(?:skrg|skr)\b/g, "sekarang")
    .replace(/\b(?:balikin|balikan)\b/g, "kembalikan")
    .replace(/\b(?:pinjem|minjem)\b/g, "pinjam")
    .replace(/\bpinjeman\b/g, "pinjaman")
    .replace(/\bpinjamanku\b/g, "pinjaman saya")
    .replace(/\bkupinjam\b/g, "saya pinjam")
    .replace(/\bdendaku\b/g, "denda saya")
    .replace(/\bdendanya\b/g, "denda")
    .replace(/\bakunku\b/g, "akun saya")
    .replace(/\bprofilku\b/g, "profil saya")
    .replace(/\b(?:tunjukin|tampilin|liatin|liat)\b/g, "tampilkan")
    .replace(/\b(?:brp|brapa)\b/g, "berapa")
    .replace(/\bperpus\b/g, "perpustakaan")
    .replace(/\bgmn\b/g, "bagaimana");

  return q.replace(/\s+/g, " ").trim();
}

const GREETING = /\b(hai|haii|halo|halo2|hei|hi|hey|selamat\s+(pagi|siang|sore|malam|datang)|apa\s+kabar|gimana\s+kabar|how\s+are\s+you)\b/;

const THANKS = /\b(terima\s*kasih|makasih|thanks|thank\s*you|thx|tengkyu)\b/;

const CAPABILITY = /\b(apa\s+(yang\s+)?bisa\s+(kamu|anda|lu)|kemampuan|kapabilitas|bisa\s+apa|apa\s+saja\s+(yang\s+)?bisa|siapa\s+kamu|kamu\s+siapa|who\s+are\s+you|fungsi\s+kamu)\b/;

const BOOK_SUMMARY = /\b(rangku?m|ringkas|ringkasan|summary|summari|detail|detailnya|rincian|rinciannya|informasi|info)\b/;

const BOOK_SUMMARY_OBJECT = /\b(buku|kitab|artikel|yang\s+saya\s+pilih|yang\s+saya\s+pinjam|buku\s+(ini|tadi|itu|tersebut)|book)\b/;

const STATS =
  /\b(berapa\s+(jumlah|banyak|total|koleksi|judul)|berapa\s+(buku|ebook)|(jumlah|total|hitung(\s+jumlah)?)\s+([a-z]+\s+)?(buku|koleksi|judul)|statistik|how\s+many)\b/;

const CATALOG =
  /\b(buku|katalog|koleksi|pinjam|peminjaman|loaned|loans|stok|tersedia|cari|carikan|rekomendasi|rekomendasikan|find|penulis|penerbit|isbn|judul|perpustakaan|borrowing|ebook)\b/;

/**
 * Penyebutan dimensi kurikulum (kelas/mapel/jurusan) yang mengindikasikan
 * pengguna sedang mencari koleksi, mis. "buku kelas XI" atau "yang untuk
 * jurusan TKJ ada?". Dipakai hanya bila tidak ada sinyal pembelajaran.
 */
const CATALOG_DIMENSION =
  /\b(kelas\s*(10|11|12|xii|xi|x)|tingkat\s*(10|11|12|xii|xi|x)|jurusan|konsentrasi|keahlian|mapel|mata\s+pelajaran)\b/;

const LEARNING =
  /\b(jelaskan|jelask|jelas|apa\s+itu|mengapa|kenapa|ringkas|contoh|contohnya|soal|latihan|quiz|langkah|penyelesaian|rumus|bandingkan|bedakan|sebutkan|simplify)\b/;

const FOLLOW_UP =
  /\b(lebih\s+sederhana|sederhanakan|terus\s+lanjut|lanjutkan|contoh\s+(yang\s+)?(lain|lainnya|kecil)|yang\s+tadi|materi\s+tadi|sebelumnya|lebih\s+detail|lebih\s+panjang|versi\s+(yang\s+)?sederhana)\b/;

/**
 * Pertanyaan DEFINISI/konsep murni ("apa itu buku digital?", "pengertian
 * katalog"). Ini pertanyaan edukatif, bukan permintaan data koleksi, sehingga
 * tidak boleh diarahkan ke pencarian database hanya karena menyebut "buku".
 */
const CONCEPTUAL_QUESTION =
  /\b(apa\s+itu|apa\s+yang\s+dimaksud|apa\s+yg\s+dimaksud|pengertian|definisi)\b/;

/**
 * Permintaan source code ditandai oleh objek kode yang eksplisit
 * ("source code", "kode program", "script") tanpa perlu kata kerja.
 */
const CODE_OBJECT =
  /\b(coding|source[\s_-]*code|sourcecode|code[\s_-]*block|blok\s+kode|kode\s+program|pseudocode|pseudo[\s_-]*code|script)\b/;

/**
 * Topik pemrograman yang tegas. Dipakai juga untuk menolak pertanyaan KONSEP
 * pemrograman (mis. "apa itu pemrograman?") yang berada di luar lingkup
 * DigiLib — bukan hanya permintaan membuat kode.
 */
const PROGRAMMING_TOPIC =
  /\b(pemrograman\w*|programming|coding|koding|ngoding|source[\s_-]*code|sourcecode|syntax|sintaks|pseudocode|pseudo[\s_-]*code|algoritm\w*|compiler|debugging?|regex|json|yaml|\bxml\b|docker|kubernetes|git(?:hub|lab)?|npm|pip\b|framework|rest[\s_-]*api|endpoint|repository|deploy|hosting|backend|frontend|python|javascript|typescript|java|php|sql|mysql|postgres\w*|mongodb|sqlite|html|css|golang|kotlin|swift|ruby|bash|shell|laravel|django|flask|spring|express(?:js)?|next\.?js|nuxt|react(?:js)?|node\.?js|vue|angular|svelte|jquery|bootstrap|tailwind|codeigniter|symfony|asp\.?net|visual\s+basic|vb\.?net|objective[\s_-]*c|csharp|c\+\+|\bc#\b|matlab|perl|lua|scala|dart|rust|kotlin)\b/;

/** Hasil karya program yang biasanya "dibuat" pengguna (project/aplikasi/web). */
const PROJECT_OBJECT =
  /\b(project|projek|aplikasi|\bapp\b|website|web\b|program|software|sistem\s+informasi)\b/;

/** Kata kerja yang menunjukkan permintaan menghasilkan sesuatu. */
const PRODUCE_VERB =
  /\b(buat|buatkan|buatin|membuat|membuatkan|bikin|bikinkan|tulis|tuliskan|tampilkan|perlihatkan|berikan|kasih|kirim|kirimkan|salin|copy|cari|carikan|generate|contoh|contohkan|unduh|download|write|create|make|show|give)\b/;

/**
 * Target yang dicari kata kerja di atas. Bahasa pemrograman dan artefak kode.
 */
const CODE_TARGET =
  /\b(kode|code|coding|program|source|regex|json|yaml|docker|git(?:hub|lab)?|python|javascript|typescript|java|php|sql|mysql|postgres\w*|mongodb|sqlite|html|css|golang|kotlin|swift|ruby|bash|shell|laravel|django|flask|spring|express(?:js)?|next\.?js|nuxt|react(?:js)?|node\.?js|vue|angular|svelte|jquery|bootstrap|tailwind|csharp|c\+\+|\bc#\b|matlab|perl|lua|scala|dart|rust|website)\b/;

/**
 * Pertanyaan konsep. Untuk topik pemrograman, pertanyaan konsep juga ditolak
 * karena konsep pemrograman berada di luar lingkup DigiLib.
 */
const CONCEPT_QUESTION =
  /\b(jelaskan|jelask|pengertian|definisi|arti|konsep|apa\s+itu|apakah|mengapa|kenapa|apa\s+bedanya|perbedaan|gimana\s+cara\s+kerja|bagaimana\s+cara\s+kerja)\b/;

/**
 * Kata yang menandai pencarian koleksi. Bila muncul, pengguna mencari buku
 * (mis. "cari buku pemrograman python"), bukan meminta kode.
 */
const CATALOG_OBJECT =
  /\b(buku|katalog|ebook|isbn|penulis|penerbit|perpustakaan|peminjaman|meminjam|pinjam|stok|koleksi|rekomendasi|rekomendasikan)\b/;

/**
 * Deteksi permintaan di luar lingkup DigiLib: membuat kode/program/project,
 * contoh kode, atau materi pemrograman.
 */
export function isCodingRequest(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;

  // Permintaan membuat kode / script / aplikasi perpustakaan harus tetap ditolak
  // meskipun menyebut kata "perpustakaan".
  const directCodeProduce =
    /\b(buat|buatkan|buatin|bikin|bikinkan|tulis|tuliskan|generate)\s+(?:kode|code|source[\s_-]*code|script|aplikasi|program|software|website|web)\b/.test(
      q
    ) ||
    /\b(bantu\s+(?:saya\s+)?membuat|buatkan\s+saya)\s+(?:website|aplikasi|program|software|project|projek)\b/.test(
      q
    );
  if (directCodeProduce) return true;

  if (CATALOG_OBJECT.test(q)) return false;

  const normalized = q
    .replace(/\bcari\s+tahu\b/g, " ")
    .replace(/\bprogram\s+linear\b/g, " ")
    .replace(/\bprogram\s+studi\b/g, " ");

  const produceVerb = PRODUCE_VERB.test(normalized);
  const conceptQuestion = CONCEPT_QUESTION.test(normalized);

  if (conceptQuestion && !produceVerb && PROGRAMMING_TOPIC.test(normalized)) {
    return true;
  }

  if (CODE_OBJECT.test(normalized)) return true;

  if (produceVerb) {
    return (
      CODE_TARGET.test(normalized) ||
      PROGRAMMING_TOPIC.test(normalized) ||
      PROJECT_OBJECT.test(normalized)
    );
  }

  return false;
}

/**
 * Permintaan yang jelas-jelas di luar lingkup DigiLib dan/atau berbahaya:
 * peretasan, malware, konten dewasa, perjudian, narkoba, senjata, dsb.
 */
const CLEARLY_OUT_OF_SCOPE =
  /\b(hack(?:ing|er)?|retas|menyusup|sistem\s+orang|crack\w*|malware|ransomware|phishing|exploit|ddos|keylogger|bom\b|bahan\s+peledak|senjata|narkoba|ganja|sabu|judi|gambling|togel|slot\s+online|pornografi|porno|bugil|telanjang|santet|pelet)\b/;

export function isClearlyOutOfScope(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (CATALOG_OBJECT.test(q)) return false;
  return CLEARLY_OUT_OF_SCOPE.test(q);
}

/**
 * Jabatan publik yang informasinya berubah seiring waktu (pengetahuan umum
 * terkini), BUKAN materi pelajaran atau data perpustakaan.
 */
const CURRENT_OFFICE_HOLDER =
  /\b(presiden|wakil\s+presiden|perdana\s+menteri|gubernur|wakil\s+gubernur|wali\s*kota|walkot|bupati|menteri|paus|raja|sultan|ketua\s+umum)\b/;

/** Penanda "keadaan sekarang" yang membuat pertanyaan menjadi current affairs. */
const CURRENT_TIME_REFERENCE =
  /\b(sekarang|saat\s+ini|kini|tahun\s+ini|terkini|yang\s+menjabat)\b/;

/**
 * Pertanyaan tentang pejabat publik yang MENJABAT SAAT INI ("siapa presiden
 * Indonesia sekarang?") adalah pengetahuan umum di luar lingkup DigiLib.
 *
 * Sengaja sempit:
 * - wajib ada jabatan publik + penanda waktu sekarang;
 * - pertanyaan sejarah ("siapa presiden pertama Indonesia?") dan pertanyaan
 *   konseptual ("apa tugas presiden?") TIDAK ikut ditolak;
 * - pertanyaan katalog yang kebetulan menyebut nama tokoh juga tidak ditolak.
 *
 * Tidak ada jawaban yang di-hardcode: pertanyaan hanya ditolak sebagai di luar
 * cakupan, sehingga chatbot tidak perlu mengandalkan ingatan model untuk fakta
 * yang tidak berasal dari database maupun sistem.
 */
export function isCurrentAffairsQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (CATALOG_OBJECT.test(q)) return false;
  if (!CURRENT_OFFICE_HOLDER.test(q)) return false;
  if (!CURRENT_TIME_REFERENCE.test(q)) return false;
  return /\b(siapa|siapakah|apa|apakah|sebutkan)\b/.test(q);
}

/**
 * Permintaan tugas sekolah, PR, makalah, esai, atau pengerjaan soal langsung.
 * AI DigiLib dilarang mengambil alih pekerjaan akademik pengguna.
 */
const ACADEMIC_TASK =
  /\b(kerjakan\s+(?:soal|pr|tugas)|mengerjakan\s+(?:soal|pr|tugas)|buatkan\s+(?:makalah|esai|essay|laporan(?:\s+tugas)?|slide(?:\s+tugas)?|presentasi(?:\s+tugas)?)|jawab\s+semua\s+soal|kerjakan\s+proyek\s+saya|tolong\s+kerjakan\s+(?:tugas|pr|soal|proyek))\b/;

export function isAcademicTaskRequest(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Jangan menolak bila pengguna hanya mencari buku untuk referensi tugas/belajar
  if (
    CATALOG_OBJECT.test(q) &&
    !/\b(kerjakan\s+soal|buatkan\s+makalah|buatkan\s+esai|buatkan\s+slide|jawab\s+semua\s+soal)\b/.test(q)
  ) {
    return false;
  }
  return ACADEMIC_TASK.test(q);
}

/**
 * Deteksi pertanyaan password akun, kata sandi, hash, token, secret, API key,
 * kredensial database, atau environment variable. Wajib ditolak secara
 * deterministik untuk SEMUA role demi keamanan.
 *
 * Pola sengaja mencakup variasi penulisan (passwordHash, password_hash,
 * passwd, pwd), istilah teknis (bcrypt, JWT, bearer, DATABASE_URL, .env), dan
 * sinonim umum agar tidak bisa diakali dengan ejaan lain.
 */
const PASSWORD_QUERY =
  /\b(password\s*hash|passwordhash|password_hash|password|passwd|pwd|kata\s*sandi|sandi|passcode|pin\s+akun|hash(?:nya|\s+password)?|bcrypt|salt|token(?:\s+akses|\s+sesi|\s+auth|\s+bearer)?|bearer|jwt|session\s+token|api[\s_-]*key|apikey|secret(?:\s+key)?|client[\s_-]*secret|kredensial|credential|database[\s_-]*url|db[\s_-]*url|connection[\s_-]*string|environment\s+variable|variabel\s+lingkungan|\.env|env\s+file|\benv\b|nextauth[\s_-]*secret|encryption\s+key|private\s+key)\b/;

export function isPasswordRequest(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return PASSWORD_QUERY.test(q);
}

/**
 * Pertanyaan tentang tugas/kewenangan/kemampuan ADMIN (bukan tugas pengguna
 * sendiri). Contoh: "Apa tugas admin?", "Admin bisa mengakses apa saja?",
 * "Apa saja fitur khusus admin?", "Bagaimana cara admin mengelola akun?".
 * 
 * Bisa ditanyakan oleh siapa pun, tapi hanya ADMIN yang boleh mendapat jawaban
 * detail. Non-admin mendapat penolakan standar.
 */
const ADMIN_CAPABILITY_NOUN =
  /\b(tugas|kewajiban|tanggung\s+jawab|peran|role|hak\s+akses|akses|wewenang|kewenangan|kemampuan|kapabilitas|fitur|tool|fungsi|menu|panel|dashboard|data|pengaturan|konfigurasi|hak|izin|kebijakan|prosedur|alur|proses|manajemen|kelola|kelolaan|mengelola|melihat|mengakses|membuka|menampilkan|mencari|mencatat|membuat|menghapus|mengubah|reset|blokir|aktifkan|nonaktifkan|setujui|tolak|lakukan|melakukan|bisa|dapat|boleh|mampu)\b/;

const ADMIN_REFERENCE =
  /\b(admin|administrator|pengelola|administrator\s+sistem|pengurus)\b/;

export function isAdminCapabilityQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Hapus klaim peran diri sendiri ("saya admin", "saya pustakawan") agar tidak
  // mengecoh deteksi subjek pertanyaan.
  const stripped = q.replace(
    /\b(?:saya|aku|kami)\s+(?:adalah\s+)?(?:admin|administrator(?:\s+sistem)?|pustakawan|petugas|guru|siswa|staf)\b/gi,
    " "
  );
  if (!ADMIN_REFERENCE.test(stripped)) return false;
  // Jika pertanyaan spesifik menanyakan tugas/peran role lain (pustakawan, guru, siswa, staf),
  // maka bukan pertanyaan tentang kemampuan admin.
  if (
    /\b(?:tugas|peran|wewenang|kewajiban|hak\s+akses)\s+(?:pustakawan|petugas|guru|siswa|staf|tata\s+usaha)\b/.test(
      stripped
    )
  ) {
    return false;
  }
  if (!ADMIN_CAPABILITY_NOUN.test(stripped)) return false;
  // "Apa yang bisa admin lakukan?", "Apa tugas admin?", "Admin bisa apa saja?"
  // "Bagaimana cara admin...", "Data apa yang...", "Tool apa..."
  return /\b(apa|apakah|berapa|bisa|dapat|boleh|mampu|melakukan|melihat|mengakses|mengelola|melihat|membuka|menampilkan|data|tool|fungsi|menu|bagaimana|caranya|prosedur|cara)\b/.test(
    stripped
  );
}

/**
 * Pertanyaan MUTASI data melalui percakapan (ubah role, hapus/tambah akun,
 * ubah password, ubah koleksi/transaksi). Chat hanya boleh membaca data;
 * permintaan seperti ini ditolak deterministik di backend.
 *
 * Pertanyaan tata cara ("bagaimana cara menambah buku") bukan permintaan
 * mutasi dan tetap dijawab sebagai panduan.
 */
const MUTATION_VERB =
  /\b(ubah|mengubah|ganti|mengganti|rubah|merubah|jadikan|menjadikan|naikkan|menaikkan|turunkan|menurunkan|hapus|menghapus|hapuskan|tambah|menambah|tambahkan|buatkan|bikin|bikinkan|nonaktifkan|menonaktifkan|aktifkan|mengaktifkan|blokir|memblokir|reset|setujui|menyetujui|tolak|menolak)\b/;

const MUTATION_TARGET =
  /\b(role|peran|hak\s+akses|akun|user|pengguna|password|kata\s+sandi|data|buku|ebook|stok|katalog|koleksi|denda|tagihan|peminjaman|pinjaman|transaksi|pengajuan|anggota|profil)\b/;

const MUTATION_HOWTO =
  /\b(cara|bagaimana|gimana|prosedur|panduan|langkah|syarat|tutorial)\b/;

/** Penanda pertanyaan/riwayat, bukan perintah untuk mengubah data. */
const MUTATION_AUDIT_QUESTION =
  /\b(siapa|kapan|pernah|riwayat|audit|log\s+aktivitas|jejak|apa\s+saja)\b/;

export function isMutationRequest(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Panduan tidak dimaksudkan sebagai perintah mutasi.
  if (MUTATION_HOWTO.test(q)) return false;
  // Permintaan coding dan topik berbahaya punya jalur penolakan sendiri.
  if (isCodingRequest(query) || isClearlyOutOfScope(query)) return false;
  if (!MUTATION_VERB.test(q)) return false;
  if (!MUTATION_TARGET.test(q)) return false;
  // Pertanyaan audit ("siapa yang menghapus akun ...") hanya membaca riwayat,
  // bukan perintah menghapus. Perintah imperatif seperti "Hapus akun Budi"
  // tidak memiliki penanda pertanyaan ini dan tetap ditolak sebagai mutasi.
  if (isUserAuditQuery(query) && MUTATION_AUDIT_QUESTION.test(q)) return false;
  return true;
}

/**
 * Deteksi pertanyaan profil diri pengguna yang sedang login ("siapa saya?", "siapa aku?").
 */
const MY_PROFILE_QUERY =
  /\b(siapa\s+(?:saya|aku)|profil\s+(?:saya|aku)|akun\s+(?:saya|aku)|identitas\s+(?:saya|aku)|data\s+diri\s+(?:saya|aku)|siapa\s+nama\s+(?:saya|aku))\b/;

export function isMyProfileRequest(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return MY_PROFILE_QUERY.test(q);
}

/**
 * Nomina tentang tugas/kewenangan yang menandai pertanyaan kemampuan pengguna
 * SENDIRI (bukan pertanyaan tentang kemampuan bot).
 */
const ROLE_CAPABILITY_NOUN =
  /\b(tugas(?:nya)?|kewajiban(?:nya)?|tanggung\s+jawab|peran|role|hak\s+akses|akses|wewenang|kewenangan|kemampuan|kapabilitas|fitur|lakukan)\b/;

/** Rujukan diri: pertanyaan tentang kemampuan PENGGUNA, bukan bot. */
const ROLE_SELF_REFERENCE = /\b(saya|aku|ku)\b/;

/** Rujukan ke asisten/bot: "apa yang bisa kamu bantu?" bukan pertanyaan role. */
const ROLE_ASSISTANT_REFERENCE = /\b(kamu|anda|lu|bot|asisten)\b/;

/**
 * Konteks pencarian/tugas akademik. Bila muncul, kata "tugas/kemampuan" tidak
 * merujuk pada hak akses pengguna (mis. "cari buku", "tugas sekolah").
 */
const ROLE_CAPABILITY_EXCLUDE =
  /\b(cari|carikan|rekomendasi|rekomendasikan|temukan|buku|ebook|katalog|koleksi|novel|materi|pelajaran|mapel|sekolah|pr|soal|makalah|esai|presentasi|penulis|pengarang|karya)\b/;

/**
 * Pertanyaan tentang tugas/kewajiban/peran/hak akses pengguna SENDIRI, mis.
 * "Apa tugas saya?", "Apa kewajiban saya?", "Apa peran saya?", "Saya bisa apa
 * saja?", "Apa hak akses saya?".
 *
 * Dijawab deterministik dari matriks izin role (lihat pipeline + access.ts) agar
 * tidak dijawab model dengan daftar tugas generik yang tidak sesuai DigiLib.
 * Sengaja hanya menangkap pertanyaan tentang PENGGUNA (butuh rujukan diri dan
 * pertanyaan apa/bisa), bukan pertanyaan tentang kemampuan bot dan bukan
 * pencarian katalog/tugas sekolah.
 */
export function isMyRoleCapabilityQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (ROLE_ASSISTANT_REFERENCE.test(q) && !ROLE_SELF_REFERENCE.test(q)) return false;
  if (ROLE_CAPABILITY_EXCLUDE.test(q)) return false;
  if (!ROLE_SELF_REFERENCE.test(q)) return false;
  // "Saya bisa apa saja?" / "Apa yang bisa saya lakukan?".
  if (/\b(?:bisa|dapat|boleh|mampu)\b/.test(q) && /\bapa\b/.test(q)) return true;
  // "Apa tugas/kewajiban/peran/hak akses/wewenang saya?" dan sejenisnya.
  if (!ROLE_CAPABILITY_NOUN.test(q)) return false;
  return /\b(apa|apakah|berapa)\b/.test(q) || /\b(bisa|dapat|boleh|mampu)\b/.test(q);
}

/**
 * Deteksi pertanyaan panduan penggunaan sistem perpustakaan DigiLib
 * (cara meminjam, cara mengembalikan, cara membaca ebook, aturan denda).
 */
const LIBRARY_GUIDE =
  /\b(?:bagaimana\s+cara|gimana\s+cara|cara|aturan|prosedur|ketentuan|tata\s+cara|syarat)\s+(?:meminjam|pinjam|mengembalikan|kembalikan|baca\s+ebook|membaca\s+ebook|denda|(?:mem)?bayar\s+denda|pembayaran\s+denda|melunasi\s+denda|perpanjang\s+pinjaman|perpanjangan)\b/;

export function isLibraryGuideRequest(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return LIBRARY_GUIDE.test(q);
}

/**
 * Penanda orang pertama. Pertanyaan data pribadi (peminjaman/denda milik
 * sendiri) hampir selalu memakai kata ini.
 */
const FIRST_PERSON = /\b(saya|aku|ku|punyaku)\b/;

/** Permintaan data milik pengguna lain — harus ditolak, bukan dijawab. */
const OTHER_PERSON =
  /\b(orang\s+lain|user\s+lain|akun\s+lain|siswa\s+lain|murid\s+lain|teman|punya\s+(?:orang|dia|mereka)|milik\s+(?:orang|dia|mereka)|namanya\s+\w+)\b/;

/**
 * Bentuk eksplisit "pinjaman milik/dari/punya/atas nama <nama>" — jelas meminta
 * data orang lain. Pola ini case-insensitive karena diuji pada teks ternormalisasi
 * (huruf kecil), sehingga "Peminjaman atas nama budi" tetap terdeteksi.
 */
const OTHER_PERSON_TRANSACTION =
  /\b(?:peminjaman|pinjaman|transaksi|riwayat|denda)(?:\s+buku)?\s+(?:milik|dari|punya|atas\s+nama)\s+\w+/;

/**
 * Konteks pengguna yang meminta data ORANG LAIN yang disebut NAMANYA pada
 * konteks transaksi/riwayat/denda, tanpa kata "milik/dari/punya"
 * (mis. "Tampilkan riwayat peminjaman Budi.", "Buku apa yang dipinjam Budi?",
 * "Denda Budi berapa?").
 *
 * Deteksi sengaja KETAT dan konservatif agar tidak menolak pencarian katalog:
 * - Hanya berlaku pada konteks transaksi/riwayat/denda atau kata "buku".
 * - Dikecualikan bila kalimatnya jelas pencarian katalog/atribusi karya
 *   ("cari", "karya", "penulis", "judul", ...), sehingga "Buku karya Budi
 *   Santoso" tetap dapat diproses sebagai pencarian katalog.
 * - Nama orang dideteksi dari token berhuruf BESAR pada teks ASLI (bukan satu
 *   token sembarang) yang bukan kata umum/benda transaksi, dan yang TIDAK
 *   didahului penanda buku ("buku", "ebook", "novel", "judul", ...). Judul buku
 *   yang mengandung nama orang karena itu tidak otomatis ditolak.
 *
 * Tujuannya mencegah AI menjawab pertanyaan tentang orang lain memakai riwayat
 * penanya sendiri, katalog, atau pengetahuan umum.
 *
 * Batasan yang diketahui: nama yang ditulis serba huruf kecil tanpa kata
 * "milik/dari/punya" (mis. "riwayat peminjaman budi") tidak terdeteksi — sengaja
 * dibiarkan agar subjek/judul seperti "riwayat peminjaman fisika" tidak salah
 * ditolak. Permintaan dengan kata "milik/dari/punya" tetap ditangani
 * `OTHER_PERSON_TRANSACTION`.
 */
const NAMED_THIRD_PARTY_DATA_NOUN =
  /\b(riwayat|peminjaman|pinjaman|transaksi|denda|tagihan)\b/;

/**
 * Konteks pencarian koleksi/atribusi karya — nama merujuk buku/penulis/mapel,
 * BUKAN orang. Termasuk penanda topik ("tentang", "mengenai") dan dimensi
 * katalog sekolah ("jurusan", "kelas", "mapel", "pelajaran", "materi") sehingga
 * "Buku tentang Budi Pekerti" dan "Buku jurusan Akuntansi" tetap katalog.
 */
const CATALOG_OR_AUTHORSHIP_CONTEXT =
  /\b(cari|carikan|rekomendasi|rekomendasikan|temukan|karya|karangan|penulis|pengarang|katalog|isbn|penerbit|judul|tersedia|koleksi|tentang|mengenai|jurusan|kelas|mapel|pelajaran|materi|bidang|ilmu|mata\s+pelajaran)\b/;

/** Kata umum yang tidak pernah menjadi nama orang pada konteks transaksi. */
const NAMED_THIRD_PARTY_STOPWORDS = new Set([
  "saya", "aku", "kamu", "anda", "dia", "mereka", "kita", "kami",
  "tampilkan", "tunjukkan", "lihat", "daftar", "semua", "seluruh", "yang",
  "apa", "apakah", "berapa", "kapan", "siapa", "mana", "saja", "dan", "atau",
  "untuk", "dari", "pada", "dengan", "di", "ke", "oleh", "punya", "milik",
  "riwayat", "peminjaman", "pinjaman", "transaksi", "denda", "tagihan",
  "tunggakan", "tunggakannya", "sisa", "sisanya",
  "buku", "ebook", "katalog", "koleksi", "novel", "komik", "majalah", "kitab",
  "perpustakaan", "digilib", "kelas", "jurusan", "mapel", "siswa", "murid",
  "guru", "staf", "staff", "pustakawan", "admin", "administrator", "anggota",
  "member", "pengguna", "user", "akun", "profil", "notifikasi",
  "januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus",
  "september", "oktober", "november", "desember",
  "kemarin", "besok", "hari", "tanggal", "bulan", "tahun", "minggu",
  // Kata kerja/keadaan transaksi & fungsi umum — bukan nama orang.
  "pinjam", "meminjam", "dipinjam", "meminjamkan", "dipinjamkan", "pinjamkan",
  "peminjam", "mengembalikan", "dikembalikan", "kembalikan", "kembali",
  "baca", "membaca", "dibaca", "bacaan", "meminjam", "bayar", "dibayar",
  "lunas", "terlambat", "telat", "overdue", "jatuh", "tempo", "tenggat",
  "aktif", "masa", "akses", "sedang", "lagi", "belum", "sudah", "telah",
  "harus", "bisa", "boleh", "akan", "ada", "tidak", "bukan", "juga", "paling",
  "dekat", "cepat", "dulu", "baru", "lama", "berapa", "bagaimana", "cara",
  "jelaskan", "sebutkan", "carikan", "temukan", "mengenai", "tentang", "atas",
  "nama", "punyaku", "bukunya", "dendanya", "punyanya",
  "menyebabkan", "menyebab", "penyebab", "akibat", "karena", "hrs", "jam",
  "balikin", "kemarin", "terakhir", "pernah", "sering", "banyak", "jumlah",
  "total", "keseluruhan", "global", "laporan", "statistik", "rekap", "ringkasan",
  "angka", "count", "data",
  // Kata kerja kepemilikan/keadaan yang lazim pada pertanyaan denda. Kata ini
  // BUKAN nama orang, sehingga "Siapa yang mempunyai denda?" tidak boleh
  // dianggap permintaan data pihak ketiga yang ambigu.
  "mempunyai", "memiliki", "terkena", "kena", "mendapat", "dikenai", "tercatat",
]);

/**
 * Nama mata pelajaran / jurusan / bidang yang sering muncul berhuruf kapital
 * pada pertanyaan katalog ("Riwayat peminjaman Fisika", "Buku jurusan
 * Akuntansi"). Token seperti ini BUKAN nama orang. Daftar ini hanya pelengkap —
 * bukan satu-satunya mekanisme — karena pola kapitalisasi satu token memang
 * ambigu. Lihat `isAmbiguousThirdPartyQuery` untuk penanganan klarifikasi.
 */
const SCHOOL_SUBJECT_OR_MAJOR = new Set([
  "fisika", "kimia", "biologi", "matematika", "mtk", "ipa", "ips", "sejarah",
  "geografi", "ekonomi", "sosiologi", "antropologi", "akuntansi", "kewirausahaan",
  "wirausaha", "pemasaran", "bisnis", "manajemen", "perkantoran", "otomatisasi",
  "perhotelan", "perbankan", "keuangan", "lembaga", "perpajakan", "bahasa",
  "indonesia", "inggris", "jepang", "mandarin", "arab", "jerman", "prancis",
  "seni", "budaya", "olahraga", "penjaskes", "pjok", "informatika", "tik",
  "komputer", "jaringan", "pemrograman", "rpl", "tkj", "mm", "dkv", "animasi",
  "desain", "teknik", "mesin", "otomotif", "elektronika", "listrik", "bangunan",
  "sipil", "boga", "busana", "kecantikan", "pertanian", "agribisnis", "peternakan",
  "agama", "pai", "ppkn", "pkn", "pancasila", "kewarganegaraan", "literasi",
  "numerasi", "sastra",
  // Nama kategori buku yang bukan nama orang
  "astronomi", "fisika", "biologi", "kimia", "sejarah", "geografi",
  "psikologi", "filsafat", "teknologi", "kesehatan", "kedokteran",
  "hukum", "politik", "komunikasi", "pendidikan", "pariwisata",
  "kuliner", "olahraga", "musik", "fotografi", "arsitektur", "pertanian",
  "lingkungan", "energi", "transportasi", "logistik",
  // Genre fiksi/nonfiksi
  "fiksi", "nonfiksi", "fantasi", "komedi", "horror", "thriller", "misteri",
  "romansa", "biografi", "ensiklopedi", "referensi", "motivasi", "pengembangan",
]);

/** Penanda buku yang mendahului sebuah nama → nama itu merujuk judul buku. */
const BOOK_MARKER_WORDS = new Set([
  "buku", "ebook", "novel", "komik", "majalah", "judul", "kitab", "artikel",
  // "kategori" sebelum nama berarti nama itu adalah nama kategori, bukan orang.
  "kategori", "category",
]);

/**
 * True bila permintaan menyebut NAMA orang lain pada konteks transaksi/riwayat/
 * denda milik orang tersebut (bukan milik penanya). Lihat catatan deteksi di
 * atas `NAMED_THIRD_PARTY_DATA_NOUN`.
 */
export function isNamedThirdPartyDataRequest(query: string): boolean {
  const raw = query.trim();
  if (!raw) return false;
  const q = ` ${normalizeQuery(raw)} `;

  // Data milik sendiri bukan pihak ketiga.
  if (FIRST_PERSON.test(q)) return false;
  // Wajib berada pada konteks transaksi/riwayat/denda (atau menyebut "buku").
  if (!NAMED_THIRD_PARTY_DATA_NOUN.test(q) && !/\bbuku\b/.test(q)) return false;
  // Pencarian katalog / atribusi karya: nama merujuk buku atau penulis.
  if (CATALOG_OR_AUTHORSHIP_CONTEXT.test(q)) return false;

  const tokens = raw.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean);
  // Lewati token pertama (awal kalimat selalu berhuruf besar).
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    // Nama orang: huruf besar di awal lalu huruf kecil (bukan akronim ALL-CAPS
    // seperti "RPL"/"TKJ" dan bukan singkatan).
    if (!/^[A-Z][a-z]{2,}$/.test(token)) continue;
    const lower = token.toLowerCase();
    if (NAMED_THIRD_PARTY_STOPWORDS.has(lower)) continue;
    // Mata pelajaran/jurusan berhuruf kapital (mis. "Fisika", "Akuntansi")
    // bukan nama orang, jadi tidak menandai permintaan data pihak ketiga.
    if (SCHOOL_SUBJECT_OR_MAJOR.has(lower)) continue;
    // Nama yang didahului penanda buku = judul buku, bukan orang.
    if (BOOK_MARKER_WORDS.has(tokens[i - 1].toLowerCase())) return false;
    return true;
  }
  return false;
}

/**
 * True bila permintaan secara eksplisit menunjuk data pribadi pengguna LAIN
 * (bukan cakupan kolektif/operasional). Dipakai untuk membatasi Pustakawan:
 * daftar transaksi global tetap boleh, tetapi data milik orang yang disebut
 * namanya tidak boleh dibuka.
 */
export function isTargetedOtherUserRequest(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Kata ganti orang pertama tanpa cakupan kolektif = data sendiri.
  if (FIRST_PERSON.test(q) && !OTHER_SCOPE_OBJECT.test(q)) return false;
  return (
    OTHER_PERSON_TRANSACTION.test(q) ||
    OTHER_PERSON.test(q) ||
    isNamedThirdPartyDataRequest(query)
  );
}

/**
 * Kata yang tidak pernah menjadi nama/email/NIS target pada permintaan data
 * pengguna tertentu. Dipakai untuk mengambil kata kunci pencarian dari kalimat
 * bebas ("tampilkan riwayat peminjaman Budi Santoso" → "Budi Santoso").
 */
const USER_LOOKUP_STOPWORDS = new Set([
  "tampilkan", "tunjukkan", "lihat", "lihatkan", "daftar", "cari", "carikan",
  "kalau", "kalo", "lalu", "terus", "dan", "jika", "bagaimana", "gimana", "yang",
  "cek", "periksa", "riwayat", "history", "peminjaman", "pinjaman", "peminjam",
  "transaksi", "denda", "tagihan", "pengembalian", "dikembalikan",
  "mengembalikan", "buku", "ebook", "koleksi", "katalog", "semua", "seluruh",
  "keseluruhan", "dan", "atau", "yang", "untuk", "dari", "pada", "dengan",
  "di", "ke", "oleh", "atas", "nama", "milik", "punya", "punyanya", "orang",
  "lain", "user", "pengguna", "akun", "anggota", "member", "siswa", "murid",
  "guru", "staf", "staff", "pustakawan", "admin", "administrator", "profil",
  "identitas", "data", "diri", "info", "informasi", "detail", "berapa",
  "jumlah", "total", "banyak", "apa", "apakah", "siapa", "kapan", "mana",
  "saja", "bagaimana", "cara", "jelaskan", "sebutkan", "mohon", "tolong",
  "dong", "kah", "ini", "itu", "tersebut", "tadi", "aktif", "masa", "akses",
  "sedang", "lagi", "belum", "sudah", "telah", "harus", "bisa", "boleh",
  "akan", "ada", "tidak", "bukan", "juga", "pernah", "terakhir", "status",
  "kondisi", "akunnya", "bukunya", "dendanya", "pinjamannya", "januari",
  "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september",
  "oktober", "november", "desember", "hari", "tanggal", "bulan", "tahun",
  "minggu", "kemarin", "besok", "sekarang", "lalu", "baru", "nomor", "nis",
  "nip", "email", "bernama", "terdaftar", "digilib", "sistem", "daftarkan", "dibuat", "didaftarkan",
  "identitasnya", "halaman", "menu",
  // Dimensi kelas bukan nama/email/NIS. Nilai kelas yang sebenarnya dibuang
  // terpisah oleh pemanggil (lihat answerUserDirectoryAdmin) agar pencarian
  // "siswa kelas XII IPA 1" tidak menjadi kata kunci "kelas xii ipa".
  "kelas", "tingkat", "jurusan", "rombel", "angkatan",
]);

/**
 * Ambil kata kunci identitas (nama/email/NIS) dari pertanyaan bebas, atau null
 * bila tidak ada. Email dan nomor identitas dideteksi dari teks ASLI agar tidak
 * rusak oleh normalisasi; nama diambil dari token yang tersisa setelah kata
 * umum dibuang.
 */
export function extractUserLookupTerm(query: string): string | null {
  const raw = query.trim();
  if (!raw) return null;

  const email = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) return email[0];

  const identityNumber = raw.match(/\b\d{4,}\b/);
  if (identityNumber) return identityNumber[0];

  const tokens = normalizeQuery(raw)
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 3 &&
        !USER_LOOKUP_STOPWORDS.has(token) &&
        !/^\d{1,3}$/.test(token)
    );
  return tokens.length > 0 ? tokens.join(" ") : null;
}

/** Token yang tidak pernah menjadi nama orang pada konteks transaksi. */
function isNonNameWord(lower: string): boolean {
  return (
    NAMED_THIRD_PARTY_STOPWORDS.has(lower) ||
    SCHOOL_SUBJECT_OR_MAJOR.has(lower) ||
    NAMED_THIRD_PARTY_DATA_NOUN.test(lower) ||
    LOAN_VERB.test(lower) ||
    RETURN_VERB.test(lower) ||
    READ_VERB.test(lower) ||
    FINE.test(lower)
  );
}

/** Token yang menandai konteks transaksi/peminjaman (untuk kedekatan nama). */
function isLoanContextToken(token: string): boolean {
  if (!token) return false;
  const lower = token.toLowerCase();
  return (
    NAMED_THIRD_PARTY_DATA_NOUN.test(lower) ||
    LOAN_VERB.test(lower) ||
    RETURN_VERB.test(lower) ||
    FINE.test(lower)
  );
}

/**
 * Permintaan data pihak ketiga yang AMBIGU — nama calon ditulis serba huruf
 * kecil, serba KAPITAL, atau campuran, sehingga kapitalisasi TIDAK boleh
 * dianggap bukti pasti nama orang (mis. "denda budi berapa", "riwayat peminjaman
 * BUDI", "buku apa yang dipinjam budi", "budi meminjam buku apa"). Untuk kasus
 * seperti ini pipeline memberi KLARIFIKASI netral (lihat `CLARIFY`) — tidak
 * menjawab dari riwayat/denda penanya, tidak menolak pencarian katalog yang sah,
 * dan tidak menganggapnya data pribadi.
 *
 * Kandidat nama hanya dianggap bila berdampingan dengan konteks
 * transaksi/pinjaman, agar pertanyaan seperti "buku apa yang jatuh temponya
 * paling dekat" TIDAK ikut tertangkap.
 */
export function isAmbiguousThirdPartyQuery(query: string): boolean {
  const raw = query.trim();
  if (!raw) return false;
  const q = ` ${normalizeQuery(raw)} `;

  // Data milik sendiri bukan pihak ketiga.
  if (FIRST_PERSON.test(q)) return false;
  // Wajib berada pada konteks transaksi/riwayat/denda (atau menyebut "buku").
  if (!NAMED_THIRD_PARTY_DATA_NOUN.test(q) && !/\bbuku\b/.test(q)) return false;
  // Pencarian katalog / atribusi karya / topik / dimensi katalog sekolah.
  if (CATALOG_OR_AUTHORSHIP_CONTEXT.test(q)) return false;
  // Pertanyaan panduan/kebijakan, bukan permintaan data.
  if (GUIDE_HINT.test(q)) return false;
  // Cakupan kolektif (mis. "seluruh siswa") ditangani jalur operasional.
  if (OTHER_SCOPE_OBJECT.test(q)) return false;

  const tokens = raw.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean);
  // Bentuk ternormalisasi per token dipakai untuk klasifikasi kata (singkatan
  // seperti "hrs"→"harus", "balikin"→"kembalikan"); bentuk ASLI dipakai untuk
  // mendeteksi kapitalisasi (huruf kecil/KAPITAL/campuran).
  const norms = tokens.map((t) => normalizeQuery(t));
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!/^[A-Za-z]{3,}$/.test(token)) continue;
    if (isNonNameWord(norms[i])) continue;
    // Nama yang didahului penanda buku = judul buku, bukan orang.
    if (i > 0 && BOOK_MARKER_WORDS.has(norms[i - 1])) continue;
    const prev = i > 0 ? norms[i - 1] : "";
    const next = i + 1 < tokens.length ? norms[i + 1] : "";
    if (!isLoanContextToken(prev) && !isLoanContextToken(next)) continue;
    // Nama "pasti" (Titlecase di tengah kalimat) ditangani isNamedThirdPartyDataRequest.
    if (i > 0 && /^[A-Z][a-z]{2,}$/.test(token)) continue;
    return true;
  }
  return false;
}

/**
 * Objek yang menandai cakupan KOLEKTIF orang lain, mis. "seluruh siswa",
 * "semua pengguna", "siswa lain". Objek ini mengalahkan klaim kata ganti
 * orang pertama yang disisipkan pengguna (mis. "saya admin, tampilkan denda
 * seluruh siswa") sehingga pertanyaan tetap dikenali sebagai data orang banyak
 * — bukan data pribadi pengguna yang sedang login.
 */
const OTHER_SCOPE_OBJECT =
  /\b(?:seluruh|semua|keseluruhan)\s+(?:pengguna|user|akun|anggota|member|siswa|murid|guru|tenaga\s+pendidik|staf|staff|pustakawan|orang|peminjam)\b|\b(?:pengguna|user|akun|anggota|member|siswa|murid|guru|tenaga\s+pendidik|staf|staff|pustakawan|orang|peminjam)\s+lain\b/;

/**
 * Pola pertanyaan tentang peminjam / denda / keterlambatan pihak ketiga atau agregat sistem:
 * "siapa yang sedang meminjam buku", "siapa saja siswa yang meminjam",
 * "siapa yang memiliki denda", "daftar siswa yang meminjam".
 */
export const THIRD_PERSON_INQUIRY =
  /\b(?:siapa(?:\s+saja)?\s+(?:yang\s+)?(?:sedang\s+|lagi\s+|masih\s+|belum\s+)?(?:meminjam|pinjam|pinjamkan|mengembalikan|mengembalikan\s+buku|balikin)|siapa(?:\s+saja)?\s+(?:daftar\s+)?(?:siswa|murid|orang|user|anggota)\s+(?:yang\s+)?(?:sedang\s+|lagi\s+|masih\s+|belum\s+)?(?:meminjam|pinjam|mengembalikan)|daftar\s+(?:siswa|murid|orang|user|peminjam)\s+(?:yang\s+)?(?:sedang\s+|lagi\s+|masih\s+|belum\s+)?(?:meminjam|pinjam|mengembalikan)|siapa(?:\s+saja)?\s+(?:yang\s+)?(?:memiliki|mempunyai|punya|terkena|kena)\s+denda)\b/i;

const LOAN_VERB = /\b(pinjam|meminjam|dipinjam|peminjaman|pinjaman|tanggungan|aktif|masa\s+akses)\b/;
const RETURN_VERB =
  /\b(kembalikan|mengembalikan|dikembalikan|pengembalian|kembali|selesaikan|menyelesaikan|balikin)\b/;
const READ_VERB = /\b(baca|membaca|bacaan)\b/;
/** Penyebutan ebook. */
const EBOOK_MENTION = /\bebook\b/;
const DUE = /\b(jatuh\s*tempo|tenggat|tanggal\s+kembali)\b/;
const OVERDUE =
  /\b(terlambat|telat|overdue|melewati\s+(?:batas|jatuh\s*tempo|tanggal\s+(?:pengembalian|kembali))|melebihi\s+(?:batas|jatuh\s*tempo|tanggal\s+(?:pengembalian|kembali))|lewat\s+(?:(?:dari)\s+)?(?:batas|jatuh\s*tempo|tanggal\s+(?:pengembalian|kembali)))\b/;
const HISTORY_SIGNAL =
  /\b(riwayat|pernah|terakhir|history|selesai|selesaikan|pengembalian|(?:bulan|tahun|minggu)\s+(?:ini|lalu|kemarin)|yang\s+sudah\s+lalu)\b/;
const FINE = /\b(denda\w*|tagihan\w*|tunggakan\w*|fine\w*)\b/;

/**
 * Kata kerja imperatif untuk MEMINTA daftar/lihat data. Dipakai agar permintaan
 * seperti "Tampilkan denda kerusakan." tanpa kata ganti pertama dikenali sebagai
 * permintaan data operasional (bukan denda pribadi / bukan sapaan).
 */
const LIST_VERB = /\b(tampilkan|tunjukkan|lihat|lihatkan|daftar|cetak|rekap)\b/;

/** Penanda pertanyaan panduan/kebijakan (bukan permintaan data). */
const GUIDE_HINT = /\b(cara|bagaimana|panduan|prosedur|syarat|aturan|ketentuan|kebijakan)\b/;

/** Lanjutan "menitipkan" kata jatuh tempo tanpa kata ganti, mis. "jatuh tempo terdekat". */
const DUE_IMPLIED = /\bjatuh\s*tempo(?:nya)?\s+(?:paling\s+)?(?:dekat|cepat|dulu)\b/;

/** Pertanyaan tentang ebook yang sedang dibaca tanpa kata ganti orang pertama. */
const EBOOK_READING_IMPLIED =
  /\b(?:sedang\s+|lagi\s+)?(?:membaca|baca|dibaca)\s+ebook\b|\bebook\s+(?:apa(?:\s+saja)?|yang)\s+(?:yang\s+)?(?:sedang\s+|lagi\s+)?(?:dibaca|dibacakan)/;

/** Kata kerja/aktivitas yang menandai pertanyaan tentang ebook yang dipinjam/dibaca. */
const EBOOK_ACTIVITY_VERB = /\b(?:membaca|baca|dibaca|pembacaan|aktivitas|peminjam)\b/;

/** Kata kerja/aktivitas membaca (dipakai untuk menjawab jujur soal tracking baca). */
const READING_ACTIVITY =
  /\b(?:membaca|baca|dibaca|pembacaan|aktivitas\s+membaca|riwayat\s+membaca)\b/;

/**
 * Penanda cakupan orang lain/kolektif untuk pertanyaan ebook. Pertanyaan
 * "Ebook apa yang sedang dibaca?" tanpa penanda ini tetap dianggap pertanyaan
 * data pribadi (lihat `isPersonalEbookReadingQuery`).
 */
function hasEbookOtherScopeCue(q: string, raw: string): boolean {
  if (
    !FIRST_PERSON.test(q) &&
    /\b(?:berapa|jumlah|total)\s+(?:ebook|sesi|peminjaman|pinjaman)\b/.test(q)
  ) {
    return true;
  }
  return (
    THIRD_PERSON_INQUIRY.test(q) ||
    OTHER_PERSON.test(q) ||
    OTHER_SCOPE_OBJECT.test(q) ||
    /\bsiapa\b/.test(q) ||
    /\b(?:daftar|seluruh|semua|keseluruhan)\b/.test(q) ||
    isNamedThirdPartyDataRequest(raw)
  );
}

/**
 * True bila pertanyaan benar-benar menyangkut PEMINJAMAN/MASA AKSES/AKTIVITAS
 * BACA ebook — bukan sekadar mencari koleksi ("ebook apa saja yang tersedia")
 * dan bukan peringkat peminjam (punya jalur deterministik sendiri).
 *
 * Catatan: aktivitas membaca dicatat terpisah pada EbookReadingSession; deteksi
 * ini hanya memilih jalur jawaban yang tepat. Status ACTIVE pada EbookLoan
 * berarti masa akses masih berlaku, BUKAN bukti pengguna sedang membaca.
 */
export function isEbookBorrowerOrReadingQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (!EBOOK_MENTION.test(q)) return false;
  if (GUIDE_HINT.test(q)) return false;
  // Peringkat peminjam bukan daftar pemegang masa akses aktif.
  if (isBorrowerRankingQuery(query)) return false;
  // Riwayat peminjaman (bukan aktivitas baca) ditangani jalur riwayat/tool.
  if (/\b(riwayat|pernah|terakhir|history)\b/.test(q) && !READING_ACTIVITY.test(q)) {
    return false;
  }
  if (!(EBOOK_ACTIVITY_VERB.test(q) || LOAN_VERB.test(q))) return false;
  return (
    READING_ACTIVITY.test(q) ||
    /\b(peminjam|aktivitas|masa\s+akses|aktif|sedang|lagi|sekarang|saat\s+ini)\b/.test(q) ||
    hasEbookOtherScopeCue(q, query)
  );
}

/** Pertanyaan ebook tentang pengguna LAIN / seluruh sistem. */
export function isOtherUserEbookActivityQuery(query: string): boolean {
  if (!isEbookBorrowerOrReadingQuery(query)) return false;
  const q = ` ${normalizeQuery(query)} `;
  return hasEbookOtherScopeCue(q, query);
}

/** Pertanyaan ebook yang merujuk data pengguna sendiri (atau ambigu tanpa cakupan lain). */
export function isPersonalEbookReadingQuery(query: string): boolean {
  if (!isEbookBorrowerOrReadingQuery(query)) return false;
  const q = ` ${normalizeQuery(query)} `;
  return !hasEbookOtherScopeCue(q, query);
}

/**
 * Sinyal aktivitas membaca yang benar-benar dapat dicatat sistem:
 * membuka/membaca ebook, sesi baca, halaman/progres.
 *
 * Sengaja TIDAK menyamakan peminjaman/masa akses dengan aktivitas membaca.
 */
const READ_OPEN_ACTIVITY =
  /\b(?:membaca|membacanya|baca|dibaca|pembacaan|membuka|dibuka|membukanya|buka|bukaan|sesi\s+baca|sesi\s+membaca|sesi\s+ebook|halaman|progres)\b/;
/**
 * Sinyal aktivitas yang SPESIFIK pada sesi baca. "sedang membaca/dibaca"
 * sengaja tidak masuk di sini agar pertanyaan lama tentang masa akses ebook
 * tetap dijawab dari EbookLoan seperti Tahap 1.
 */
const READ_ACTIVITY_EXPLICIT =
  /\baktivitas\s+(?:membaca|membacanya)\b|\briwayat\s+membaca\b|\bsesi\s+(?:baca|membaca|ebook)\b/;
const READ_GLOBAL_AGGREGATE_CUE =
  /\b(?:berapa|jumlah|total)\s+(?:pengguna|user|orang|siswa|guru|ebook|buku|sesi)\b|\b(?:pengguna|ebook|buku)\s+unik\b|\b(?:jumlah|total)\s+sesi\b/;

export function isReadingActivityQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (GUIDE_HINT.test(q)) return false;
  // Agregat "ebook/buku unik" adalah metrik aktivitas membaca, meski tidak
  // menyebut kata kerja baca secara eksplisit.
  if (/\b(?:ebook|buku)\s+unik\b/.test(q) && /\b(?:berapa|jumlah|total)\b/.test(q)) {
    return true;
  }
  if (!READ_OPEN_ACTIVITY.test(q)) return false;
  // Contoh "Siapa yang aktivitas membacanya masih aktif?" tidak selalu
  // menyebut "ebook", tetapi jelas tentang aktivitas membaca.
  if (
    !EBOOK_MENTION.test(q) &&
    !/\b(?:aktivitas|sesi)\b/.test(q)
  ) {
    return false;
  }

  // Pertanyaan eksplisit tentang sesi/aktivitas/halaman, atau pembukaan ebook.
  if (READ_ACTIVITY_EXPLICIT.test(q)) return true;
  if (/\b(?:membuka|dibuka|membukanya|buka|bukaan)\b/.test(q)) return true;
  if (/\b(?:halaman|progres)\b/.test(q)) return true;
  if (READ_GLOBAL_AGGREGATE_CUE.test(q)) return true;
  if (
    /\bterakhir\b/.test(q) &&
    /\b(?:membaca|membacanya|baca|dibaca)\b/.test(q)
  ) {
    return true;
  }
  return false;
}

/**
 * Pertanyaan aktivitas membaca yang mencakup orang lain/seluruh sistem.
 * Hanya ADMIN yang boleh diarahkan ke data global; LIBRARIAN tetap memakai
 * kebijakan lama dan TIDAK otomatis mendapat akses pemantauan baru.
 */
export function isGlobalReadingActivityQuery(query: string): boolean {
  if (!isReadingActivityQuery(query)) return false;
  const q = ` ${normalizeQuery(query)} `;
  if (hasEbookOtherScopeCue(q, query)) return true;
  if (READ_GLOBAL_AGGREGATE_CUE.test(q)) return true;
  if (/\b(?:tampilkan|tunjukkan|daftar|rekap|statistik)\b.*\b(?:aktivitas|sesi)\b/.test(q)) {
    return true;
  }
  if (
    !/\b(?:saya|aku|ku|punyaku)\b/.test(q) &&
    /^\s*(?:aktivitas|rekap|statistik)\b/.test(q)
  ) {
    return true;
  }
  // "Siapa yang terakhir/terbaru membuka ebook?" adalah data global, bukan
  // aktivitas pribadi penanya, selama tidak ada kata ganti orang pertama.
  if (
    !/\b(?:saya|aku|ku|punyaku)\b/.test(q) &&
    /\bsiapa\b/.test(q) &&
    /\b(?:terakhir|terbaru|paling\s+akhir)\b/.test(q)
  ) {
    return true;
  }
  return false;
}

/** Pertanyaan aktivitas membaca milik pengguna sendiri (bukan data global). */
export function isMyReadingActivityQuery(query: string): boolean {
  return isReadingActivityQuery(query) && !isGlobalReadingActivityQuery(query);
}

/**
 * Pertanyaan RIWAYAT/SELURUH peminjaman ebook, dibedakan dari peminjaman yang
 * masa aksesnya masih aktif. Contoh yang cocok: "riwayat peminjaman ebook",
 * "semua peminjaman ebook", "transaksi peminjaman ebook semua siswa".
 *
 * Pertanyaan "peminjaman ebook aktif" / "masa akses yang masih berlaku" TIDAK
 * masuk ke sini karena memang menanyakan status aktif, bukan riwayat.
 * Aktivitas membaca juga tidak masuk karena sumbernya EbookReadingSession.
 */
export function isEbookLoanHistoryQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (!EBOOK_MENTION.test(q)) return false;
  if (GUIDE_HINT.test(q)) return false;
  // Riwayat/aktivitas membaca bukan riwayat peminjaman.
  if (isReadingActivityQuery(query) || READING_ACTIVITY.test(q)) return false;
  // "belum dikembalikan"/"sedang dipinjam" menandakan transaksi AKTIF, bukan
  // riwayat — meski kalimatnya memuat kata "semua".
  if (isActiveLoansQuery(query)) return false;
  if (!/\b(?:peminjaman|pinjaman|masa\s+akses|transaksi)\b/.test(q)) return false;

  const historyCue =
    /\b(?:riwayat|semua|seluruh|daftar|pernah|keseluruhan|rekap|transaksi)\b/.test(q);
  if (!historyCue) return false;

  // "semua peminjaman ebook aktif" tetap pertanyaan status aktif.
  if (
    /\b(?:aktif|masih|sekarang|saat\s+ini|berlaku)\b/.test(q) &&
    !/\b(?:riwayat|pernah)\b/.test(q)
  ) {
    return false;
  }

  return true;
}

/**
 * Regex untuk mendeteksi permintaan eksplisit tentang ebook/buku digital.
 * Hanya true jika pengguna SECARA EKSPLISIT menyebut format digital.
 */
const EXPLICIT_EBOOK_QUERY = EBOOK_FORMAT_QUERY;

/**
 * Regex untuk mendeteksi permintaan eksplisit tentang buku fisik.
 * True jika pengguna SECARA EKSPLISIT menyebut buku fisik/cetak.
 */
const EXPLICIT_PHYSICAL_BOOK_QUERY = PHYSICAL_FORMAT_QUERY;

/**
 * True bila pengguna meminta KEDUA format secara eksplisit, mis.
 * "tampilkan buku fisik dan ebook yang tersedia".
 *
 * Diarahkan ke intent CATALOG; resolver format akan mengembalikan ALL dan
 * jawaban disusun dalam dua bagian terpisah.
 */
export function isMixedFormatCatalogQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (!EXPLICIT_EBOOK_QUERY.test(q) || !EXPLICIT_PHYSICAL_BOOK_QUERY.test(q)) {
    return false;
  }
  if (GUIDE_HINT.test(q)) return false;
  if (isEbookBorrowerOrReadingQuery(query)) return false;
  if (isEbookLoanHistoryQuery(query)) return false;
  if (isReadingActivityQuery(query)) return false;
  if (isPersonalEbookReadingQuery(query)) return false;
  if (isOtherUserEbookActivityQuery(query)) return false;
  if (isOperationalDataQuery(query)) return false;
  return true;
}

/**
 * True bila pertanyaan SECARA EKSPLISIT meminta ebook/buku digital.
 * Hanya true jika ada penyebutan eksplisit format digital.
 * Tidak termasuk kata "baca" saja — konteks lengkap diperlukan.
 */
export function isExplicitEbookCatalogQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (!EXPLICIT_EBOOK_QUERY.test(q)) return false;
  if (GUIDE_HINT.test(q)) return false;
  // Jika ada penyebutan eksplisit buku fisik, jangan anggap ebook
  if (EXPLICIT_PHYSICAL_BOOK_QUERY.test(q)) return false;
  // Jika hanya kata "baca" tanpa konteks ebook eksplisit, bukan katalog ebook
  if (/\bbaca\b/.test(q) && !EXPLICIT_EBOOK_QUERY.test(q)) return false;
  return true;
}

/**
 * True bila pertanyaan SECARA EKSPLISIT meminta buku fisik/cetak.
 */
export function isExplicitPhysicalBookQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return EXPLICIT_PHYSICAL_BOOK_QUERY.test(q);
}

/**
 * True bila pertanyaan tentang katalog buku (fisik atau ebook) TANPA
 * penyebutan eksplisit format. Default ke buku fisik.
 * Termasuk: "buku tentang sejarah", "cari buku matematika", "ada buku fisika?",
 * "rekomendasi buku sejarah", "koleksi perpustakaan", dll.
 */
export function isImplicitPhysicalBookQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Jika eksplisit ebook atau eksplisit fisik, bukan implicit
  if (EXPLICIT_EBOOK_QUERY.test(q) || EXPLICIT_PHYSICAL_BOOK_QUERY.test(q)) {
    return false;
  }
  // Jika panduan/guide, bukan katalog
  if (GUIDE_HINT.test(q)) return false;
  // Pertanyaan transaksi peminjaman aktif ("sedang dipinjam", "belum
  // dikembalikan") adalah data transaksi, BUKAN pencarian koleksi.
  if (isActiveLoansQuery(query)) return false;
  // Jika pertanyaan ebook borrower/reading/loan history, bukan katalog
  if (isEbookBorrowerOrReadingQuery(query)) return false;
  if (isEbookLoanHistoryQuery(query)) return false;
  if (isReadingActivityQuery(query)) return false;
  // Jika personal ebook reading query, bukan katalog
  if (isPersonalEbookReadingQuery(query)) return false;
  // Jika operasi ebook lain, bukan katalog
  if (isOtherUserEbookActivityQuery(query)) return false;
  // Jika operational query lain, bukan katalog
  if (isOperationalDataQuery(query)) return false;
  if (isOtherUserDataRequest(query)) return false;
  if (isOtherUserActivityQuery(query)) return false;
  if (isNamedThirdPartyDataRequest(query)) return false;
  if (isAmbiguousThirdPartyQuery(query)) return false;
  if (isUserDirectoryQuery(query)) return false;
  // Kata kunci katalog fisik (sinyal kuat)
  const physicalCatalogKeywords =
    /\b(buku|katalog|koleksi|pinjam|peminjaman|stok|tersedia|cari|carikan|rekomendasi|rekomendasikan|find|penulis|penerbit|isbn|judul|perpustakaan|borrowing|novel|komik|majalah|kitab|artikel)\b/;
  const hasPhysicalCatalogKeyword = physicalCatalogKeywords.test(q);
  // Dimensi katalog (kelas, jurusan, mapel) - sinyal lemah
  const hasCatalogDimension = CATALOG_DIMENSION.test(q);
  
  // Jika tidak ada sinyal katalog sama sekali, bukan katalog fisik
  if (!hasPhysicalCatalogKeyword && !hasCatalogDimension) return false;
  
  // Kata kerja learning KUAT yang mengindikasikan permintaan pembelajaran murni
  // "contoh soal", "buatkan soal", "latihan", "soal" - ini learning murni
  const strongLearningVerbs =
    /\b(contoh\s+soal|buatkan\s+soal|latihan|soal|quiz|contoh|ringkas|jelaskan|jelask|jelas|apa\s+itu|mengapa|kenapa|rumus|bandingkan|bedakan|sebutkan|simplify)\b/;
  // Jika ada kata kerja learning KUAT tanpa kata kunci katalog fisik, itu learning murni
  // "contoh soal matematika kelas 10" = learning (ada "contoh soal")
  // "buatkan soal latihan IPA kelas 10" = learning (ada "buatkan soal", "latihan")
  // "belajar matematika kelas 10" = katalog (hanya "belajar" + dimensi, tidak learning verb kuat)
  if (strongLearningVerbs.test(q) && !hasPhysicalCatalogKeyword) return false;

  // Pertanyaan edukatif/penjelasan umum yang kebetulan menyebut "buku" sebagai
  // topik/aktivitas (mis. "Jelaskan manfaat membaca buku...") bukan permintaan
  // pencarian katalog, selama tidak ada sinyal aksi katalog.
  if (
    strongLearningVerbs.test(q) &&
    /\b(manfaat|pentingnya|tujuan|dampak|keuntungan|alasan|mengapa\s+perlu|kenapa\s+perlu|hikmah|fungsi)\b/.test(q) &&
    !/\b(cari|carikan|rekomendasi|rekomendasikan|tersedia|stok|ada\s+(buku|ebook|judul|koleksi)|berapa|jumlah|daftar|tampilkan|koleksi\s+apa|buku\s+apa\s+saja|judul|penulis|penerbit|isbn|pinjam|peminjaman|katalog)\b/.test(q)
  ) {
    return false;
  }
  
  // Hindari pertanyaan belajar/learning HANYA jika tidak ada sinyal katalog sama sekali
  // "jelaskan buku sejarah" = katalog (ada "buku"), "jelaskan fotosintesis" = learning
  // "belajar matematika kelas 10" = katalog (ada dimensi kelas), "belajar fotosintesis" = learning
  if (LEARNING.test(q) && !hasPhysicalCatalogKeyword && !CATALOG_DIMENSION.test(q)) return false;
  
  // Hindari follow-up learning
  if (FOLLOW_UP.test(q)) return false;
  // Hindai coding
  if (isCodingRequest(query)) return false;
  return true;
}

/**
 * True bila pertanyaan tentang katalog ebook secara eksplisit.
 * Contoh: "ebook apa saja yang tersedia?", "cari ebook sejarah", "ada ebook matematika?"
 */
export function isEbookCatalogQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Harus eksplisit ebook
  if (!EXPLICIT_EBOOK_QUERY.test(q)) return false;
  if (GUIDE_HINT.test(q)) return false;
  if (EXPLICIT_PHYSICAL_BOOK_QUERY.test(q)) return false;
  // Hindari ebook borrower/reading/loan history
  if (isEbookBorrowerOrReadingQuery(query)) return false;
  if (isEbookLoanHistoryQuery(query)) return false;
  if (isReadingActivityQuery(query)) return false;
  if (isPersonalEbookReadingQuery(query)) return false;
  if (isOtherUserEbookActivityQuery(query)) return false;
  // Kata kunci katalog ebook
  const ebookCatalogKeywords =
    /\b(ebook|buku\s+digital|buku\s+elektronik|bacaan\s+digital)\b/;
  return ebookCatalogKeywords.test(q);
}

/** Pertanyaan keterlambatan tanpa kata ganti atau pertanyaan umum buku terlambat. */
const OVERDUE_IMPLIED =
  /\b(?:ada|apakah\s+ada|apa\s+saja|daftar)?\s*(?:buku|peminjaman|pinjaman|transaksi)(?:\s+apa\s+saja|\s+apa\s+aja)?\s+(?:yang\s+)?(?:sedang\s+|lagi\s+)?(?:terlambat|telat|overdue|melewati\s+(?:batas|jatuh\s*tempo|tanggal\s+(?:pengembalian|kembali))|melebihi\s+(?:batas|jatuh\s*tempo|tanggal\s+(?:pengembalian|kembali))|lewat\s+(?:(?:dari)\s+)?(?:batas|jatuh\s*tempo|tanggal\s+(?:pengembalian|kembali)))(?:\s+(?:di)?kembalikan)?\b|\b(?:buku|peminjaman|pinjaman)\s+(?:yang\s+)?(?:terlambat|telat|overdue)\s+yang\s+(?:mana|apa)\b/i;

/** Pertanyaan peminjaman aktif pengguna sendiri. */
const ACTIVE_LOAN_IMPLIED =
  /\bbuku\s+(?:yang\s+)?(?:sedang\s+|lagi\s+)?(?:saya\s+|aku\s+)?(?:di)?pinjam(?:\s+apa\s+saja)?\b/i;

/** Pertanyaan operasional sistem untuk Pustakawan/Admin. */
const OPERATIONAL_QUERY =
  /\b(transaksi|seluruh|semua\s+peminjam|pengguna|anggota|member|statistik\s+pengguna|laporan|denda\s+keseluruhan|keterlambatan\s+keseluruhan|peminjaman\s+terbaru|transaksi\s+terbaru)\b/;

export function isOperationalQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (FIRST_PERSON.test(q)) return false;
  return (
    OPERATIONAL_QUERY.test(q) ||
    THIRD_PERSON_INQUIRY.test(q) ||
    /\b(?:buku|daftar)\s+(?:apa\s+saja\s+)?(?:yang\s+)?(?:sedang\s+|lagi\s+)?(?:terlambat|telat|overdue)(?:\s+(?:di)?kembalikan)?\b/i.test(q) ||
    /\b(?:siapa|daftar)\s+(?:yang\s+)?(?:memiliki|punya|terkena|kena)?\s*denda(?:\s+kerusakan|\s+keterlambatan)?\b/i.test(q)
  );
}

/**
 * Pertanyaan tentang daftar atau jumlah PENGGUNA (orang), bukan koleksi buku.
 * Sengaja mensyaratkan kata kuantitas/kolektif berdampingan langsung dengan
 * kata benda orang agar pertanyaan katalog seperti "tampilkan semua buku"
 * atau "buku apa saja yang tersedia" TIDAK ikut tertangkap.
 *
 * Contoh yang cocok: "berapa jumlah pengguna per role", "siapa saja pengguna
 * DigiLib", "tampilkan daftar seluruh siswa", "riwayat peminjaman semua siswa".
 */
const USER_DIRECTORY =
  /\b(?:berapa|jumlah|total|daftar|seluruh|semua|list)\s+(?:jumlah\s+|seluruh\s+|semua\s+)?(?:pengguna|user|akun|anggota|member|siswa|murid|guru|tenaga\s+pendidik|staf|staff|pustakawan)\b|\bsiapa\s+saja\s+(?:pengguna|user|akun|anggota|member|siswa|murid|guru|tenaga\s+pendidik|staf|staff|pustakawan)\b|\bada\s+siapa\s+saja\b|\bsebutkan\s+(?:nama\s+)?(?:seluruh|semua)\s+(?:pengguna|user|akun|anggota|member|siswa|murid|guru|tenaga\s+pendidik|staf|staff|pustakawan)\b|\bsiapa(?:kah)?\s+(?:yang\s+)?(?:menjadi\s+|menjabat\s+sebagai\s+)?(?:admin(?:istrator)?|pustakawan|guru|siswa|murid|staf|staff)\b/i;

/** True bila pertanyaan meminta daftar/jumlah pengguna (bukan data diri sendiri). */
export function isUserDirectoryQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (FIRST_PERSON.test(q)) return false;
  return USER_DIRECTORY.test(q);
}

// ---------------------------------------------------------------------------
// Intent khusus (Tahap 4B-2): pemisahan tegas antara data operasional sistem,
// jumlah pengguna agregat, daftar identitas pengguna, denda pribadi, dan
// pengaturan sistem. Tujuannya agar pertanyaan tidak pernah salah diarahkan
// ke intent data pribadi pengguna yang sedang login.
// ---------------------------------------------------------------------------

/** Kata benda yang menandai data transaksi milik banyak pengguna. */
const LOAN_DATA_NOUN =
  /\b(pinjam|pinjamkan|meminjam|dipinjam|peminjaman|pinjaman|transaksi|denda|tagihan|keterlambatan|terlambat|pengembalian|dikembalikan|ebook)\b/;

/** Penanda cakupan global/kolektif (bukan milik pengguna yang login). */
const GLOBAL_SCOPE = /\b(seluruh|semua|keseluruhan|global|laporan)\b/;

/** Kata kerja transaksi peminjaman untuk pertanyaan per-tanggal. */
const BORROW_VERB =
  /\b(meminjam|meminjam|pinjam|dipinjam|peminjaman|pinjaman|peminjam|transaksi)\b/;

/** Kata benda orang (pengguna sistem / warga sekolah). */
const USER_NOUN_GROUP =
  "(?:pengguna|user|akun|anggota|member|siswa|murid|guru|tenaga\s+pendidik|staf|staff|pustakawan|orang|peminjam)";

const USER_NOUN = new RegExp(USER_NOUN_GROUP, "i");

/** Pola "berapa jumlah pengguna", "jumlah total pengguna", "total seluruh siswa". */
const AGGREGATE_USER_COUNT = new RegExp(
  `\\b(?:berapa\\s+(?:banyak\\s+|jumlah\\s+|total\\s+)?${USER_NOUN_GROUP}|(?:jumlah|total)\\s+(?:total\\s+|seluruh\\s+|semua\\s+|keseluruhan\\s+)?${USER_NOUN_GROUP})\\b`,
  "i"
);

/** Pola "daftar seluruh siswa", "siapa saja pengguna", "tampilkan semua siswa". */
const USER_DIRECTORY_LIST = new RegExp(
  `\\b(?:daftar|seluruh|semua|list)\\s+(?:seluruh\\s+|semua\\s+)?${USER_NOUN_GROUP}\\b|\\bsiapa\\s+saja\\s+(?:yang\\s+)?${USER_NOUN_GROUP}\\b|\\btampilkan\\s+(?:daftar\\s+|seluruh\\s+|semua\\s+)?${USER_NOUN_GROUP}\\b`,
  "i"
);

/** Pertanyaan pengaturan sistem DigiLib (khusus Admin). */
const SYSTEM_SETTINGS_QUERY =
  /\b(pengaturan\s+(?:sistem|aplikasi|digilib|perpustakaan)|konfigurasi\s+(?:sistem|aplikasi|digilib|perpustakaan)|setting\s+(?:sistem|aplikasi|digilib)|system\s+setting)\b/;

/**
 * True bila pertanyaan meminta JUMLAH pengguna secara agregat
 * ("berapa jumlah pengguna terdaftar?"). Pertanyaan yang menyentuh
 * data transaksi/denda TIDAK dihitung — itu pertanyaan operasional.
 */
export function isAggregateUserCountQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (FIRST_PERSON.test(q)) return false;
  if (LOAN_DATA_NOUN.test(q)) return false;
  return AGGREGATE_USER_COUNT.test(q);
}

/**
 * True bila pertanyaan meminta DAFTAR identitas pengguna (bukan jumlah agregat
 * dan bukan koleksi buku). Sengaja TIDAK dibatasi kata ganti orang pertama
 * agar permintaan yang menyisipkan "saya" tetap tertangkap dan tidak pernah
 * dibocorkan sebagai daftar pengguna.
 */
export function isUserDirectoryListQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Menyentuh data transaksi/denda → tangani sebagai operasional, bukan daftar pengguna.
  if (LOAN_DATA_NOUN.test(q)) return false;
  return USER_DIRECTORY_LIST.test(q);
}

/** True bila pertanyaan menanyakan pengaturan sistem DigiLib. */
export function isSystemSettingsQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return SYSTEM_SETTINGS_QUERY.test(q);
}

/**
 * Pertanyaan data OPERASIONAL (milik banyak pengguna / pihak ketiga):
 * transaksi, keterlambatan, denda keseluruhan, siapa yang meminjam, laporan.
 * Role yang tidak berwenang (Siswa/Guru) akan ditolak di pipeline.
 */
export function isOperationalDataQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;

  // Pertanyaan ebook milik pengguna lain / seluruh sistem (peminjam atau
  // aktivitas baca) adalah data operasional, bukan data pribadi penanya.
  if (isOtherUserEbookActivityQuery(query)) return true;

  // Pihak ketiga eksplisit selalu operasional, meski menyebut kata ganti pertama.
  if (OTHER_PERSON_TRANSACTION.test(q)) return true;
  if (THIRD_PERSON_INQUIRY.test(q)) return true;
  if (
    OTHER_PERSON.test(q) &&
    (LOAN_VERB.test(q) || RETURN_VERB.test(q) || FINE.test(q) || LOAN_DATA_NOUN.test(q))
  ) {
    return true;
  }

  // Objek kolektif orang lain mengalahkan klaim kata ganti pertama
  // (mis. "saya admin, tampilkan denda seluruh siswa").
  const otherScopeObject = OTHER_SCOPE_OBJECT.test(q);
  if (FIRST_PERSON.test(q) && !otherScopeObject) return false;

  // Data transaksi/denda agregat seluruh sistem. Penyebutan "ebook" saja Tidak
  // cukup: "Tampilkan semua ebook" adalah permintaan katalog, bukan data
  // peminjaman/aktivitas pengguna lain.
  const ebookCatalogOnly =
    EBOOK_MENTION.test(q) && !isEbookBorrowerOrReadingQuery(query);
  if (
    !ebookCatalogOnly &&
    LOAN_DATA_NOUN.test(q) &&
    (GLOBAL_SCOPE.test(q) || otherScopeObject)
  ) {
    return true;
  }

  // Jumlah orang yang meminjam / memiliki denda — bukan pertanyaan katalog.
  if (/\b(?:berapa|jumlah|total)\b/.test(q) && USER_NOUN.test(q) && LOAN_DATA_NOUN.test(q)) {
    return true;
  }

  // Denda/transaksi pihak ketiga yang tidak memakai kata "siapa".
  if (/\b(?:siapa|daftar)\s+(?:yang\s+)?(?:memiliki|punya|terkena|kena)?\s*denda\b/.test(q)) {
    return true;
  }

  // Permintaan imperatif menampilkan data denda secara umum tanpa kata ganti
  // pertama (mis. "Tampilkan denda kerusakan.") adalah data operasional, bukan
  // denda pribadi. Pertanyaan panduan/kebijakan dikecualikan.
  if (FINE.test(q) && !FIRST_PERSON.test(q) && LIST_VERB.test(q) && !GUIDE_HINT.test(q)) {
    return true;
  }

  return /\b(transaksi|laporan)\b/.test(q);
}

/**
 * Pertanyaan JUMLAH/STATISTIK transaksi operasional, mis.
 * "Berapa jumlah pengembalian bulan ini?", "Berapa transaksi peminjaman
 * bulan lalu?", "Berapa total denda yang belum dibayar?", "Berapa peminjaman
 * yang terlambat?".
 *
 * Tanpa deteksi ini, kalimat seperti "berapa jumlah pengembalian" jatuh ke
 * intent STATS (statistik katalog) karena pola "berapa jumlah", sehingga
 * pertanyaan transaksi dijawab dengan jumlah buku. Deteksi ini sengaja:
 * - hanya untuk role operasional (pipeline menolak Siswa/Guru),
 * - tidak menangkap pertanyaan waktu ("pukul/jam berapa", "kapan"),
 * - tidak menangkap pertanyaan tarif/aturan denda,
 * - tidak menangkap pertanyaan katalog murni tentang buku.
 */
export function isOperationalTransactionStatsQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;

  // Data milik sendiri tetap jalur personal (riwayat/denda sendiri).
  if (FIRST_PERSON.test(q)) return false;

  // Nama pihak ketiga yang ambigu ("denda budi berapa") harus diberi
  // KLARIFIKASI netral lebih dulu, bukan dianggap statistik sistem. Tanpa
  // pengecualian ini, kata "berapa" + "denda" menangkapnya sebagai OPERATIONAL
  // dan melewati jalur klarifikasi.
  if (isAmbiguousThirdPartyQuery(query)) return false;
  // Permintaan data orang tertentu bukan statistik agregat sistem. Jawab lewat
  // jalur pihak ketiga yang sudah ada, jangan menampilkan angka seluruh sistem
  // seolah-olah itu jawaban untuk orang yang disebut.
  if (isNamedThirdPartyDataRequest(query) || isOtherUserDataRequest(query)) return false;

  // "Pukul berapa ...?" / "Kapan ...?" menanyakan waktu, bukan jumlah.
  if (/\b(?:pukul|jam)\s+berapa\b/.test(q) || /\bkapan\b/.test(q)) return false;

  // Tarif/aturan denda adalah panduan/pengaturan, bukan statistik denda.
  if (/\b(?:tarif|biaya|aturan|ketentuan|prosedur)\s+denda\b|\bdenda\s+per\s+hari\b/.test(q)) {
    return false;
  }

  // Jumlah/daftar pengguna punya jalur tersendiri (khusus Admin).
  if (isAggregateUserCountQuery(query) || isUserDirectoryQuery(query)) return false;

  // Peringkat peminjam ("paling sering/terbanyak") punya jalur deterministik
  // sendiri dan BUKAN pertanyaan jumlah agregat.
  if (
    /\b(paling|terbanyak|tertinggi|teraktif|tersering|rajin|sering|peringkat|top|favorit)\b/.test(
      q
    )
  ) {
    return false;
  }

  const asksQuantity =
    /\b(berapa|jumlah|banyak|total|statistik|rekap|ringkasan|angka|count)\b/.test(q);
  if (!asksQuantity) return false;

  const transactionNoun =
    /\b(transaksi|peminjaman|pinjaman|peminjam|dipinjam|meminjam|pengembalian|dikembalikan|denda|tagihan|tunggakan|pengajuan|permintaan|keterlambatan|terlambat|overdue|berlangsung|masa\s+akses)\b/.test(
      q
    );
  if (!transactionNoun) return false;

  // "Berapa buku ..." adalah pertanyaan koleksi, kecuali menyebut transaksi
  // secara eksplisit ("berapa transaksi peminjaman buku", "berapa buku yang sedang dipinjam").
  if (/\b(?:buku|ebook)\b/.test(q) && !/\btransaksi\b/.test(q)) {
    const strongTransaction =
      /\b(peminjaman|pinjaman|dipinjam|meminjam|pengembalian|dikembalikan|denda|pengajuan|permintaan|keterlambatan|terlambat|overdue|berlangsung|belum\s+dikembalikan|masa\s+akses)\b/.test(
        q
      );
    if (!strongTransaction) return false;
  }

  return true;
}

/**
 * Pertanyaan operasional yang DIBATASI TANGGAL: "siapa yang meminjam buku hari
 * ini", "siapa yang meminjam buku pada tanggal 18 Oktober", "tampilkan
 * peminjaman tanggal 15 Oktober". Pertanyaan seperti ini WAJIB dijawab dari
 * transaksi pada rentang tanggal tersebut (zona Asia/Jakarta) — bukan dari
 * daftar transaksi terbaru, dan bukan hasil karangan model.
 *
 * Hanya dianggap pertanyaan per-tanggal bila ada tanggal/hari yang dapat
 * dipahami ATAU tanggal parsial ("tanggal 18") yang perlu diklarifikasi.
 */
export function isBorrowsByDateQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Data milik sendiri bukan pertanyaan operasional.
  if (FIRST_PERSON.test(q)) return false;
  // Pertanyaan denda punya jalur deterministiknya sendiri.
  if (FINE.test(q)) return false;
  // Cukup kata kunci transaksi/peminjaman (tanpa mensyaratkan kata tanya seperti
  // "siapa/berapa"). Ini menutup celah yang membuat pertanyaan seperti
  // "Ada transaksi peminjaman pada tanggal 15 Oktober?" jatuh ke jalur model dan
  // bisa dijawab keliru. BORROW_SUBJECT kini opsional.
  if (!BORROW_VERB.test(q)) return false;
  return (
    resolveJakartaDateRange(query) !== null ||
    resolveJakartaPeriod(query) !== null ||
    extractPartialDay(query) !== null
  );
}

/**
 * Kata kerja pengembalian untuk pertanyaan per-tanggal. Dibedakan dari
 * `RETURN_VERB` yang juga memuat "kembali" (kata umum) agar pertanyaan seperti
 * "kapan buku ini kembali ke rak?" tidak salah dianggap transaksi pengembalian.
 */
const RETURN_DATE_VERB =
  /\b(mengembalikan|dikembalikan|pengembalian|kembalikan|balikin)\b/;

/**
 * Pertanyaan OPERASIONAL yang dibatasi tanggal tentang PENGEMBALIAN
 * ("siapa yang mengembalikan buku pada tanggal 17 Oktober 2026", "tampilkan
 * pengembalian 2026-10-17"). Berbeda dari `isBorrowsByDateQuery`: jenis riwayat
 * yang ditanyakan adalah pengembalian, sehingga tanggal yang dipakai untuk
 * memfilter adalah tanggal kembali — bukan tanggal pinjam. Ini menutup celah
 * yang membuat pertanyaan pengembalian dijawab dari tanggal pinjam atau jatuh
 * ke jalur katalog.
 */
export function isReturnsByDateQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Data milik sendiri bukan pertanyaan operasional.
  if (FIRST_PERSON.test(q)) return false;
  // Pertanyaan denda punya jalur deterministiknya sendiri.
  if (FINE.test(q)) return false;
  if (!RETURN_DATE_VERB.test(q)) return false;
  return (
    resolveJakartaDateRange(query) !== null ||
    resolveJakartaPeriod(query) !== null ||
    extractPartialDay(query) !== null
  );
}

/** Kata kerja peminjaman tanpa kata "transaksi" (untuk memutuskan dasar tanggal lanjutan). */
const BORROW_ACTION_VERB =
  /\b(meminjam|meminjam|pinjam|dipinjam|peminjaman|pinjaman|peminjam)\b/;

/**
 * Lanjutan percakapan OPERASIONAL yang hanya menyebut tanggal, mis.
 * "kalau tanggal 17 Oktober 2026?" setelah "tampilkan transaksi terbaru".
 *
 * Konteks hanya dipakai untuk memahami MAKSUD, bukan sebagai sumber fakta.
 * Mengembalikan dasar tanggal ("BORROW"/"RETURN") atau null bila lanjutan ini
 * bukan lanjutan percakapan transaksi. Dengan begitu pertanyaan bertanggal tidak
 * pernah diteruskan ke model (yang bisa mengarang/menyalin transaksi tanggal
 * lain), tetapi pertanyaan umum yang tidak berkaitan juga tidak dipaksa menjadi
 * query transaksi.
 */
export function detectTransactionsByDateFollowUpBasis(
  query: string,
  hasHistory: boolean,
  previousUserMessages: string[] = []
): "BORROW" | "RETURN" | null {
  if (!hasHistory || previousUserMessages.length === 0) return null;

  const q = ` ${normalizeQuery(query)} `;
  if (FIRST_PERSON.test(q)) return null;
  if (FINE.test(q)) return null;
  if (THIRD_PERSON_INQUIRY.test(q) || OTHER_PERSON.test(q)) return null;

  const hasDate =
    resolveJakartaDateRange(query) !== null ||
    resolveJakartaPeriod(query) !== null ||
    extractPartialDay(query) !== null;
  if (!hasDate) return null;

  const context = ` ${normalizeQuery(previousUserMessages.join(" "))} `;
  const borrowVerb = BORROW_ACTION_VERB.test(context);
  const returnVerb = RETURN_DATE_VERB.test(context);
  // "transaksi" menandai percakapan transaksi → dasar tanggal default peminjaman.
  const transactionWord = /\btransaksi\b/.test(context);
  if (!borrowVerb && !returnVerb && !transactionWord) return null;
  if (returnVerb && !borrowVerb) return "RETURN";
  return "BORROW";
}

/**
 * Pertanyaan tentang transaksi peminjaman MILIK PENGGUNA SENDIRI yang dibatasi
 * satu tanggal ("saya meminjam apa kemarin", "kapan saya pinjam buku 18
 * Oktober", atau lanjutan singkat "kemarin?" setelah pertanyaan pribadi).
 *
 * Dipakai pipeline untuk menjawab deterministik dari transaksi pengguna sendiri
 * pada rentang hari Asia/Jakarta — sehingga model TIDAK pernah mengarang
 * transaksi bertanggal untuk pengguna (mis. mengaitkan transaksi 18 Oktober ke
 * tanggal "kemarin" 17 Oktober).
 *
 * Riwayat percakapan hanya dipakai untuk memahami MAKSUD lanjutan, bukan sebagai
 * sumber fakta: tanpa sinyal pribadi pada pertanyaan sebelumnya, lanjutan
 * bertanggal tidak dianggap sebagai data pribadi.
 */
export function isMyBorrowsByDateQuery(
  query: string,
  hasHistory: boolean,
  previousUserMessages: string[] = []
): boolean {
  const q = ` ${normalizeQuery(query)} `;

  // Aktivitas membaca ebook punya sumber data sendiri (EbookReadingSession),
  // bukan transaksi peminjaman. Tanpa pengecualian ini, "ebook apa yang
  // terakhir saya baca bulan ini?" salah diarahkan ke riwayat peminjaman.
  if (isMyReadingActivityQuery(query)) return false;

  // Pihak ketiga / kolektif / denda bukan data pribadi.
  if (THIRD_PERSON_INQUIRY.test(q) || OTHER_PERSON.test(q)) return false;
  if (OTHER_SCOPE_OBJECT.test(q)) return false;
  if (FINE.test(q)) return false;
  if (isGlobalOverdueQuery(query)) return false;
  if (isUserDirectoryQuery(query)) return false;
  // Pertanyaan yang menyebut nama orang lain (pasti atau ambigu) bukan data
  // pribadi penanya — jangan pernah dijawab dari transaksi pengguna yang login.
  if (isNamedThirdPartyDataRequest(query) || isAmbiguousThirdPartyQuery(query)) return false;

  const hasDate =
    resolveJakartaDateRange(query) !== null ||
    resolveJakartaPeriod(query) !== null ||
    extractPartialDay(query) !== null;
  if (!hasDate) return false;

  // Pertanyaan eksplisit tentang peminjaman sendiri.
  const borrowish =
    LOAN_VERB.test(q) ||
    RETURN_VERB.test(q) ||
    READ_VERB.test(q) ||
    EBOOK_MENTION.test(q) ||
    /\bbuku\b/.test(q);
  if (FIRST_PERSON.test(q) && borrowish) return true;

  // Lanjutan singkat bertanggal ("kemarin?") setelah konteks pribadi.
  if (!hasHistory || previousUserMessages.length === 0) return false;
  const context = ` ${normalizeQuery(previousUserMessages.join(" "))} `;
  const personalContext =
    FIRST_PERSON.test(context) ||
    /\b(riwayat|peminjaman|pinjaman|pinjam)\b/.test(context);
  // Konteks sebelumnya yang jelas tentang pihak ketiga/kolektif TIDAK boleh
  // membuat lanjutan bertanggal dianggap transaksi pribadi penanya.
  const previousRaw = previousUserMessages.join(" ");
  const otherContext =
    OTHER_SCOPE_OBJECT.test(context) ||
    OTHER_PERSON.test(context) ||
    THIRD_PERSON_INQUIRY.test(context) ||
    OTHER_PERSON_TRANSACTION.test(context) ||
    isNamedThirdPartyDataRequest(previousRaw) ||
    isAmbiguousThirdPartyQuery(previousRaw);
  return personalContext && !otherContext;
}

/**
 * Pertanyaan PERINGKAT peminjam ("Siswa rajin siapa?", "Siapa yang paling sering
 * meminjam buku?", "Siswa dengan peminjaman terbanyak"). Berbeda dari
 * `isOtherUserActivityQuery` yang juga mencakup "siapa yang sedang meminjam":
 * di sini benar-benar ada klaim peringkat/aktivitas, sehingga Pustakawan/Admin
 * boleh dijawab dengan agregat nyata, sedangkan role lain ditolak.
 */
export function isBorrowerRankingQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;

  // Kata ganti orang pertama tanpa cakupan kolektif → pertanyaan pribadi.
  if (FIRST_PERSON.test(q) && !OTHER_SCOPE_OBJECT.test(q)) return false;

  // "siswa rajin", "siswa paling aktif", "siswa yang paling rajin", "siswa teladan".
  if (
    /\b(?:siswa|murid|pelajar|anggota|pengguna)\s+(?:yang\s+)?(?:paling\s+)?(?:rajin|aktif|gemar|teladan|terbanyak|tersering|teraktif)\b/.test(
      q
    )
  ) {
    return true;
  }

  // Peringkat peminjam: "siapa yang paling sering meminjam buku",
  // "siswa dengan peminjaman terbanyak", "peminjam teraktif".
  const ranking =
    /\b(?:paling\s+(?:sering|rajin|aktif|banyak|gemar)|sering|rajin|terbanyak|teraktif|tersering|tergemar|favorit)\b/.test(
      q
    );
  const borrowish = LOAN_DATA_NOUN.test(q) || BORROW_VERB.test(q);
  const asksWho = /\b(siapa|siapa\s+saja)\b/.test(q);
  if (ranking && borrowish && (USER_NOUN.test(q) || asksWho)) return true;

  return false;
}

/**
 * Pertanyaan tentang AKTIVITAS / PERINGKAT pengguna lain (\"Siswa rajin siapa?\",
 * \"Siapa yang paling sering meminjam buku?\", \"Siswa dengan peminjaman
 * terbanyak?\", \"Riwayat peminjaman siswa lain\"). Role tanpa wewenang harus
 * menolak secara deterministik — bukan meneruskan ke model. Mencakup pertanyaan
 * peminjam pihak ketiga pada umumnya, bukan hanya peringkat.
 */
export function isOtherUserActivityQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;

  // Bentuk eksplisit pihak ketiga sudah pasti.
  if (OTHER_PERSON_TRANSACTION.test(q) || THIRD_PERSON_INQUIRY.test(q)) return true;
  if (OTHER_PERSON.test(q) && LOAN_DATA_NOUN.test(q)) return true;
  // Peminjam/aktivitas ebook milik pengguna lain atau seluruh sistem.
  if (isOtherUserEbookActivityQuery(query)) return true;

  return isBorrowerRankingQuery(query);
}

/**
 * Pertanyaan keterlambatan GLOBAL / seluruh sistem — bukan milik pengguna yang
 * sedang login. Contoh: "Buku apa saja yang sedang terlambat?", "Siapa saja yang
 * terlambat mengembalikan buku?", "Tampilkan semua peminjaman terlambat."
 *
 * Deteksi ini sengaja TIDAK bergantung pada role: pipeline-lah yang memutuskan
 * hanya ADMIN/LIBRARIAN yang diarahkan ke data operasional seluruh sistem,
 * sedangkan STUDENT/TEACHER tetap dijawab dari data pribadinya.
 *
 * Kata ganti orang pertama ("Apakah saya punya buku yang terlambat?") membuat
 * pertanyaan tetap personal, kecuali ada cakupan kolektif eksplisit
 * (mis. "seluruh siswa"). Pertanyaan denda dikecualikan karena punya jalur
 * deterministiknya sendiri (jenis denda harus tepat).
 */
export function isGlobalOverdueQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;

  // Denda punya jalur deterministik sendiri (keterlambatan vs kerusakan).
  if (FINE.test(q)) return false;

  if (!OVERDUE.test(q)) return false;

  // Cakupan kolektif orang lain mengalahkan kata ganti orang pertama.
  if (OTHER_SCOPE_OBJECT.test(q)) return true;

  // Tanpa cakupan kolektif, "saya/aku" berarti pertanyaan pribadi.
  if (FIRST_PERSON.test(q)) return false;

  return true;
}

/**
 * Pertanyaan jumlah transaksi peminjaman buku fisik yang SUDAH dikembalikan
 * tetapi terlambat (returnDate > dueDate). Ini bukan keterlambatan aktif
 * ("sedang/masih/belum terlambat"), sehingga kata penanda keberlangsungan
 * dikecualikan agar tidak tertukar dengan daftar overdue.
 */
export function isLateReturnedPhysicalQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (FIRST_PERSON.test(q)) return false;
  if (FINE.test(q)) return false;
  if (/\b(sedang|masih|belum)\b/.test(q)) return false;
  if (!/\b(terlambat|telat|overdue)\b/.test(q)) return false;
  if (!/\b(dikembalikan|mengembalikan|pengembalian|kembali)\b/.test(q)) return false;
  if (!/\b(transaksi|peminjaman|pinjaman|peminjam)\b/.test(q)) return false;
  if (!/\b(berapa|jumlah|total|banyak)\b/.test(q)) return false;
  return true;
}

/**
 * Penanda transaksi yang MASIH BERJALAN: sudah diserahkan tetapi belum
 * dikembalikan ("sedang dipinjam", "masih saya pinjam", "belum dikembalikan",
 * "belum selesai") atau sudah melewati jatuh tempo.
 *
 * Sengaja tidak memakai kata kerja "meminjam"/"pinjam" tanpa penanda
 * keberlangsungan agar pertanyaan per-tanggal ("siapa yang meminjam buku pada
 * tanggal X") dan riwayat tidak ikut tertangkap.
 */
const ACTIVE_LOAN_CUE =
  /\b(?:(?:masih|sedang|lagi)\s+(?:saya\s+|aku\s+)?(?:di)?(?:pinjam|meminjam)|(?:masih|sedang|lagi)\s+(?:saya\s+|aku\s+)?(?:di)?(?:kembalikan|mengembalikan)|belum\s+(?:saya\s+|aku\s+)?(?:di)?(?:kembali(?:kan)?|mengembalikan)|belum\s+selesai|masih\s+berjalan|masih\s+aktif|peminjaman\s+aktif|pinjaman\s+aktif|transaksi\s+aktif)\b/;

/** Kata benda/konteks yang menandai pertanyaan tentang transaksi peminjaman. */
const LOAN_CONTEXT_NOUN =
  /\b(buku|ebook|pinjam\w*|meminjam\w*|dipinjam\w*|peminjaman|pinjaman|transaksi|peminjam|kembali\w*|pengembalian|jatuh\s*tempo|tenggat|terlambat|telat|overdue)\b/;

/**
 * Kata kerja/objek pinjam yang tegas. Dipakai untuk mengenali pertanyaan
 * keadaan SAAT INI ("siapa yang pinjam sekarang") tanpa ikut menangkap
 * pertanyaan katalog biasa ("sekarang buku apa saja?").
 */
const LOAN_VERB_NOUN =
  /\b(pinjam\w*|meminjam\w*|dipinjam\w*|peminjaman|pinjaman|peminjam)\b/;

/** Penanda waktu yang menunjukkan keadaan berjalan. */
const CURRENT_TIME_CUE = /\b(sekarang|saat\s+ini|kini)\b/;

/**
 * True bila pertanyaan menanyakan transaksi peminjaman yang MASIH BERJALAN
 * (sedang dipinjam / belum dikembalikan / belum selesai / terlambat).
 *
 * Ini BUKAN pertanyaan katalog: kata "buku" pada pertanyaan seperti "buku apa
 * saja yang sedang dipinjam" merujuk transaksi, bukan koleksi. Pemisahan ini
 * mencegah pertanyaan transaksi dijawab dengan "tidak ada di katalog".
 */
export function isActiveLoansQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  // Denda punya jalur deterministik sendiri (jenis denda harus tepat).
  if (FINE.test(q)) return false;
  if (!LOAN_CONTEXT_NOUN.test(q)) return false;
  if (ACTIVE_LOAN_CUE.test(q) || OVERDUE.test(q)) return true;
  // "Siapa yang pinjam sekarang?" / "siapa aja yang minjem saat ini" adalah
  // pertanyaan keadaan berjalan. Wajib ada kata kerja pinjam eksplisit agar
  // "sekarang buku apa saja?" tetap pertanyaan katalog.
  return CURRENT_TIME_CUE.test(q) && LOAN_VERB_NOUN.test(q);
}

/**
 * Pertanyaan peminjaman aktif untuk SELURUH sistem (pihak ketiga/kolektif atau
 * tanpa kata ganti orang pertama). Dipakai pipeline untuk mengarahkan
 * Pustakawan/Admin ke data operasional, bukan data pribadi. Role lain tetap
 * dijawab dari data pribadinya.
 */
export function isGlobalActiveLoansQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (!isActiveLoansQuery(query)) return false;
  if (FIRST_PERSON.test(q)) return false;
  return true;
}

/**
 * True bila pertanyaan menyebut denda/tagihan. Dipakai pipeline untuk memilih
 * pesan penolakan yang spesifik denda (bukan riwayat peminjaman) bagi role yang
 * tidak berwenang.
 */
export function isFineQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  return FINE.test(q);
}

/**
 * Penanda pertanyaan TARIF/nominal denda, bukan denda milik pengguna.
 * Contoh: "Berapa tarif denda per hari?", "Berapa denda kerusakan ringan?".
 *
 * Nilai nominal TIDAK diambil dari teks jawaban model, melainkan dibaca dari
 * pengaturan aktif (Setting) oleh pipeline. Deteksi ini hanya memilih jalur
 * jawaban yang tepat.
 */
const FINE_RATE_CUE =
  /\b(tarif|biaya|per\s*hari|perhari|harian|nominal|besaran|berapa\s+rupiah)\b/;

/** Pertanyaan kuantitas yang lazim dipakai saat menanyakan tarif. */
const FINE_RATE_QUESTION = /\b(berapa|brp|brapa|nominal|tarif|biaya|besaran)\b/;

/**
 * Kategori denda yang cukup spesifik untuk menandai pertanyaan tarif bila
 * digabung dengan kata tanya. "kerusakan" saja sengaja tidak masuk agar
 * "Tampilkan denda kerusakan." tetap menjadi permintaan daftar operasional.
 */
const FINE_RATE_CATEGORY =
  /\b(keterlambatan|terlambat|telat|overdue|ringan|sobek|hilang|kehilangan|sampul|berat|kotor|halaman\s+(?:sobek|hilang)|rusak\s+ringan)\b/;

/**
 * True bila pengguna menanyakan TARIF denda (keterlambatan/kerusakan), bukan
 * denda pribadi atau daftar denda pengguna lain.
 *
 * Aturan:
 * - Wajib menyebut denda.
 * - Bukan data milik sendiri ("denda saya") dan bukan pihak ketiga/kolektif.
 * - Bukan perintah menampilkan daftar ("tampilkan denda ...").
 * - Bukan pertanyaan panduan ("bagaimana cara ...").
 * - Butuh penanda tarif eksplisit, ATAU kategori denda spesifik + kata tanya.
 */
export function isFineRateQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (!FINE.test(q)) return false;

  // Denda pribadi tetap jalur MY_FINES.
  if (FIRST_PERSON.test(q)) return false;

  // Data pihak ketiga/kolektif tetap jalur operasional atau klarifikasi.
  if (OTHER_PERSON.test(q) || THIRD_PERSON_INQUIRY.test(q)) return false;
  if (OTHER_SCOPE_OBJECT.test(q) || GLOBAL_SCOPE.test(q)) return false;
  if (isNamedThirdPartyDataRequest(query)) return false;

  // Perintah daftar dan panduan bukan pertanyaan tarif.
  if (LIST_VERB.test(q) || GUIDE_HINT.test(q)) return false;

  if (FINE_RATE_CUE.test(q)) return true;
  return FINE_RATE_QUESTION.test(q) && FINE_RATE_CATEGORY.test(q);
}

// ---------------------------------------------------------------------------
// AUDIT AKUN PENGGUNA (pembuatan & penghapusan) — HANYA ADMIN.
//
// Deteksi intent bersifat role-agnostic; pipeline-lah yang menolak non-ADMIN
// secara deterministik (sebelum query sensitif dijalankan) dan mengarahkan
// ADMIN ke tool audit khusus. Tujuannya agar pertanyaan audit tidak pernah
// sampai ke jalur model — baik untuk ADMIN maupun non-ADMIN.
// ---------------------------------------------------------------------------

/** Kata benda akun/orang yang menandai audit akun, bukan audit koleksi buku. */
const USER_ACCOUNT_NOUN =
  /\b(akun|pengguna|user|siswa|murid|guru|staf|staff|pustakawan|admin(?:istrator)?|anggota|member)\b/;

/** Kata kerja pembuatan akun. */
const ACCOUNT_CREATE_VERB =
  /\b(dibuat|dibikin|dibentuk|pembuatan|membuat|dibuatkan|menambah|menambahkan|penambahan|registrasi|mendaftar)\b/;

/** Kata kerja penghapusan akun. */
const ACCOUNT_DELETE_VERB =
  /\b(dihapus|hapus|menghapus|penghapusan|dihapuskan|terhapus|delete)\b/;

/** Pertanyaan tata cara ("cara membuat akun") bukan pertanyaan audit. */
const ACCOUNT_HOWTO =
  /\b(?:cara|bagaimana|gimana|prosedur|panduan|syarat|langkah)\b/;

/**
 * Objek NON-pengguna: bila muncul, kata "dibuat/dihapus" merujuk ke koleksi,
 * bukan ke akun (mis. "buku apa saja yang baru dibuat?").
 */
const NON_USER_OBJECT =
  /\b(buku|ebook|koleksi|katalog|kategori|pengumuman|denda|peminjaman|transaksi|notifikasi|rak)\b/;

/**
 * True bila pertanyaan meminta RIWAYAT AUDIT pembuatan/penghapusan akun.
 * Contoh: "Siapa saja pengguna yang dihapus hari ini?", "Siapa yang dihapus
 * hari ini?", "Akun apa saja yang dibuat hari ini?", "Kapan akun Najla dibuat?",
 * "Siapa yang menghapus akun tersebut?", "Tampilkan riwayat pembuatan dan
 * penghapusan pengguna."
 *
 * Bukan audit: "bagaimana cara membuat akun", "berapa jumlah pengguna terdaftar",
 * "daftar pengguna", atau pembuatan/penghapusan objek non-pengguna (buku, dsb).
 */
export function isUserAuditQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;

  // Penyebutan audit/log aktivitas secara eksplisit, selama menyangkut pengguna
  // atau riwayat/log — bukan mis. judul buku "tentang audit keuangan".
  if (
    /\b(audit|log\s+aktivitas|jejak\s+aktivitas)\b/.test(q) &&
    (USER_ACCOUNT_NOUN.test(q) || /\b(riwayat|log|jejak|aktivitas)\b/.test(q))
  ) {
    return true;
  }

  const create = ACCOUNT_CREATE_VERB.test(q);
  const remove = ACCOUNT_DELETE_VERB.test(q);
  if (!create && !remove) return false;

  // Pertanyaan tata cara pembuatan/penghapusan akun bukan permintaan audit.
  if (ACCOUNT_HOWTO.test(q)) return false;

  // Pembuatan/penghapusan objek non-pengguna bukan audit akun.
  if (NON_USER_OBJECT.test(q)) return false;

  // "Siapa" (who) menandakan orang, meski kata "akun/pengguna" tidak muncul.
  return USER_ACCOUNT_NOUN.test(q) || /\bsiapa\b/.test(q);
}

/** Jenis audit yang diminta: pembuatan, penghapusan, atau keduanya. */
export function detectUserAuditType(query: string): "CREATE" | "DELETE" | "ALL" {
  const q = ` ${normalizeQuery(query)} `;
  const create = ACCOUNT_CREATE_VERB.test(q);
  const remove = ACCOUNT_DELETE_VERB.test(q);
  if (create && !remove) return "CREATE";
  if (remove && !create) return "DELETE";
  return "ALL";
}

/** Kata yang tidak pernah menjadi nama/email akun target pada pertanyaan audit. */
const AUDIT_SEARCH_STOPWORDS = new Set([
  "yang", "dan", "atau", "oleh", "untuk", "dari", "pada", "dengan", "di", "ke",
  "akun", "pengguna", "user", "siswa", "murid", "guru", "staf", "staff",
  "pustakawan", "admin", "administrator", "anggota", "member", "orang",
  "riwayat", "history", "audit", "log", "jejak", "aktivitas", "rekap",
  "dibuat", "dibikin", "dibentuk", "pembuatan", "membuat", "menambah",
  "menambahkan", "penambahan", "registrasi", "terdaftar", "mendaftar", "baru",
  "dihapus", "hapus", "menghapus", "penghapusan", "dihapuskan", "terhapus",
  "delete", "kapan", "siapa", "apa", "saja", "tampilkan", "tunjukkan", "lihat",
  "daftar", "cek", "hari", "ini", "kemarin", "tanggal", "tgl", "bulan", "tahun",
  "lalu", "besok", "tersebut", "tadi", "itu", "semua", "seluruh", "keseluruhan",
  "januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus",
  "september", "oktober", "november", "desember", "tolong", "mohon", "dong", "kah",
  // Penanda urutan/peringkat, bukan nama akun. Tanpa ini "Siapa yang membuat
  // akun terbaru?" mencari kata kunci "terbaru" dan melaporkan tidak ada data.
  "terbaru", "terakhir", "terlama", "paling", "urut", "urutkan", "pertama", "awal",
]);

/**
 * Kata kunci nama/email akun target dari pertanyaan audit, atau null bila tidak
 * ada. Dipakai untuk memfilter AuditLog (details / nama / email) tanpa menebak.
 */
export function extractUserAuditSearch(query: string): string | null {
  const tokens = normalizeQuery(query)
    .split(/\s+/)
    .filter(
      (w) => w.length >= 3 && !AUDIT_SEARCH_STOPWORDS.has(w) && !/^\d+$/.test(w)
    );
  return tokens.length > 0 ? tokens[0] : null;
}

/** Pertanyaan peminjaman aktif milik pengguna sendiri. */
function isMyLoansRequest(q: string): boolean {
  // Pertanyaan tentang ebook pengguna lain bukan pinjaman sendiri.
  if (isOtherUserEbookActivityQuery(q)) return false;
  // Jika menanyakan pihak ketiga, ini bukan pinjaman sendiri
  if (THIRD_PERSON_INQUIRY.test(q) || OTHER_PERSON.test(q)) return false;

  // Pertanyaan jumlah buku di perpustakaan / tanpa kata ganti orang pertama adalah statistik global
  if (
    !FIRST_PERSON.test(q) &&
    (/\bdi\s+perpustakaan\b/.test(q) ||
      /\b(?:berapa|jumlah|total)\s+(?:buku|ebook|peminjaman|pinjaman|sesi)\b/.test(q))
  ) {
    return false;
  }

  // Transaksi yang MASIH BERJALAN ("sedang dipinjam", "belum dikembalikan",
  // "belum selesai") adalah peminjaman AKTIF. Dicek sebelum sinyal riwayat agar
  // kata "selesai" pada "belum selesai" tidak salah dianggap riwayat.
  if (isActiveLoansQuery(q)) return true;

  const loanish =
    LOAN_VERB.test(q) ||
    RETURN_VERB.test(q) ||
    READ_VERB.test(q) ||
    DUE.test(q) ||
    DUE_IMPLIED.test(q) ||
    OVERDUE.test(q) ||
    EBOOK_READING_IMPLIED.test(q) ||
    ACTIVE_LOAN_IMPLIED.test(q);
  if (!loanish) return false;

  // "pernah"/"riwayat" sudah menandakan riwayat, bukan pinjaman aktif.
  if (HISTORY_SIGNAL.test(q)) return false;

  const personal =
    FIRST_PERSON.test(q) ||
    /\bpeminjaman\s+aktif\b|\bpinjaman\s+aktif\b/.test(q) ||
    /\bharus\s+(?:di)?kembalikan\b/.test(q) ||
    /\bkapan\s+(?:harus\s+)?(?:di)?kembalikan\b/.test(q) ||
    /\bkembalikan(?:nya)?\s+kapan\b/.test(q) ||
    DUE_IMPLIED.test(q) ||
    EBOOK_READING_IMPLIED.test(q) ||
    OVERDUE_IMPLIED.test(q) ||
    ACTIVE_LOAN_IMPLIED.test(q);
  if (!personal) return false;

  // Pertanyaan kebijakan/cara meminjam bukan pertanyaan tentang pinjaman aktif sendiri.
  const policyQuestion =
    /\b(bisa|boleh|cara|bagaimana|syarat|aturan|ketentuan)\b/.test(q) &&
    !OVERDUE.test(q) &&
    !DUE.test(q) &&
    !/\b(sedang|masih|belum|aktif|punya)\b/.test(q);
  if (policyQuestion) return false;

  return true;
}

/** Pertanyaan riwayat peminjaman/pengembalian milik pengguna sendiri. */
function isMyHistoryRequest(q: string): boolean {
  // Pertanyaan tentang ebook pengguna lain bukan riwayat sendiri.
  if (isOtherUserEbookActivityQuery(q)) return false;
  if (THIRD_PERSON_INQUIRY.test(q) || OTHER_PERSON.test(q)) return false;

  // "belum selesai"/"belum dikembalikan" menandai transaksi AKTIF, bukan
  // riwayat. Tanpa pengecualian ini kata "selesai" salah dibaca sebagai
  // riwayat peminjaman.
  if (isActiveLoansQuery(q)) return false;

  // Kata "riwayat/pernah/terakhir/selesai" secara implisit merujuk data
  // pengguna sendiri. Pertanyaan seperti "buku apa yang sudah dikembalikan?"
  // juga lazim berarti riwayat sendiri. Namun pertanyaan JUMLAH/STATISTIK
  // ("berapa yang sudah dikembalikan bulan ini?") adalah data operasional
  // seluruh sistem, bukan riwayat pribadi.
  const explicitHistory =
    /\b(riwayat|pernah|terakhir|history|selesai|selesaikan|yang\s+sudah\s+lalu)\b/.test(
      q
    );
  const implicitPersonalHistory =
    /\b(?:sudah|telah)\s+(?:saya\s+|aku\s+)?(?:pinjam|meminjam|dipinjam|kembalikan|mengembalikan|dikembalikan|selesaikan|menyelesaikan)\b/.test(
      q
    );
  const asksQuantity = /\b(berapa|jumlah|total|banyak|statistik|rekap)\b/.test(q);
  if (
    !explicitHistory &&
    !FIRST_PERSON.test(q) &&
    !(implicitPersonalHistory && !asksQuantity)
  ) {
    return false;
  }

  const historyish =
    HISTORY_SIGNAL.test(q) ||
    /\b(?:sudah|telah)\s+(?:saya\s+|aku\s+)?(?:pinjam|meminjam|dipinjam|kembalikan|mengembalikan|dikembalikan|selesaikan|menyelesaikan)\b/.test(
      q
    ) ||
    /\b(?:dulu|pernah)\s+(?:saya\s+|aku\s+)?(?:pinjam|meminjam|dipinjam)\b/.test(q);
  if (!historyish) return false;

  return (
    LOAN_VERB.test(q) ||
    RETURN_VERB.test(q) ||
    READ_VERB.test(q) ||
    EBOOK_MENTION.test(q) ||
    /\bbuku\b/.test(q)
  );
}

/**
 * True bila pengguna menanyakan JUMLAH/TOTAL riwayat transaksi miliknya sendiri.
 * Pertanyaan seperti ini dijawab dari `getUserHistoryTotals` (sumber yang sama
 * dengan kartu "Total Riwayat" pada dasbor siswa), bukan dari daftar terbatas.
 */
export function isMyHistoryTotalsQuery(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (isOtherUserEbookActivityQuery(query)) return false;
  if (THIRD_PERSON_INQUIRY.test(q) || OTHER_PERSON.test(q)) return false;
  if (isTargetedOtherUserRequest(query)) return false;
  if (isUserDirectoryQuery(query)) return false;
  if (OTHER_SCOPE_OBJECT.test(q)) return false;
  // Peminjaman aktif bukan riwayat.
  if (isActiveLoansQuery(query)) return false;
  if (!/\b(berapa|jumlah|total|banyak|statistik|rekap)\b/.test(q)) return false;
  return /\b(riwayat|pernah|transaksi|peminjaman|pinjaman|history)\b/.test(q);
}

/**
 * Deteksi pertanyaan data pribadi. Diurutkan denda -> riwayat -> pinjaman aktif.
 */
export function detectPersonalIntent(query: string): Intent | null {
  const q = ` ${normalizeQuery(query)} `;

  // Pertanyaan ebook tentang pengguna lain / seluruh sistem bukan data pribadi.
  if (isOtherUserEbookActivityQuery(query)) return null;

  // Pertanyaan data orang lain / pihak ketiga bukan data pribadi
  if (THIRD_PERSON_INQUIRY.test(q) || OTHER_PERSON.test(q)) return null;

  // Permintaan data transaksi/riwayat/denda milik orang lain yang disebut
  // NAMANYA (mis. "riwayat peminjaman Budi") BUKAN data pribadi penanya —
  // jangan pernah dijawab dari riwayat pengguna yang sedang login.
  if (isNamedThirdPartyDataRequest(query)) return null;

  // Permintaan pihak ketiga yang AMBIGU (nama huruf kecil/KAPITAL/campuran,
  // mis. "riwayat peminjaman BUDI", "denda budi berapa") juga BUKAN data
  // pribadi penanya. Pipeline memberi klarifikasi netral, bukan menjawab dari
  // riwayat/denda pengguna yang sedang login.
  if (isAmbiguousThirdPartyQuery(query)) return null;

  // Pertanyaan daftar/jumlah pengguna (mis. "riwayat peminjaman semua siswa")
  // BUKAN data pribadi pengguna yang sedang login, jadi tidak boleh dijawab
  // dari data pribadi sendiri.
  if (isUserDirectoryQuery(query)) return null;

  // Objek kolektif orang lain (mis. "denda seluruh siswa") selalu dianggap data
  // orang banyak, bahkan bila pengguna menyisipkan kata ganti pertama atau
  // mengklaim peran tertentu (mis. "saya admin").
  if (OTHER_SCOPE_OBJECT.test(q)) return null;

  // Pertanyaan bersifat agregat/global tanpa kata ganti pertama (mis. "berapa
  // denda keseluruhan", "riwayat peminjaman semua siswa") adalah data orang
  // banyak — bukan denda/riwayat pribadi pengguna yang login.
  if (LOAN_DATA_NOUN.test(q) && GLOBAL_SCOPE.test(q) && !FIRST_PERSON.test(q)) {
    return null;
  }

  // Pertanyaan panduan denda di perpustakaan diarahkan ke LIBRARY_GUIDE
  if (isLibraryGuideRequest(query)) return null;

  const finePersonal =
    FINE.test(q) &&
    (FIRST_PERSON.test(q) ||
      /\b(?:denda(?:nya)?\s+berapa|berapa\s+denda(?:nya)?|apakah\s+(?:ada|punya|kena)\s+denda|ada\s+denda(?:\s+tidak)?)\b/.test(q) ||
      /\b(penyebab|menyebabkan|akibat|karena)\s+denda\b/.test(q) ||
      /\bdenda\s+yang\s+menyebabkan\b/.test(q));
  if (finePersonal) return "MY_FINES";

  // Pertanyaan tentang peminjaman/masa akses/aktivitas baca ebook milik sendiri
  // (atau ambigu tanpa cakupan orang lain). "Pernah/riwayat/aktivitas" berarti
  // riwayat; sisanya adalah pertanyaan masa akses aktif.
  // Pertanyaan global yang jelas (orang lain/seluruh sistem) TIDAK boleh
  // dijawab dari data pribadi penanya. Query aktivitas pribadi tanpa penanda
  // global tetap dianggap milik penanya.
  const clearlyGlobalReading =
    isGlobalReadingActivityQuery(query) &&
    (/\bsiapa\b/.test(q) ||
      /\b(?:semua|seluruh|daftar|tampilkan|rekap|statistik)\b/.test(q) ||
      READ_GLOBAL_AGGREGATE_CUE.test(q));
  if (clearlyGlobalReading) return null;
  if (isPersonalEbookReadingQuery(query)) {
    return /\b(aktivitas|riwayat|pernah|terakhir)\b/.test(q) ? "MY_HISTORY" : "MY_LOANS";
  }

  if (isMyHistoryRequest(q)) return "MY_HISTORY";
  if (isMyLoansRequest(q)) return "MY_LOANS";
  return null;
}

/**
 * Permintaan data transaksi/denda milik pengguna lain.
 */
export function isOtherUserDataRequest(query: string): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (OTHER_PERSON_TRANSACTION.test(q)) return true;
  if (THIRD_PERSON_INQUIRY.test(q)) return true;
  if (!OTHER_PERSON.test(q)) return false;
  return (
    LOAN_VERB.test(q) ||
    RETURN_VERB.test(q) ||
    FINE.test(q) ||
    /\b(riwayat|peminjaman|pengembalian|denda|transaksi)\b/.test(q)
  );
}

/**
 * Deteksi maksud pesan. Sederhana dan berbasis kata kunci yang ternormalisasi
 * agar andal tanpa bergantung pada model AI.
 */
export function detectIntent(query: string, hasHistory: boolean): Intent {
  const q = ` ${normalizeQuery(query)} `;

  // 1. Password selalu diprioritaskan untuk keamanan data pengguna.
  if (isPasswordRequest(query)) {
    return "PASSWORD";
  }

  // 1b. Permintaan mutasi data/role melalui chat tidak pernah dijalankan.
  if (isMutationRequest(query)) {
    return "MUTATION";
  }

  // 2. Profil akun sendiri (siapa saya, akun saya).
  if (isMyProfileRequest(query)) {
    return "MY_PROFILE";
  }

  // 2b. Riwayat AUDIT pembuatan/penghapusan akun pengguna. Dicek paling awal
  //     (sebelum data pribadi/operasional) supaya pertanyaan audit tidak pernah
  //     dijawab dari data pribadi maupun jatuh ke jalur model. Otorisasi role
  //     dilakukan di pipeline: hanya ADMIN yang boleh menerima hasilnya,
  //     sementara role lain ditolak secara deterministik.
  if (isUserAuditQuery(query)) {
    return "USER_AUDIT";
  }

  // 2c. Pertanyaan TARIF denda (keterlambatan/kerusakan). Dicek sebelum data
  //     pribadi agar "Berapa denda kerusakan ringan?" tidak dijawab sebagai
  //     denda pribadi pengguna yang sedang login.
  if (isFineRateQuery(query)) {
    return "FINE_RATE";
  }

  // 3. Ringkasan buku tertentu.
  if (BOOK_SUMMARY.test(q) && BOOK_SUMMARY_OBJECT.test(q)) {
    return "BOOK_SUMMARY";
  }

  // 4. Data pribadi (peminjaman aktif, riwayat, denda).
  const personal = detectPersonalIntent(query);
  if (personal) {
    return personal;
  }

  // 4a. Pertanyaan tentang tugas/kemampuan ADMIN (bukan tugas pengguna
  // sendiri). Dicek SEBELUM MY_CAPABILITIES agar "Saya admin, apa tugas admin?"
  // tidak salah diarahkan ke kemampuan pengguna sendiri.
  if (isAdminCapabilityQuery(query)) {
    return "ADMIN_CAPABILITIES";
  }

  // 4a-2. Tugas/kewajiban/peran/hak akses pengguna SENDIRI → jawaban deterministik
  //     per role. Dicek setelah ADMIN_CAPABILITIES agar tidak menangkap pertanyaan
  //     tentang admin yang mengandung "saya".
  if (isMyRoleCapabilityQuery(query)) {
    return "MY_CAPABILITIES";
  }

  // 4b-2. Pengaturan sistem (khusus Admin). Dicek lebih awal karena kata
  // "tersedia" bisa memicu intent CATALOG.
  if (isSystemSettingsQuery(query)) {
    return "SYSTEM_SETTINGS";
  }

  // 4c. Jumlah pengguna secara agregat (mis. "berapa jumlah pengguna terdaftar?").
  if (isAggregateUserCountQuery(query)) {
    return "USER_COUNT";
  }

  // 4d. Data operasional / denda pihak ketiga (mis. "siapa yang memiliki denda
  //     keterlambatan?"). TIDAK boleh dijawab memakai intent data pribadi
  //     pengguna yang sedang login.
  if (
    isOperationalDataQuery(query) ||
    isOtherUserDataRequest(query) ||
    isOtherUserActivityQuery(query) ||
    isNamedThirdPartyDataRequest(query) ||
    isBorrowsByDateQuery(query) ||
    isReturnsByDateQuery(query) ||
    isOperationalTransactionStatsQuery(query) ||
    isLateReturnedPhysicalQuery(query) ||
    isGlobalReadingActivityQuery(query)
  ) {
    return "OPERATIONAL";
  }

  // 4d-2. Permintaan data pihak ketiga yang AMBIGU (nama huruf kecil/KAPITAL/
  //       campuran, mis. "denda budi berapa", "riwayat peminjaman BUDI",
  //       "buku apa yang dipinjam budi"). Kapitalisasi tidak dianggap bukti pasti
  //       nama orang; pipeline memberi KLARIFIKASI netral sebelum mengambil data
  //       sensitif, sehingga tidak pernah dijawab dari riwayat/denda penanya dan
  //       tidak menolak pencarian katalog yang sah.
  if (isAmbiguousThirdPartyQuery(query)) {
    return "CLARIFY";
  }

  // 4e. Daftar identitas pengguna (bukan koleksi buku, bukan jumlah agregat).
  if (isUserDirectoryListQuery(query) || isUserDirectoryQuery(query)) {
    return "USER_DIRECTORY";
  }

  // 4f. Pertanyaan KATEGORI koleksi ("kategori apa saja yang ada?",
  //     "kalau kategori sejarah?", "berapa buku per kategori?"). Dijawab
  //     deterministik dari tabel Category + Book, bukan dari model. Pertanyaan
  //     konseptual ("apa itu kategori?") tetap jalur pembelajaran.
  if (/\b(kategori|category)\b/.test(q) && !CONCEPTUAL_QUESTION.test(q)) {
    return "STATS";
  }

  // 5. Statistik koleksi katalog.
  // Tangkap pertanyaan jumlah/stok koleksi buku, termasuk redaksi sehari-hari
  // ("bukunya ada brp?", "stok bukunya berapa?") yang setelah normalisasi
  // memuat kata tanya dan kata benda koleksi.
  if (
    (/\b(berapa|jumlah|total|banyak|how\s+many)\b/.test(q) &&
      /\b(buku(?:nya)?|ebook|judul|eksemplar|stok(?:nya)?|koleksi|perpustakaan)\b/.test(q)) ||
    (/\b(stok(?:nya)?|persediaan|ketersediaan)\b/.test(q) &&
      /\b(buku(?:nya)?|ebook|judul|eksemplar|koleksi|perpustakaan)\b/.test(q))
  ) {
    return "STATS";
  }

  // 6. Panduan penggunaan sistem perpustakaan DigiLib.
  if (isLibraryGuideRequest(query)) {
    return "LIBRARY_GUIDE";
  }

  // 7. Sapaan / terima kasih / pertanyaan kemampuan bot.
  if (GREETING.test(q) || THANKS.test(q) || CAPABILITY.test(q)) {
    return "CHITCHAT";
  }

  // 8. Permintaan di luar lingkup berbahaya, atau pengetahuan umum terkini
  //    (mis. "siapa presiden Indonesia sekarang?") yang tidak dapat dijawab
  //    dari database/sistem DigiLib. Ditolak deterministik, bukan ditebak model.
  if (isClearlyOutOfScope(query) || isCurrentAffairsQuery(query)) {
    return "OUT_OF_SCOPE";
  }

  // 9. Permintaan tugas akademik, PR, ujian, pembuatan esai/makalah.
  if (isAcademicTaskRequest(query)) {
    return "OUT_OF_SCOPE";
  }

  // 10. Permintaan source code / pembuatan program.
  if (isCodingRequest(query)) {
    return "CODING";
  }

  // 10c. Pertanyaan definisi/konsep ("apa itu buku digital?") adalah edukatif,
  //      bukan permintaan data katalog. Dicek setelah CODING agar pertanyaan
  //      pemrograman tetap ditolak sebagai CODING.
  if (CONCEPTUAL_QUESTION.test(q)) {
    return "LEARNING";
  }

  // 10b. Permintaan EKSPLISIT kedua format → CATALOG, agar resolver format
  //      mengembalikan ALL dan jawaban disusun dalam dua bagian.
  if (isMixedFormatCatalogQuery(query)) {
    return "CATALOG";
  }

  // 11. EBOOK CATALOG — permintaan eksplisit katalog ebook/buku digital.
  //     Dicek SEBELUM buku fisik agar "ebook" eksplisit tidak jatuh ke buku fisik.
  if (isEbookCatalogQuery(query)) {
    return "EBOOK_CATALOG";
  }

  // 11b. BOOK PHYSICAL eksplisit — permintaan eksplisit buku fisik/cetak.
  if (isExplicitPhysicalBookQuery(query)) {
    return "BOOK_PHYSICAL";
  }

  // 11c. Follow-up katalog berdasarkan kelas/jurusan (dengan riwayat).
  //     Dicek SEBELUM buku fisik implisit agar follow-up "Yang untuk kelas 11?"
  //     kembali ke CATALOG umum, bukan BOOK_PHYSICAL.
  if (hasHistory && CATALOG_DIMENSION.test(q) && !LEARNING.test(q)) {
    return "CATALOG";
  }

  // 11d. BOOK PHYSICAL implisit — default untuk pertanyaan katalog buku tanpa
  //      penyebutan eksplisit format digital. Default ke buku fisik.
  if (isImplicitPhysicalBookQuery(query)) {
    return "BOOK_PHYSICAL";
  }

  // 13. Pertanyaan lanjutan materi pembelajaran sebelumnya.
  if (FOLLOW_UP.test(q) && hasHistory) {
    return "LEARNING";
  }

  // Pertanyaan edukatif/penjelasan umum yang menyebut "buku" sebagai topik
  // (mis. manfaat membaca buku) bukan pencarian katalog, selama tidak ada
  // sinyal aksi katalog.
  if (
    /\b(jelaskan|jelask|jelas|uraikan|sebutkan)\b/.test(q) &&
    /\b(manfaat|pentingnya|tujuan|dampak|keuntungan|alasan|mengapa\s+perlu|kenapa\s+perlu|hikmah|fungsi)\b/.test(q) &&
    !/\b(cari|carikan|rekomendasi|rekomendasikan|tersedia|stok|ada\s+(buku|ebook|judul|koleksi)|berapa|jumlah|daftar|tampilkan|koleksi\s+apa|buku\s+apa\s+saja|judul|penulis|penerbit|isbn|pinjam|peminjaman|katalog)\b/.test(q)
  ) {
    return "LEARNING";
  }

  // 14. Pertanyaan katalog atau koleksi buku/ebook (fallback untuk kompatibilitas).
  if (CATALOG.test(q)) {
    return "CATALOG";
  }

  // 15. Pembelajaran materi sekolah SMK.
  if (LEARNING.test(q)) {
    return "LEARNING";
  }

  // 16. Menyebut kelas/jurusan tanpa kata kunci katalog eksplisit.
  if (CATALOG_DIMENSION.test(q)) {
    return "CATALOG";
  }

  return "CHITCHAT";
}

/**
 * Ambil N pesan terakhir sebagai konteks, selalu menyisakan pesan terakhir
 * (pesan pengguna yang sedang diproses).
 */
export function selectHistory(messages: AIChatMessage[]): AIChatMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) {
    return messages;
  }
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

/**
 * Validasi bentuk payload chat. Mengembalikan pesan error dalam Bahasa
 * Indonesia, atau null bila valid.
 */
export function validateChatPayload(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "Pesan tidak boleh kosong. Tulis pertanyaan Anda terlebih dahulu.";
  }

  for (const m of messages as AIChatMessage[]) {
    if (typeof m?.content !== "string" || typeof m?.role !== "string") {
      return "Format percakapan tidak valid.";
    }
    // Hanya user/assistant yang sah. Peran "system" ditolak agar klien tidak
    // bisa menyuntikkan instruksi yang menimpa system prompt server.
    if (!ALLOWED_HISTORY_ROLES.has(m.role)) {
      return "Format percakapan tidak valid.";
    }
    // Batas panjang hanya untuk pesan pengguna. Balasan asisten boleh panjang
    // (mis. daftar rekomendasi) dan tetap sah sebagai riwayat percakapan.
    if (m.role === "user" && m.content.length > MAX_MESSAGE_LENGTH) {
      return `Pesan terlalu panjang. Maksimal ${MAX_MESSAGE_LENGTH} karakter per pesan.`;
    }
  }

  const last = (messages as AIChatMessage[])[messages.length - 1];
  if (last.role !== "user") {
    return "Format percakapan tidak valid.";
  }
  if (last.content.trim().length === 0) {
    return "Pesan tidak boleh kosong. Tulis pertanyaan Anda terlebih dahulu.";
  }

  return null;
}
