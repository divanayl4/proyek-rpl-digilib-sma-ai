# Perpustakaan Digital SMA — DigiLib SMA

Sistem perpustakaan digital modern untuk Sekolah Menengah Atas, sebagai ekosistem sumber belajar digital berbasis AI untuk lingkungan sekolah, dilengkapi AI Library Assistant, manajemen peminjaman, laporan analitik, dan notifikasi real-time.

---

## 👥 Identitas Pengembang (Tugas RPL)

- **Nama**: Diva Nayla Syifa
- **NIM**: 41257099
- **Kelompok**: Kelompok 2
- **Tema Topik Kelompok**: AI-Based Digital Learning Resource Ecosystem

---

## 🎥 Dokumentasi Video Proyek

- **Video Final**: https://youtu.be/Hp13zL2b070?si=OhIlYbbMvPl9NlbD

---

## 📖 Gambaran Umum

**DigiLib SMA AI** adalah aplikasi perpustakaan digital berbasis web untuk lingkungan sekolah. Aplikasi ini merupakan ekosistem sumber belajar digital berbasis AI yang memungkinkan pustakawan, admin, siswa, guru, dan staf untuk berinteraksi dengan koleksi buku secara digital, mulai dari peminjaman hingga pengembalian, dilengkapi dengan AI yang dapat merekomendasikan buku berdasarkan kebutuhan pengguna.

### Fitur Utama

| Fitur | Status |
|-------|--------|
| 🏠 Landing Page Publik | ✅ Selesai |
| 🔐 Autentikasi & RBAC | ✅ Selesai |
| 📚 Manajemen Katalog Buku | ✅ Selesai |
| 👥 Manajemen Pengguna (Admin) | ✅ Selesai |
| 📋 Sistem Peminjaman & Pengembalian | ✅ Selesai |
| 🤖 AI Library Assistant | ✅ Selesai |
| 📊 Reports & Analytics | ✅ Selesai |
| 🔔 Sistem Notifikasi | ✅ Selesai |

### Fitur AI

- **Chatbot AI (AI Library Assistant)**: Asisten percakapan berbasis web yang membantu pengguna mencari informasi buku, layanan perpustakaan, dan panduan penggunaan aplikasi.
- **Pencarian dan Rekomendasi Buku**: Pencarian buku berdasarkan judul, pengarang, kategori, kelas, mata pelajaran, dan jurusan, serta rekomendasi buku yang relevan dengan kebutuhan pengguna.
- **RAG (Retrieval-Augmented Generation)**: AI mengambil data dari katalog dan database perpustakaan sebelum menjawab, sehingga respons lebih akurat dan sesuai data koleksi sekolah.
- **Integrasi Database**: AI terhubung ke database aplikasi (Prisma/SQLite) untuk membaca data buku, pengguna, peminjaman, dan informasi terkait secara real-time sesuai hak akses.
- **Pembatasan Akses Berdasarkan Role Pengguna**: Fitur dan data yang dapat diakses AI dibatasi sesuai role pengguna (Admin, Pustakawan, Siswa, Guru, Staf) untuk menjaga keamanan dan privasi.

---

## 🛠️ Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Framework | [Next.js 14](https://nextjs.org/) (App Router) |
| Language | TypeScript 5 |
| Database | SQLite (via [Prisma ORM](https://www.prisma.io/)) |
| Auth | [NextAuth.js v4](https://next-auth.js.org/) (JWT Strategy) |
| UI | React 18, Vanilla CSS (Design Tokens) |
| Charts | [Recharts](https://recharts.org/) |
| Icons | [Lucide React](https://lucide.dev/) |
| AI | Multi-provider: NVIDIA NIM, Google Gemini (native), Groq, OpenRouter |
| Testing | Jest + ts-jest |
| Passwords | bcryptjs |

---

## ⚡ Quick Start (Setup Instruction)

### Prasyarat

- Node.js >= 18
- npm >= 9

### Instalasi

```bash
# 1. Clone repository
git clone <repo-url>
cd digilib-sma-ai

# 2. Install dependencies
npm install

# 3. Setup environment variables
cp .env.example .env
# Di Windows PowerShell: Copy-Item .env.example .env
# Edit .env sesuai kebutuhan

# 4. Generate Prisma Client
npx prisma generate

# 5. Setup database (SQLite) — terapkan migrasi
npx prisma migrate deploy
# Alternatif: sinkronkan skema langsung dengan npx prisma db push

# 6. Seed data awal (opsional)
npm run db:seed

# 7. Jalankan development server
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

---

## 🔐 Environment Variables

Buat file `.env` di root project (salin dari `.env.example`). Berikut variabel yang tersedia:

```env
# Database (SQLite)
DATABASE_URL="file:./dev.db"

# NextAuth — WAJIB diganti di production dengan nilai acak yang kuat
# Generate dengan: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
NEXTAUTH_SECRET="your-strong-random-secret-here"
NEXTAUTH_URL="http://localhost:3000"

# AI Provider — konfigurasi utama melalui UI ADMIN "Konfigurasi AI".
# Variabel ini hanya fallback bila BELUM ada konfigurasi aktif di database.
# Provider didukung: NVIDIA NIM, Google Gemini (native), Groq, OpenRouter.
AI_PROVIDER=""
AI_BASE_URL="https://api.openai.com/v1"
AI_MODEL="gpt-4o-mini"
AI_API_KEY=""
AI_FALLBACK_MODELS=""
AI_DISABLE_THINKING="true"

# Kunci enkripsi API key yang disimpan di database (AES-256-GCM).
# WAJIB stabil di production. Jika kosong, NEXTAUTH_SECRET dipakai sebagai
# turunan kunci. Jangan mengganti nilai ini setelah konfigurasi AI disimpan.
AI_CONFIG_ENCRYPTION_KEY=""

# WhatsApp Notification — Fonnte (https://fonnte.com)
# Konfigurasi utama melalui UI ADMIN "Notifikasi WhatsApp".
# Nilai di database menang atas variabel environment di bawah.
# Token hanya dibaca di server dan tidak pernah ditampilkan utuh.
FONNTE_API_TOKEN=""
# Nomor WhatsApp Admin yang menjadi PENGIRIM seluruh notifikasi (08…/62…).
FONNTE_ADMIN_NUMBER=""
# "false" mematikan pengiriman WhatsApp tanpa menghapus token.
FONNTE_ENABLED="true"
```

> **Catatan AI multi-provider:** Konfigurasi yang disimpan dan diaktifkan Admin
> melalui menu **Konfigurasi AI** selalu diprioritaskan di atas `.env`. Bila
> konfigurasi aktif di database rusak, runtime TIDAK diam-diam beralih ke `.env`
> — halaman AI akan menampilkan pesan agar Admin memperbaikinya. Lihat bagian
> [Konfigurasi AI Multi-Provider](#konfigurasi-ai-multi-provider).

> ⚠️ **PENTING**: Jangan pernah commit file `.env` ke version control. Pastikan `.env` ada di `.gitignore`.

> ⚠️ **PRODUCTION**: Nilai `NEXTAUTH_SECRET` yang lemah (`super-secret-key`) hanya boleh untuk development lokal. Wajib diganti sebelum deploy ke production.

---

## Konfigurasi AI Multi-Provider

Menu **Konfigurasi AI** hanya dapat diakses role `ADMIN` (halaman dan seluruh
endpoint API memeriksa sesi di server; role dari body request diabaikan).

### Alur kerja

1. Pilih provider: **NVIDIA NIM**, **Google Gemini**, **Groq**, atau **OpenRouter**.
2. Masukkan API key. Nilai dikirim hanya melalui body request same-origin,
   dienkripsi AES-256-GCM, lalu disimpan terpisah dari konfigurasi publik.
   Bila `AI_API_KEY` pada `.env` sudah valid untuk provider yang sama, Admin
   boleh mengosongkan field ini: server akan mengadopsi key `.env` ke draft
   dalam bentuk terenkripsi (key tetap tidak pernah dikirim ke browser).
3. Isi model utama dan model fallback (opsional).
4. **Simpan Konfigurasi** → hanya menyimpan *draft*; konfigurasi aktif belum berubah.
5. **Uji Koneksi** → satu request minimal ke model utama (tanpa tools/fallback).
6. **Aktifkan Konfigurasi** → server menguji ulang secara live, lalu menyalin
   draft + secret ke konfigurasi aktif dalam satu transaksi. Bila uji gagal atau
   draft berubah, aktivasi dibatalkan dan konfigurasi aktif lama tetap utuh.

Runtime membaca konfigurasi dari database pada **setiap request** (tanpa cache
in-memory), sehingga konfigurasi baru berlaku tanpa restart dan konsisten pada
deployment multi-instance. Satu request AI memakai satu snapshot provider;
perubahan di tengah request tidak mengubah rangkaian tool-calling yang berjalan.

### Diagnostik dan batas waktu

Halaman Konfigurasi AI menampilkan diagnostik yang dibaca server dari database:
ada/tidaknya draft, secret draft, konfigurasi aktif, secret aktif, status uji
terakhir, sumber kunci enkripsi, serta **langkah berikutnya**. Status runtime
(`ENV`/`DATABASE`) berasal dari `getPublicConfigState()`, bukan dari tebakan UI.

Uji koneksi memakai batas waktu tersendiri yang lebih longgar daripada request
biasa. Model reasoning NVIDIA NIM dapat menjawab satu prompt "ping" dalam
~50-60 detik; batas lama 25 detik membuat aktivasi selalu gagal dengan kategori
`TIMEOUT` meskipun API key valid. Default sekarang: request 75 detik, total
120 detik, uji koneksi 90 detik. Ubah lewat `AI_REQUEST_TIMEOUT_MS`,
`AI_TOTAL_BUDGET_MS`, dan `AI_CONNECTION_TEST_TIMEOUT_MS` bila perlu. `TIMEOUT`
tetap **bukan** bukti API key salah dan tidak pernah dipakai untuk mengaktifkan
konfigurasi yang belum tervalidasi.

### Keamanan

- API key tidak pernah dikembalikan ke browser, ditulis ke URL/localStorage,
  atau dimasukkan ke audit log.
- Endpoint provider berasal dari katalog tetap; URL arbitrer tidak diterima
  (mencegah SSRF).
- API key provider lama tidak dipakai ulang saat provider diganti.
- Uji koneksi mengklasifikasikan kegagalan: `AUTH`, `MODEL`, `RATE_LIMIT`,
  `QUOTA`, `NETWORK`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `INVALID_RESPONSE`,
  `INVALID_CONFIG`, `UNKNOWN`. Timeout tidak dilabeli sebagai API key salah.
- `AI_CONFIG_ENCRYPTION_KEY` (atau `NEXTAUTH_SECRET` sebagai fallback) harus
  stabil. Menggantinya membuat secret lama tidak dapat didekripsi; runtime akan
  melaporkan status `INVALID` dan tidak diam-diam memakai `.env`.

### Fallback `.env`

Bila **tidak ada** konfigurasi aktif di database, runtime memakai `AI_*` dari
`.env`. Ini hanya jalur transisi/kompatibilitas. Bila konfigurasi aktif ada
tetapi rusak atau tidak dapat didekripsi, runtime **tidak** memakai `.env`.
Hal yang sama berlaku bila database tidak dapat dibaca: runtime melaporkan
`INVALID` alih-alih diam-diam memakai `.env`.

---

## 🗄️ Database Setup

Aplikasi ini menggunakan **SQLite** via Prisma ORM — tidak memerlukan instalasi database server terpisah.

```bash
# Terapkan migrasi database yang tersedia
npx prisma migrate deploy

# Alternatif: sinkronkan schema ke database (buat tabel & index)
npx prisma db push

# Buka Prisma Studio untuk inspeksi data
npx prisma studio

# Generate Prisma Client setelah mengubah schema
npx prisma generate
```

---

## 🌱 Seed Data

Seed data menyediakan akun default untuk testing:

```bash
npm run db:seed
```

Akun yang dibuat:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@sekolah.id | admin123 |
| Pustakawan | pustakawan@sekolah.id | librarian123 |
| Siswa | siswa@sekolah.id | student123 |
| Guru | guru@sekolah.id | teacher123 |
| Staf | staf@sekolah.id | staff123 |

> 🔒 Ganti semua password default segera setelah setup.

---

## 💻 Development Commands

```bash
npm run dev        # Start development server (http://localhost:3000)
npm run build      # Build production bundle
npm run start      # Start production server
npm run lint       # Run ESLint
npm test           # Run unit tests
npm run test:watch # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

---

## 🧪 Testing

### Status Pengujian Terakhir

- **Test Suites**: 95 test suites passed (100%)
- **Total Tests**: 1.690 tests passed (0 failed)

> ℹ️ **Catatan**: Jumlah 95 test suites dan 1.690 tests passed merupakan hasil pengujian otomatis terakhir pada lingkungan pengembangan saat ini dan dapat berubah seiring penambahan atau penyesuaian skenario uji berikutnya, bukan jaminan statis untuk pengujian di masa depan.

### Menjalankan Tests

```bash
npm test
```

### Struktur Tests

```
src/
├── lib/
│   ├── config/
│   │   └── __tests__/
│   │       └── library.test.ts      # Business rules: fines, due dates, limits
│   └── __tests__/
│       ├── rbac.test.ts             # Authorization logic
│       ├── ai-intent.test.ts        # AI intent detection
│       └── ai-tools.test.ts         # AI tool execution & validation
```

### Apa yang Ditest

- **Business Rules**: Perhitungan denda, due date, batas peminjaman per role, pagination
- **RBAC**: Setiap role hanya bisa melakukan aksi yang diizinkan
- **AI Integration**: Intent detection, fallback provider, enkripsi kredensial, proteksi privilege
- **Privilege Escalation**: Student/Teacher tidak bisa akses admin endpoint

### Menambah Tests Baru

Buat file `*.test.ts` di dalam direktori `__tests__/` di dekat kode yang ditest. Jest akan otomatis menemukannya.

---

## 🚀 Production Deployment

### Checklist Sebelum Deploy

- [ ] `NEXTAUTH_SECRET` diganti dengan nilai kuat (minimal 32 karakter acak)
- [ ] `NEXTAUTH_URL` diisi dengan domain production (`https://domain.anda`)
- [ ] `AI_CONFIG_ENCRYPTION_KEY` diisi dengan nilai acak kuat dan disimpan stabil (atau `NEXTAUTH_SECRET` kuat sebagai fallback)
- [ ] Database di-backup sebelum migrasi
- [ ] `npm run build` sukses tanpa error

### Build Production

```bash
# Build
npm run build

# Jalankan
npm run start
```

### Pertimbangan Production

1. **Database**: SQLite cocok untuk sekolah kecil-menengah. Untuk skala besar, pertimbangkan migrasi ke PostgreSQL atau MySQL (ubah `provider` di `prisma/schema.prisma`).
2. **File Upload**: Saat ini file disimpan di `public/uploads/`. Untuk production, pertimbangkan cloud storage (S3, Cloudinary, dll.).
3. **AI Rate Limiting**: Rate limiting saat ini menggunakan in-memory Map. Pada multi-instance deployment, gunakan Redis.
4. **Cron Jobs**: `processOverdueNotifications()` saat ini dipanggil secara lazy. Untuk production, setup cron job terpisah yang memanggil endpoint internal.

---

## 📁 Struktur Proyek

```
digilib-sma-ai/
├── prisma/
│   ├── schema.prisma          # Database schema + indexes
│   └── seed.ts                # Data seed
├── public/
│   └── uploads/               # File upload directory
├── src/
│   ├── app/
│   │   ├── api/               # API Routes (REST)
│   │   │   ├── admin/         # Admin-only endpoints
│   │   │   ├── ai/            # AI chat endpoint
│   │   │   ├── books/         # Book CRUD
│   │   │   ├── borrows/       # Borrow/Return transactions
│   │   │   ├── categories/    # Category management
│   │   │   ├── notifications/ # Notification endpoints
│   │   │   └── upload/        # File upload
│   │   ├── admin/             # Admin pages
│   │   ├── librarian/         # Librarian pages
│   │   ├── student/           # Student pages
│   │   ├── teacher/           # Teacher pages
│   │   ├── staff/             # Staff pages
│   │   ├── catalog/           # Public catalog
│   │   ├── assistant/         # AI Assistant page
│   │   ├── notifications/     # Notifications page
│   │   └── page.tsx           # Public landing page
│   ├── components/
│   │   ├── layout/            # DashboardLayout, Topbar, Sidebar
│   │   ├── books/             # Book components
│   │   ├── borrows/           # Borrow components
│   │   ├── notifications/     # Notification components
│   │   └── ui/                # Shared UI components
│   ├── lib/
│   │   ├── ai/                # AI provider abstraction
│   │   ├── config/
│   │   │   └── library.ts     # Centralized business rules
│   │   ├── auth.ts            # NextAuth configuration
│   │   ├── notifications.ts   # Notification service
│   │   └── prisma.ts          # Prisma client singleton
│   ├── middleware.ts           # RBAC route protection
│   └── types/                 # TypeScript type extensions
└── jest.config.ts             # Test configuration
```

---

## 🔒 Security

- **Autentikasi**: JWT session via NextAuth
- **Otorisasi**: RBAC di middleware (route-level) + validasi ulang di setiap API endpoint
- **Password**: Di-hash dengan bcryptjs (cost factor 12)
- **Upload**: Validasi MIME type, ekstensi, dan ukuran file (max 5MB)
- **AI Input**: Batas panjang pesan dan jumlah pesan per request
- **AI Secrets**: API key provider dienkripsi AES-256-GCM; tidak pernah dikirim ke browser/URL/localStorage atau audit log
- **AI Config RBAC**: Halaman dan endpoint Konfigurasi AI hanya untuk ADMIN, diperiksa dari sesi server
- **HTTP Headers**: X-Frame-Options, X-Content-Type-Options, XSS-Protection, Referrer-Policy
- **SQL Injection**: Tidak ada raw query — semua query melalui Prisma ORM
- **Sensitive Data**: `passwordHash` tidak pernah disertakan dalam API response (menggunakan `select` Prisma)

---

## 🤝 Kontribusi

1. Fork repository
2. Buat branch fitur: `git checkout -b feature/nama-fitur`
3. Commit: `git commit -m 'feat: deskripsi fitur'`
4. Push: `git push origin feature/nama-fitur`
5. Buat Pull Request

---

## 📄 Lisensi

MIT License — bebas digunakan untuk keperluan sekolah.
