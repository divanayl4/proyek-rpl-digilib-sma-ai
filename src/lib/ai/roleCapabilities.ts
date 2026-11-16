/**
 * Modul kendali kemampuan dan tugas berdasarkan role pengguna di DigiLib.
 *
 * Aturan Otorisasi Role (Akses Informasi Role):
 * 1. Administrator: Boleh mendapatkan penjelasan mengenai tanggung jawab dan fungsi
 *    semua role di aplikasi (ADMIN, LIBRARIAN, TEACHER, STUDENT, STAFF).
 * 2. Guru: Hanya boleh mendapatkan penjelasan mengenai tugas, hak, dan fitur role guru.
 *    Pertanyaan tentang role lain ditolak secara deterministik.
 * 3. Siswa: Hanya boleh mendapatkan penjelasan mengenai tugas, hak, dan fitur role siswa.
 *    Pertanyaan tentang role lain ditolak secara deterministik.
 * 4. Pustakawan: Hanya boleh mendapatkan penjelasan mengenai tugas, fungsi, dan fitur role pustakawan.
 *    Pertanyaan tentang role lain ditolak secara deterministik.
 * 5. Staf / role lain: Hanya boleh penjelasan role akunnya sendiri.
 *
 * Penolakan menggunakan pesan singkat yang konsisten:
 * "Maaf, DigiLib Assistant hanya dapat menjelaskan tugas dan fitur yang sesuai dengan role akun Anda."
 */

import { canUseAIAssistant, roleLabel } from "./access";
import { normalizeQuery } from "./intent";

export const ROLE_RESTRICTION_REFUSAL =
  "Maaf, DigiLib Assistant hanya dapat menjelaskan tugas dan fitur yang sesuai dengan role akun Anda.";

export const ROLE_CAPABILITY_UNKNOWN =
  "Maaf, saya belum dapat memverifikasi peran dan hak akses akun Anda, sehingga belum dapat memastikan fitur apa yang tersedia untuk Anda. " +
  "Silakan masuk kembali untuk memuat ulang sesi Anda. Bila masalah berlanjut, hubungi Pustakawan atau Administrator.";

export const ALL_SYSTEM_ROLES = ["ADMIN", "LIBRARIAN", "TEACHER", "STUDENT", "STAFF"] as const;
export type SystemRole = (typeof ALL_SYSTEM_ROLES)[number];

function bullet(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

/**
 * Uraian tanggung jawab, fungsi, hak, dan fitur resmi setiap role di DigiLib.
 * Bersumber langsung dari aturan bisnis dan arsitektur aplikasi aktual.
 */
export const ROLE_DESCRIPTIONS: Record<SystemRole, { title: string; points: string[] }> = {
  STUDENT: {
    title: "Siswa",
    points: [
      "Mencari dan melihat detail buku fisik maupun ebook melalui Katalog DigiLib.",
      "Mengajukan peminjaman buku fisik (maksimal 3 buku, batas waktu 7 hari).",
      "Meminjam dan membaca ebook langsung melalui pembaca PDF in-app (kuota 3 peminjaman ebook per minggu kalender, masa akses 7 hari).",
      "Melacak progres membaca ebook (halaman terakhir dan persentase selesai) serta melanjutkan membaca secara otomatis.",
      "Melihat informasi data pribadi: peminjaman aktif, riwayat peminjaman dan transaksi, tagihan denda keterlambatan/kerusakan, dan notifikasi akun.",
      "Menggunakan DigiLib Assistant untuk mencari buku, mengecek ketersediaan koleksi, dan panduan perpustakaan.",
      "Mengelola profil pribadi dan memverifikasi nomor WhatsApp untuk menerima notifikasi pengingat.",
    ],
  },
  TEACHER: {
    title: "Guru",
    points: [
      "Mencari dan melihat koleksi buku fisik maupun ebook melalui Katalog DigiLib.",
      "Mengajukan peminjaman buku fisik untuk referensi pengajaran (kuota hingga 5 buku, batas waktu 14 hari).",
      "Meminjam dan membaca ebook materi ajar melalui pembaca PDF in-app (kuota 3 peminjaman ebook per minggu kalender, masa akses 7 hari).",
      "Mengakses menu Rekomendasi Buku untuk bahan ajar dan referensi materi kurikulum SMK.",
      "Melihat informasi data pribadi: peminjaman aktif, riwayat transaksi, tagihan denda, dan notifikasi akun.",
      "Menggunakan DigiLib Assistant untuk rekomendasi bahan ajar, informasi koleksi, dan panduan perpustakaan.",
      "Mengelola profil pribadi dan memverifikasi nomor WhatsApp untuk menerima notifikasi.",
    ],
  },
  LIBRARIAN: {
    title: "Pustakawan",
    points: [
      "Mengelola katalog perpustakaan: menambah buku/ebook baru, memperbarui metadata, mengunggah berkas PDF ebook, dan mengarsipkan koleksi.",
      "Mengelola sirkulasi peminjaman fisik: menyetujui pengajuan peminjaman, menyerahkan buku ke peminjam, dan memproses pengembalian buku.",
      "Memantau daftar buku terlambat dan mengelola pencatatan denda keterlambatan maupun kerusakan.",
      "Mengakses data operasional seluruh transaksi perpustakaan (semua peminjaman buku fisik dan ebook).",
      "Meninjau berkas ebook untuk verifikasi kualitas koleksi melalui fitur Lihat Buku tanpa perlu transaksi peminjaman.",
      "Menggunakan DigiLib Assistant untuk query data operasional transaksi, status keterlambatan, dan denda sistem.",
    ],
  },
  STAFF: {
    title: "Staf",
    points: [
      "Mencari dan melihat koleksi buku fisik dan ebook di Katalog DigiLib.",
      "Meminjam buku fisik untuk keperluan kedinasan/staf sekolah (kuota hingga 5 buku, durasi 14 hari).",
      "Melihat informasi peminjaman aktif dan riwayat transaksi pribadi.",
      "Menggunakan DigiLib Assistant untuk informasi koleksi buku dan panduan umum perpustakaan.",
    ],
  },
  ADMIN: {
    title: "Administrator",
    points: [
      "Khusus Administrator: Mengelola seluruh akun pengguna, registrasi pengguna, pengeditan data, verifikasi role, penonaktifan akun, dan reset password.",
      "Mengakses log audit sistem untuk memantau riwayat pembuatan dan penghapusan akun, serta mutasi akun pengguna.",
      "Memantau dasbor analitik: ringkasan dan statistik jumlah pengguna per role, statistik transaksi operasional, dan grafik aktivitas sistem.",
      "Memantau aktivitas membaca ebook seluruh pengguna melalui panel Aktivitas Membaca Ebook (sesi membaca, durasi, dan progres).",
      "Mengelola pengaturan sistem perpustakaan (misalnya konfigurasi tarif denda keterlambatan per hari).",
      "Mengelola koleksi katalog buku dan sirkulasi transaksi bersama pustakawan.",
    ],
  },
};

/**
 * Deteksi apakah pertanyaan sedang menanyakan tugas/kewajiban/fungsi/peran/fitur dari role tertentu.
 * Mengembalikan target role ('ADMIN' | 'LIBRARIAN' | 'TEACHER' | 'STUDENT' | 'STAFF') atau null.
 */
export function detectRoleInquiryTarget(query: string): SystemRole | null {
  const q = ` ${normalizeQuery(query)} `;

  // Abaikan jika pertanyaan tentang tata cara atau panduan umum
  const isProcedureOrGuide =
    /\b(?:bagaimana\s+cara|gimana\s+cara|cara|prosedur|alur|aturan|syarat)\s+(?:meminjam|pinjam|mengembalikan|kembalikan|baca|membaca|denda|bayar|perpanjang)\b/.test(
      q
    );
  if (isProcedureOrGuide) return null;

  // Abaikan pencarian katalog atau referensi buku
  const isCatalogSearch =
    /\b(?:cari|carikan|rekomendasi|rekomendasikan|temukan|buku\s+tentang|novel\s+tentang)\b/.test(
      q
    );
  if (isCatalogSearch) return null;

  // Abaikan pertanyaan audit riwayat pembuatan/penghapusan akun
  if (/\b(?:dibuat|dihapus|kapan\s+akun|siapa\s+yang\s+menghapus)\b/.test(q)) {
    return null;
  }

  // Kata kunci penanda pertanyaan tentang tugas/peran/fungsi/fitur/wewenang
  const hasCapabilityInquiry =
    /\b(tugas(?:nya)?|kewajiban(?:nya)?|tanggung\s*jawab(?:nya)?|peran(?:nya)?|role(?:nya)?|wewenang(?:nya)?|kewenangan(?:nya)?|hak\s+akses(?:nya)?|hak(?:nya)?|fitur(?:nya)?|fungsi(?:nya)?|kemampuan(?:nya)?|kapabilitas(?:nya)?|pekerjaan(?:nya)?)\b/.test(
      q
    ) ||
    /\b(?:bisa|dapat|boleh|mampu)\s+(?:apa\s+saja|melakukan\s+apa|ngapain\s+aja)\b/.test(q) ||
    /\bapa\s+(?:saja\s+)?yang\s+(?:bisa|dapat|boleh|mampu)\s+dilakukan\b/.test(q) ||
    /\bapa\s+(?:tugas|kewajiban|peran|fungsi|wewenang|tanggung\s*jawab|fitur|hak\s+akses)\b/.test(q) ||
    /\bjelaskan\s+(?:tugas|peran|fungsi|tanggung\s*jawab|wewenang|hak\s+akses|fitur)\b/.test(q);

  if (!hasCapabilityInquiry) return null;

  // Bersihkan klaim peran diri sendiri ("saya admin", "saya pustakawan") agar
  // target peran yang ditanyakan tidak tertukar dengan klaim manipulatif penanya.
  const targetText = q.replace(
    /\b(?:saya|aku|kami)\s+(?:adalah\s+)?(?:admin|administrator(?:\s+sistem)?|pustakawan|petugas|guru|siswa|staf)\b/gi,
    " "
  );

  // Deteksi target role spesifik yang ditanyakan dari teks yang sudah dibersihkan
  const mentionsLibrarian = /\b(pustakawan|petugas\s+perpustakaan|pengelola\s+perpustakaan)\b/.test(targetText);
  const mentionsTeacher = /\b(guru|pengajar|pendidik)\b/.test(targetText);
  const mentionsStudent = /\b(siswa|murid|pelajar|peserta\s+didik)\b/.test(targetText);
  const mentionsStaff = /\b(staf|staff|tata\s+usaha)\b/.test(targetText);
  const mentionsAdmin = /\b(admin|administrator|pengelola\s+sistem)\b/.test(targetText);

  if (mentionsLibrarian) return "LIBRARIAN";
  if (mentionsTeacher) return "TEACHER";
  if (mentionsStudent) return "STUDENT";
  if (mentionsStaff) return "STAFF";
  if (mentionsAdmin) return "ADMIN";

  return null;
}

/**
 * Bangun penjelasan tugas dan fungsi role tertentu untuk pengguna yang berhak.
 */
export function buildRoleExplanation(targetRole: SystemRole, isSelf: boolean): string {
  const roleData = ROLE_DESCRIPTIONS[targetRole];
  if (!roleData) return ROLE_CAPABILITY_UNKNOWN;

  const header = isSelf
    ? `Sebagai ${roleData.title} di DigiLib, berikut tugas, hak, dan fitur yang tersedia untuk akun Anda:`
    : `Berikut tanggung jawab, fungsi, dan fitur untuk peran ${roleData.title} di DigiLib:`;

  return [header, "", bullet(roleData.points)].join("\n");
}

/**
 * Fungsi lama untuk kompatibilitas MY_CAPABILITIES.
 */
export function buildRoleCapabilityAnswer(role: string | null | undefined): string {
  if (!canUseAIAssistant(role)) {
    return ROLE_CAPABILITY_UNKNOWN;
  }
  const target = (role as SystemRole) || "STUDENT";
  if (ROLE_DESCRIPTIONS[target]) {
    return buildRoleExplanation(target, true);
  }
  return buildRoleExplanation("STUDENT", true);
}
