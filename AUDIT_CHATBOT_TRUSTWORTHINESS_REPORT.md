# Laporan Audit & Perbaikan Chatbot DigiLib SMA AI

**Tanggal:** 13 November 2026
**Lokasi kerja:** `D:\Downloads\laragon\www\digilib-sma-ai`
**Sifat pekerjaan:** perbaikan lokal pada kode chatbot; **tidak ada perubahan database, skema, data, atau konfigurasi provider/model AI**.
**Repository:** bukan Git repo, sehingga seluruh perubahan bersifat lokal dan belum di-commit.
**Snapshot pemulihan:** `C:\Users\HYPE\AppData\Local\Temp\opencode\digilib-snapshot-20261113.zip` (src, scripts, skema, salinan `dev.db`, package.json, laporan ini). Database tidak diubah; snapshot disediakan sebagai titik pemulihan.

---

## 1. Tujuan Audit

Memastikan chatbot DigiLib:

1. memahami pertanyaan formal, informal, singkat, dan lanjutan;
2. menjawab data internal **hanya dari database** (buku, pengguna, peminjaman, denda, statistik);
3. membedakan sumber jawaban: database, informasi sistem, pengetahuan umum, atau di luar cakupan;
4. tidak mengarang angka/nama/judul saat data kosong atau query gagal;
5. menjaga RBAC dan isolasi sesi;
6. menolak pertanyaan di luar cakupan secara jujur.

---

## 2. Kondisi Data Aktual (Ground Truth)

Diambil langsung dari `prisma/dev.db` sebelum dan sesudah perbaikan:

| Data | Nilai aktual |
|---|---|
| Pengguna | **8** - Andi (ADMIN), Endi (LIBRARIAN), Guru (TEACHER), Staf Tata Usaha (STAFF), Siswa Rajin, Bela Nuraini, Najla, Marza Bulan (STUDENT) |
| Buku | **5 baris**; **4 judul aktif** (2 buku fisik: Bumi Manusia stok 5, Fisika Dasar untuk SMA stok 10; 2 ebook aktif); 1 ebook arsip |
| Kategori | **10** kategori; tidak ada kategori "Sejarah" |
| Peminjaman | **20** baris; **0 peminjaman aktif**; 17 RETURNED; 3 baris `returnDate = null` berstatus **REJECTED** (bukan pinjaman aktif) |
| Denda | **5 catatan, total Rp166.000, seluruhnya PAID**; outstanding **Rp0** |
| Peminjaman ebook | 18 transaksi; 0 masa akses aktif |
| Sesi baca | 6 |
| Audit log | 235 |

Catatan penting: query peminjaman aktif **tidak boleh** memakai `returnDate: null` saja, karena 3 baris REJECTED juga memiliki `returnDate: null`. Status aktif yang benar adalah `BORROWED`/`OVERDUE` untuk buku fisik dan `returnedAt: null` + `expiresAt > now` untuk ebook.

---

## 3. Akar Masalah yang Ditemukan dan Perbaikannya

| # | Akar masalah | Dampak | Perbaikan |
|---|---|---|---|
| 1 | Kata ganti informal (`gue`, `gw`, `gua`, `ane`) tidak dinormalisasi | "buku yang lagi gue pinjam" dianggap pihak ketiga -> klarifikasi salah | `normalizeQuery()` memetakan ke `saya` (`intent.ts`) |
| 2 | `meminjam`/`dipinjam` tidak masuk konteks transaksi | "Siapa yang sedang meminjam?" jatuh ke jalur model dan bisa 502 | `LOAN_CONTEXT_NOUN` + `LOAN_VERB_NOUN` + `CURRENT_TIME_CUE` (`intent.ts`) |
| 3 | Kata "mempunyai/memiliki/terkena" dianggap nama orang | "Siapa yang mempunyai denda?" -> klarifikasi pihak ketiga yang salah | `NAMED_THIRD_PARTY_STOPWORDS` diperluas (`intent.ts`) |
| 4 | Pertanyaan kategori tidak punya jalur deterministik | Daftar kategori dijawab model, bukan tabel `Category` | Kategori (non-konseptual) diarahkan ke `STATS` (`intent.ts`) |
| 5 | Kata tanya/penanda waktu dianggap kata kunci judul | "Apakah buku Bumi Manusia tersedia?" mencari judul "apakah bumi manusia"; "Sekarang buku apa saja?" mencari "sekarang"; "Berapa jumlahnya?" mencari "jumlahnya" | `STOPWORDS` katalog diperluas (`catalog.ts`) |
| 6 | Follow-up hitung tidak mewarisi topik/format | "Berapa jumlahnya?" setelah daftar ebook bisa dijawab sebagai buku fisik | `mergeCatalogQuery()` mewarisi topik/format; `COUNT_QUERY` dinormalisasi ke huruf kecil (`catalog.ts`) |
| 7 | Follow-up hitung mewarisi kata "tersedia" | "Buku apa saja yang tersedia?" + "Berapa jumlahnya?" dijawab **15 eksemplar**, padahal yang diminta jumlah judul | Kata ketersediaan tidak diwariskan untuk follow-up hitung murni (`catalog.ts`) |
| 8 | Kata urutan tidak dianggap filler lanjutan | "Yang paling lama siapa?" dianggap topik baru | `FOLLOW_UP_FILLER` diperluas (`contextResolver.ts`) |
| 9 | "Paling lama" dianggap peringkat peminjam | Pertanyaan urutan salah diarahkan ke ranking | "terlama" dihapus dari `isBorrowerRankingQuery` (`intent.ts`) |
| 10 | Urutan "paling lama" dihitung dari teks tanggal yang sudah diformat | Rawan salah urut dan bergantung format | Argumen tool `order: "EARLIEST"` -> `borrowDate: asc` / `borrowedAt: asc` di database (`tools.ts`, `pipeline.ts`) |
| 11 | Pertanyaan pengetahuan umum terkini dijawab model tanpa penanda sumber | "Siapa presiden Indonesia sekarang?" dijawab seolah-olah relevan dengan DigiLib | Guard sempit `isCurrentAffairsQuery()` -> `OUT_OF_SCOPE`; pertanyaan sejarah/konseptual tetap `LEARNING` (`intent.ts`) |
| 12 | Header daftar katalog tidak menyebut kata kunci | Sulit membedakan hasil filter dari seluruh koleksi | Header "Ditemukan N judul ... untuk label" (`catalogAnswer.ts`) |
| 13 | Pertanyaan identitas peran ("Siapa administrator?", "Siapa guru?") tidak punya jalur direktori yang konsisten | Ditolak/klarifikasi padahal data ada | Alternatif regex `USER_DIRECTORY` + pemisahan filter kelas dari kata kunci (`intent.ts`, `pipeline.ts`) |
| 14 | Filter kelas ikut menjadi kata kunci pencarian direktori | "Siapa saja siswa kelas XII IPA 1?" -> "Tidak ada pengguna yang cocok" | `removeClassTokensFromSearch()` (`pipeline.ts`) |
| 15 | Statistik operasional tidak menyebut periode | "Berapa transaksi peminjaman bulan Oktober?" tidak menjelaskan cakupan bulan | Label periode disertakan: "Total transaksi pada Oktober 2026: ..." (`pipeline.ts`) |
| 16 | Kata urutan audit dianggap kata kunci nama | "Siapa yang membuat akun terbaru?" mencari pengguna bernama "terbaru" | Stopword audit diperluas (`terbaru`, `terakhir`, `terlama`, `urutkan`, dst.) (`intent.ts`) |
| 17 | Penolakan aktivitas membaca global memakai pesan generik "pengaturan sistem" | Librarian/Pustakawan mendapat alasan yang tidak tepat | `READING_ACTIVITY_ADMIN_ONLY` yang spesifik (`personalAnswer.ts`, `pipeline.ts`) |
| 18 | Fallback provider tidak terlihat oleh pengguna/API | Jawaban NVIDIA tampak seolah-olah berasal dari OpenRouter | Metadata `fallbackUsed`, `primaryProvider`, `primaryModel` + catatan kecil di UI (`index.ts`, `types.ts`, `pipeline.ts`, `AIChatView.tsx`) |
| 19 | "perpus" dianggap kata kunci judul | "brp buku yg ad di perpus?" -> "tidak ada buku perpus ..." | `perpus`/`perpusnya` ditambahkan ke `STOPWORDS` katalog (`catalog.ts`) |
| 20 | Riwayat pribadi per bulan jatuh ke "tidak ada peminjaman aktif" | "pinjaman saya bulan Oktober ada berapa?" tidak menjawab periode yang diminta | `isMyBorrowsByDateQuery` menerima periode; jawaban menghitung fisik + ebook (`intent.ts`, `pipeline.ts`, `personalAnswer.ts`) |

Tidak ada jawaban yang di-hardcode. Semua jawaban data tetap berasal dari query database atau informasi konfigurasi sistem.

---

## 4. Perubahan Berkas

| Berkas | Perubahan |
|---|---|
| `src/lib/ai/intent.ts` | Normalisasi slang; predikat peminjaman aktif; stopword pihak ketiga; routing kategori; guard current affairs; pemisahan ranking; direktori identitas peran; stopword audit; periode riwayat pribadi |
| `src/lib/ai/catalog.ts` | Stopword katalog (termasuk `perpus`); ekstraksi kata kunci; pewarisan topik/format follow-up; metrik hitung; daftar kategori |
| `src/lib/ai/catalogAnswer.ts` | Header daftar dengan label kata kunci |
| `src/lib/ai/contextResolver.ts` | Filler follow-up untuk kata urutan/peringkat |
| `src/lib/ai/pipeline.ts` | Routing direktori + filter kelas; label periode statistik; penolakan aktivitas membaca; metadata fallback; riwayat pribadi per periode |
| `src/lib/ai/personalAnswer.ts` | `READING_ACTIVITY_ADMIN_ONLY`; jawaban jumlah riwayat per periode |
| `src/lib/ai/index.ts` | Dekorasi metadata fallback (`fallbackUsed`, `primaryProvider`, `primaryModel`) |
| `src/lib/ai/types.ts` | Field identitas fallback pada `AIResponseIdentity` |
| `src/lib/ai/tools.ts` | `get_active_loans` mendukung `order: "EARLIEST"`; query direktori/audit |
| `src/components/ai/AIChatView.tsx` | Catatan kecil saat jawaban berasal dari provider cadangan |
| `src/lib/__tests__/ai-intent-audit-fixes.test.ts` | **Baru** - 27+ tes regresi intent, normalisasi, stopword, direktori, audit, current affairs |
| `src/lib/__tests__/ai-pipeline-audit-fixes.test.ts` | **Baru** - tes pipeline deterministik, direktori/kelas, RBAC, denda, urutan, periode pribadi, `perpus` |
| `src/lib/__tests__/ai-request-identity.test.ts` | Ekspektasi metadata fallback |
| `src/lib/__tests__/ai-security-audit.test.ts` | Ekspektasi penolakan aktivitas membaca global yang spesifik |
| `src/lib/__tests__/ai-reading-activity.test.ts` | Ekspektasi penolakan aktivitas membaca global yang spesifik |
| `scripts/e2e-ai-roles-live.mjs` | Uji live 5 peran + matriks RBAC (19 pemeriksaan) |
| `scripts/audit-providers.ts` | Audit koneksi/model provider nyata (tanpa mengubah konfigurasi) |
| `scripts/audit-db-state.ts` | Snapshot ground truth database |
| `scripts/ai-nlu-probe.ts` | Probe 75 percakapan NLU/RBAC |

Tidak ada perubahan pada: `prisma/schema.prisma`, `prisma/dev.db`, konfigurasi provider/model aktif, API key, atau fitur non-chatbot.

---

## 5. Hasil Pengujian

### 5.1 Perintah dan Hasil

```text
npx jest
-> 106 test suite lulus, 1934 tes lulus, 0 gagal

npx tsc --noEmit
-> tidak ada error

npx next lint --max-warnings=0
-> No ESLint warnings or errors

npm run build
-> Compiled successfully (exit 0)
```

### 5.2 Harness 28 Kasus

Harness dijalankan melalui pipeline nyata dengan pengguna dan database aktual:

```text
npx tsx scripts/ai-audit-harness.ts
-> 28/28 kasus sesuai perilaku yang diharapkan
```

Bukti lengkap: `C:\Users\HYPE\AppData\Local\Temp\opencode\audit-final-2.json`

### 5.3 Tabel Bukti per Pertanyaan

Kolom **Tool** menunjukkan jalur deterministik atau `model` untuk pengetahuan umum/konsep.

| Pertanyaan | Intent | Tool | Data aktual | Jawaban chatbot | Hasil |
|---|---|---|---|---|---|
| Siapa saja pengguna? | USER_DIRECTORY | `get_user_directory` | 8 pengguna | Daftar 8 pengguna lengkap dengan role/kelas | Lulus |
| Ada berapa pengguna? | USER_COUNT | `get_user_count` | 8 (1 ADMIN, 1 LIBRARIAN, 1 TEACHER, 4 STUDENT, 1 STAFF) | "Jumlah pengguna terdaftar di DigiLib: **8** pengguna." | Lulus |
| Siapa administrator? | USER_DIRECTORY | `get_user_directory` | Andi (ADMIN) | Daftar berisi Andi (Administrator) | Lulus |
| Berapa jumlah buku? | STATS | `getCatalogStats` | 2 judul buku fisik; 2 ebook; 4 judul total | "Ada 2 judul buku." | Lulus |
| Buku apa yang tersedia? | BOOK_PHYSICAL | `searchCatalogBooks` | Bumi Manusia (5), Fisika Dasar untuk SMA (10) | Daftar 2 judul + stok | Lulus |
| Apakah buku Bumi Manusia tersedia? | BOOK_PHYSICAL | `searchCatalogBooks` | Bumi Manusia stok/tersedia 5 | 1 judul ditemukan, tersedia 5 | Lulus |
| Siapa yang sedang meminjam? | OPERATIONAL | `get_active_loans` | 0 peminjaman aktif; 3 baris REJECTED bukan pinjaman | "Tidak ada buku fisik yang sedang dipinjam ..." | Lulus |
| Siapa yang terlambat mengembalikan? | OPERATIONAL | `get_overdue_borrows` | 0 terlambat | "Tidak ada peminjaman yang sedang terlambat ..." | Lulus |
| Berapa total denda? | OPERATIONAL | `getOperationalStats` | 5 catatan; assessed Rp166.000; paid Rp166.000; sisa Rp0 | "Ada 5 catatan denda ... total Rp166.000 ... sisa Rp0." | Lulus |
| Siapa yang mempunyai denda? | OPERATIONAL | `get_fines_overview` | Guru Rp50.000; Marza Bulan Rp1.000; Najla Rp50.000 + Rp50.000 + Rp15.000; semua lunas | Daftar 5 denda + status lunas | Lulus |
| Model AI apa yang digunakan? | CHITCHAT | Konfigurasi sistem | OPENROUTER `openai/gpt-4o` | "AI yang sedang digunakan: OpenRouter (openai/gpt-4o)." | Lulus |
| Apa yang dimaksud dengan sistem perpustakaan digital? | LEARNING | `model` (pengetahuan konsep) | Tidak ada data internal yang diklaim | Penjelasan konsep perpustakaan digital | Lulus (catatan gaya: model menambahkan tawaran bantuan di akhir) |
| Siapa presiden Indonesia sekarang? | OUT_OF_SCOPE | Guard deterministik | Tidak dapat dijawab dari database/sistem DigiLib | "Maaf, saya hanya dapat membantu seputar perpustakaan DigiLib ..." | Lulus |
| ada brp buku sih | STATS | `getCatalogStats` | 2 judul buku fisik | "Ada 2 judul buku." | Lulus |
| jumlah buku dong | STATS | `getCatalogStats` | 2 judul buku fisik | "Ada 2 judul buku." | Lulus |
| bukunya ada berapa? | STATS | `getCatalogStats` | 2 judul buku fisik | "Ada 2 judul buku." | Lulus |
| siapa aja yang minjem sekarang | OPERATIONAL | `get_active_loans` | 0 peminjaman aktif | "Tidak ada buku fisik yang sedang dipinjam ..." | Lulus |
| ada yang telat balikin? | OPERATIONAL | `get_overdue_borrows` | 0 terlambat | "Tidak ada peminjaman yang sedang terlambat ..." | Lulus |
| kategori apa aja yang ada? | STATS | `getCategoryCounts` | 10 kategori (Buku Referensi ... Pengetahuan Umum) | Daftar 10 kategori + jumlah judul | Lulus |
| buku sejarah ada? | BOOK_PHYSICAL | `searchCatalogBooks` | Tidak ada judul/kategori "Sejarah" | "Maaf, tidak ada buku sejarah yang ditemukan ..." | Lulus |
| total denda yang belum dibayar | OPERATIONAL | `getOperationalStats` | Outstanding Rp0 | "... sudah dibayar Rp166.000; sisa Rp0." | Lulus |
| buku yang lagi gue pinjem apa aja | MY_LOANS | `get_my_loans` | Siswa tersebut tidak punya pinjaman aktif | "Saat ini kamu tidak memiliki buku fisik yang sedang dipinjam." | Lulus |
| berapa ebook yang tersedia | STATS | `getCatalogStats` | 2 judul ebook aktif (1 arsip tidak dihitung) | "Ebook tidak memiliki stok eksemplar; ada 2 judul ebook ..." | Lulus |
| Ada berapa buku? -> Kalau kategori sejarah? | STATS -> STATS | `getCatalogStats` -> `getCategoryCounts` | 2 judul; kategori Sejarah tidak ada | Turn 1: 2 judul; Turn 2: kategori tidak ditemukan + 10 kategori tersedia | Lulus |
| Siapa yang sedang meminjam? -> Yang paling lama siapa? | OPERATIONAL -> OPERATIONAL | `get_active_loans` (order EARLIEST) | 0 peminjaman aktif | Kedua turn: tidak ada peminjaman aktif (urutan tidak relevan karena data kosong) | Lulus |
| Buku apa saja yang tersedia? -> Berapa jumlahnya? | BOOK_PHYSICAL -> CATALOG | `searchCatalogBooks` -> `getCatalogStats` | 2 judul buku fisik | Turn 1: daftar 2 judul; Turn 2: "Ada 2 judul buku." | Lulus |
| Buku apa saja yang tersedia? -> Ada versi ebook? -> Berapa jumlahnya? | BOOK_PHYSICAL -> EBOOK_CATALOG -> EBOOK_CATALOG | `searchCatalogBooks` -> `searchCatalogBooks` (EBOOK) -> `getCatalogStats` | 2 judul ebook | Turn 2: daftar 2 ebook; Turn 3: "Ada 2 judul ebook ..." | Lulus |
| Ada berapa pengguna? -> Sekarang buku apa saja? | USER_COUNT -> BOOK_PHYSICAL | `get_user_count` -> `searchCatalogBooks` | 8 pengguna; 2 judul buku | Turn 1: 8 pengguna; Turn 2: daftar 2 judul buku | Lulus |
| Apakah saya punya denda? -> Kalau pinjaman saya? | MY_FINES -> MY_LOANS | `get_my_fines` -> `get_my_loans` | Siswa: tidak ada denda; tidak ada pinjaman aktif | Turn 1: "Belum ada riwayat denda tercatat."; Turn 2: "Saat ini kamu tidak memiliki peminjaman aktif." | Lulus |

### 5.4 Uji Live 13 November 2026

**A. Uji peran dan RBAC (`node scripts/e2e-ai-roles-live.mjs`)**

```text
=== 19/19 lulus ===
```

Mencakup: isolasi riwayat siswa A/B, denda guru, transaksi Pustakawan, direktori Admin,
penolakan direktori untuk Pustakawan/Guru/Siswa, penolakan aktivitas membaca global
untuk Pustakawan, akses global Admin, statistik pengguna Admin, STAFF dapat memakai
asisten tetapi ditolak dari statistik pengguna, penolakan data akun lain, penolakan
permintaan kredensial, dan penolakan prompt injection.

**B. Audit provider nyata (`npx tsx scripts/audit-providers.ts`)**

| Provider/model | Sumber | Koneksi | Model list | Catatan |
|---|---|---|---|---|
| OPENROUTER `openai/gpt-4o` | DB aktif | SUCCESS (1.858 ms) | 300 model | Chat/tools nyata gagal **HTTP 402** (kredit) |
| NVIDIA `nvidia/nemotron-3.5-lightning-30b-a3b` | draft | SUCCESS (1.371 ms) | 83 model | Fallback runtime |
| NVIDIA `nvidia/nemotron-3.5-lightning-30b-a3b` | `.env` | SUCCESS (1.012 ms) | 83 model | Fallback runtime |
| GEMINI | - | Tidak diuji | - | Tidak ada API key |
| GROQ | - | Tidak diuji | - | Tidak ada API key |

`RINGKASAN: 6/6 pemeriksaan OK` untuk provider yang memiliki key. Konfigurasi aktif
tidak diubah.

**C. Bukti transparansi fallback (respons API nyata)**

```json
{
  "provider": "NVIDIA",
  "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
  "fallbackUsed": true,
  "primaryProvider": "OPENROUTER",
  "primaryModel": "openai/gpt-4o"
}
```

Jawaban deterministik dari database tidak menyertakan objek `ai` karena tidak memanggil
model; ini disengaja.

**D. Anti-halusinasi dan bahasa sehari-hari (live)**

| Pertanyaan | Jawaban aktual | Penilaian |
|---|---|---|
| Apakah buku Harry Potter tersedia? | "tidak ada buku harry potter yang ditemukan di katalog" | Tidak mengarang |
| Siapa kepala sekolah SMA ini? | Menolak: tidak memiliki informasi kepala sekolah | Di luar data, jujur |
| Berapa peminjaman bulan Desember 2030? | "Ada 0 transaksi ..." | Kosong, bukan tebakan |
| Siapa yang meminjam buku pada 1 Januari 2025? | "Tidak ada transaksi ... pada 1 Januari 2025" | Kosong, bukan tebakan |
| brp buku yg ad di perpus? | "Ada 2 judul buku." | Istilah "perpus" tidak lagi jadi kata kunci |
| pinjeman aku bln Oktober ada brp? | "Total transaksi peminjamanmu pada Oktober 2026: **9** transaksi (4 buku fisik + 5 ebook)." | Periode dijawab benar |
| Ebook apa yang terakhir saya baca bulan ini? | "Belum ada aktivitas membaca ebook ..." | Sumber sesi baca, bukan pinjaman |
| Aktivitas membaca ebook bulan ini (Admin) | Daftar sesi nyata + "Total 1 sesi." | Data global hanya Admin |
| Berapa transaksi peminjaman bulan Oktober? | "Total transaksi pada Oktober 2026: 35 ... (18 buku fisik + 17 ebook)." | Label periode + angka DB |

---

## 6. Pemisahan Sumber Jawaban

| Kategori | Contoh | Perilaku |
|---|---|---|
| Dari database | Buku, pengguna, peminjaman, denda, kategori | Dijawab deterministik; `verified: true`; angka/nama dari query |
| Dari informasi sistem | Model/provider AI yang aktif | Dijawab dari konfigurasi, bukan tebakan |
| Pengetahuan umum/konsep | "Apa itu perpustakaan digital?" | Dijawab model; bukan data internal; `verified: false` |
| Di luar cakupan | "Siapa presiden Indonesia sekarang?" | Ditolak deterministik dengan pesan lingkup |
| Perlu klarifikasi | Permintaan data pihak ketiga yang ambigu | Klarifikasi netral sebelum data sensitif diambil |
| Query gagal vs kosong | DB error vs hasil kosong | Error -> pesan "data belum dapat diakses"; kosong -> "tidak ada" (tidak disamarkan) |

---

## 7. RBAC dan Isolasi Sesi

| Peran | Asisten AI | Direktori pengguna | Statistik/operasional | Aktivitas membaca global | Data pribadi |
|---|---|---|---|---|---|
| ADMIN | Boleh | Boleh (daftar lengkap) | Boleh | Boleh | Milik sendiri; data pihak ketiga sesuai kewenangan |
| LIBRARIAN | Boleh | Dibatasi (jumlah/agregat, bukan daftar identitas) | Boleh | **Ditolak** (khusus Admin) | Milik sendiri; denda/pinjaman pihak ketiga ditolak |
| TEACHER | Boleh | Ditolak | Ditolak | Ditolak | Hanya milik sendiri |
| STUDENT | Boleh | Ditolak | Ditolak | Ditolak | Hanya milik sendiri |
| STAFF | Boleh (peran sah) | Ditolak | Ditolak | Ditolak | Hanya milik sendiri |

- Semua query personal memakai `userId` dari sesi, bukan dari teks pengguna.
- Riwayat percakapan hanya dipakai untuk memahami maksud; setiap fakta tetap diambil ulang dari database.
- Penolakan terjadi **sebelum** query data sensitif; diuji di unit test dan 19 pemeriksaan live.
- STAFF bukan lagi diperlakukan sebagai peran terlarang; yang ditolak adalah data operasional/direktori/pengaturan, bukan akses chatbot.

---

## 8. Risiko Lingkungan yang Masih Ada

1. **OpenRouter HTTP 402 (kuota/kredit).** Provider utama `OPENROUTER (openai/gpt-4o)` lolos uji koneksi singkat tetapi **gagal pada chat/tools nyata dengan HTTP 402**. Jawaban jalur model berasal dari fallback **NVIDIA `nvidia/nemotron-3.5-lightning-30b-a3b`**. Konfigurasi aktif tidak diubah sesuai instruksi. API kini menandai `fallbackUsed: true`, `primaryProvider`, dan `primaryModel`, dan UI menampilkan catatan kecil; fallback tidak lagi tampak sebagai keberhasilan provider utama.
2. **GEMINI dan GROQ tidak dapat diuji.** Tidak ada API key tersimpan untuk kedua provider tersebut, sehingga statusnya "tidak dapat diuji", bukan "berhasil".
3. **Jalur model tetap probabilistik.** Pertanyaan konsep/pengetahuan umum dapat menambahkan kalimat tawaran bantuan meskipun prompt gaya melarang. Isi fakta data internal tidak melewati jalur ini.
4. **Data "0 peminjaman aktif"** membuat beberapa follow-up (mis. "Yang paling lama siapa?") tidak bisa menunjukkan urutan secara nyata. Perilaku `order: "EARLIEST"` sudah diuji unit dengan data mock dan diteruskan ke query database.
5. **Metadata intent aktivitas membaca global Admin** masih dilaporkan sebagai `MY_HISTORY`, meskipun isi jawabannya adalah data global yang benar. Ini kosmetik pada metadata API (tidak ditampilkan di UI) dan tidak memengaruhi fakta jawaban.

---

## 9. Cara Reproduksi

```bash
npx jest
npx tsc --noEmit
npx next lint --max-warnings=0
npm run build
npx tsx scripts/ai-audit-harness.ts
npx tsx scripts/audit-providers.ts
npx tsx scripts/audit-db-state.ts
node scripts/e2e-ai-roles-live.mjs   # server harus berjalan
```

Untuk memeriksa intent dan tool secara cepat:

```bash
npx tsx scripts/ai-intent-probe.ts
npx tsx scripts/ai-nlu-probe.ts
```

---

## 10. Kesimpulan

Seluruh pertanyaan audit yang dapat dijawab dari database kini dijawab deterministik dengan data aktual, termasuk variasi informal, singkat, dan lanjutan. Pertanyaan kategori, denda pihak ketiga, peminjaman aktif, dan urutan peminjaman tidak lagi bergantung pada model. Pertanyaan di luar cakupan ditolak secara jujur, dan query gagal dibedakan dari hasil kosong.

**Status akhir (13 November 2026):** 106 suite / **1934 tes lulus**; TypeScript, lint, dan build bersih; uji live 5 peran **19/19 lulus**; audit provider **6/6 pemeriksaan OK** untuk provider yang memiliki key; harness 28/28 kasus sesuai perilaku yang diharapkan. Tidak ada perubahan database, skema, data, atau konfigurasi provider/model.
