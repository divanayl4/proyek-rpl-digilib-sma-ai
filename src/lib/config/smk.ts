/**
 * Kurikulum SMK – Referensi terpusat untuk kelas, mata pelajaran, dan jurusan.
 *
 * Modul ini murni data + helper (tanpa dependensi Node/browser) sehingga bisa
 * dipakai oleh seed, API, dan komponen UI sekaligus.
 *
 * PENTING soal ekstensibilitas:
 * - Daftar di bawah hanyalah SARAN untuk kolom input (datalist) dan untuk
 *   mengisi katalog awal. Nilai mata pelajaran/jurusan disimpan sebagai teks
 *   bebas di database, jadi Admin/Pustakawan bisa menambahkan jurusan atau
 *   mapel BARU tanpa mengubah kode ini.
 * - Opsi filter di UI diambil dari data buku yang ada di database, bukan dari
 *   daftar statis ini.
 */

export const GRADE_LEVELS = ["X", "XI", "XII"] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

export function isValidGrade(value: string): value is GradeLevel {
  return (GRADE_LEVELS as readonly string[]).includes(value);
}

/** Mata pelajaran umum (wajib) untuk semua jurusan SMK. */
export const GENERAL_SUBJECTS: string[] = [
  "Pendidikan Agama dan Budi Pekerti",
  "Pendidikan Pancasila",
  "Bahasa Indonesia",
  "Matematika",
  "Bahasa Inggris",
  "Pendidikan Jasmani, Olahraga, dan Kesehatan",
  "Sejarah",
  "Seni Budaya",
  "Informatika",
];

export interface SmkMajor {
  /** Kode singkat jurusan, mis. "RPL". */
  code: string;
  /** Nama konsentrasi keahlian. */
  name: string;
  /** Bidang/program keahlian induk. */
  field: string;
  /** Mata pelajaran kejuruan khas jurusan ini. */
  subjects: string[];
}

/** Jurusan / konsentrasi keahlian SMK beserta mata pelajaran kejuruannya. */
export const SMK_MAJORS: SmkMajor[] = [
  {
    code: "RPL",
    name: "Rekayasa Perangkat Lunak",
    field: "Teknologi Informasi",
    subjects: [
      "Pemrograman Dasar",
      "Basis Data",
      "Pemrograman Web dan Perangkat Bergerak",
      "Pemrograman Berorientasi Objek",
      "Rekayasa Perangkat Lunak",
    ],
  },
  {
    code: "TKJ",
    name: "Teknik Komputer dan Jaringan",
    field: "Teknologi Informasi",
    subjects: [
      "Jaringan Dasar",
      "Administrasi Sistem Jaringan",
      "Teknologi Jaringan Berbasis Luas",
      "Keamanan Jaringan",
    ],
  },
  {
    code: "DKV",
    name: "Desain Komunikasi Visual",
    field: "Teknologi Informasi",
    subjects: [
      "Desain Grafis Percetakan",
      "Desain Media Interaktif",
      "Fotografi",
      "Videografi",
      "Animasi 2D dan 3D",
    ],
  },
  {
    code: "TEI",
    name: "Teknik Elektronika Industri",
    field: "Teknologi Manufaktur dan Rekayasa",
    subjects: [
      "Dasar-Dasar Elektronika",
      "Sistem Pengendalian Elektronik",
      "Pemrograman Mikrokontroler",
      "Instalasi Sistem Kendali",
    ],
  },
  {
    code: "TKRO",
    name: "Teknik Kendaraan Ringan Otomotif",
    field: "Teknologi Manufaktur dan Rekayasa",
    subjects: [
      "Teknologi Dasar Otomotif",
      "Pemeliharaan Mesin Kendaraan Ringan",
      "Pemeliharaan Sasis dan Pemindah Tenaga",
      "Pemeliharaan Kelistrikan Kendaraan Ringan",
    ],
  },
  {
    code: "TP",
    name: "Teknik Pemesinan",
    field: "Teknologi Manufaktur dan Rekayasa",
    subjects: [
      "Teknologi Dasar Pemesinan",
      "Teknik Gambar Manufaktur",
      "Pemrograman CNC",
      "Pekerjaan Mesin Bubut",
    ],
  },
  {
    code: "TITL",
    name: "Teknik Instalasi Tenaga Listrik",
    field: "Teknologi Manufaktur dan Rekayasa",
    subjects: [
      "Instalasi Listrik Dasar",
      "Instalasi Motor Listrik",
      "Instalasi Penerangan",
      "Sistem Kendali Elektromagnetik",
    ],
  },
  {
    code: "TAV",
    name: "Teknik Audio Video",
    field: "Teknologi Manufaktur dan Rekayasa",
    subjects: [
      "Dasar Elektronika Audio Video",
      "Pemeliharaan Peralatan Audio Video",
      "Teknik Penerimaan Siaran",
      "Sistem Audio Video",
    ],
  },
  {
    code: "AKL",
    name: "Akuntansi dan Keuangan Lembaga",
    field: "Bisnis dan Manajemen",
    subjects: [
      "Akuntansi Dasar",
      "Praktikum Akuntansi Perusahaan Jasa, Dagang, dan Manufaktur",
      "Perpajakan",
      "Komputer Akuntansi",
      "Ekonomi Bisnis",
    ],
  },
  {
    code: "MPLB",
    name: "Manajemen Perkantoran dan Layanan Bisnis",
    field: "Bisnis dan Manajemen",
    subjects: [
      "Manajemen Perkantoran",
      "Teknologi Perkantoran",
      "Administrasi Umum",
      "Korespondensi",
      "Komunikasi Bisnis",
    ],
  },
  {
    code: "PM",
    name: "Pemasaran",
    field: "Bisnis dan Manajemen",
    subjects: [
      "Bisnis Online",
      "Pengelolaan Bisnis Ritel",
      "Administrasi Transaksi",
      "Penataan Produk",
    ],
  },
  {
    code: "KULINER",
    name: "Pengembangan Kulinari",
    field: "Pariwisata",
    subjects: [
      "Pengetahuan Bahan Makanan",
      "Pengolahan Makanan Indonesia",
      "Pengolahan Makanan Kontinental",
      "Produk Pastry dan Bakery",
    ],
  },
  {
    code: "PERHOTELAN",
    name: "Perhotelan",
    field: "Pariwisata",
    subjects: [
      "Front Office",
      "Housekeeping",
      "Food and Beverage Service",
      "Food and Beverage Product",
    ],
  },
  {
    code: "BUSANA",
    name: "Tata Busana",
    field: "Seni dan Ekonomi Kreatif",
    subjects: [
      "Pembuatan Pola",
      "Teknologi Menjahit",
      "Pembuatan Busana",
      "Desain Busana",
    ],
  },
  {
    code: "ATPH",
    name: "Agribisnis Tanaman Pangan dan Hortikultura",
    field: "Agribisnis dan Agriteknologi",
    subjects: [
      "Dasar-Dasar Agribisnis Tanaman",
      "Agribisnis Tanaman Pangan",
      "Agribisnis Tanaman Hortikultura",
      "Pembiakan Tanaman",
      "Pengelolaan Tanah dan Air",
    ],
  },
];

/** Semua mata pelajaran (umum + kejuruan), unik dan terurut. */
export const ALL_SUBJECTS: string[] = Array.from(
  new Set([
    ...GENERAL_SUBJECTS,
    ...SMK_MAJORS.flatMap((major) => major.subjects),
  ])
).sort((a, b) => a.localeCompare(b, "id"));

/** Nama semua jurusan/konsentrasi keahlian. */
export const MAJOR_NAMES: string[] = SMK_MAJORS.map((major) => major.name).sort(
  (a, b) => a.localeCompare(b, "id")
);

/** Kode semua jurusan. */
export const MAJOR_CODES: string[] = SMK_MAJORS.map((major) => major.code);

/** Bidang/program keahlian. */
export const MAJOR_FIELDS: string[] = Array.from(
  new Set(SMK_MAJORS.map((major) => major.field))
).sort((a, b) => a.localeCompare(b, "id"));

export function findMajorByName(name: string | null | undefined): SmkMajor | undefined {
  if (!name) return undefined;
  const target = name.trim().toLowerCase();
  return SMK_MAJORS.find(
    (major) =>
      major.name.toLowerCase() === target || major.code.toLowerCase() === target
  );
}

/** Label jurusan yang enak dibaca, mis. "RPL – Rekayasa Perangkat Lunak". */
export function formatMajorLabel(name: string | null | undefined): string {
  if (!name) return "";
  const major = findMajorByName(name);
  return major ? `${major.code} – ${major.name}` : name;
}