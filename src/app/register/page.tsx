"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Eye, EyeOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";

const ALLOWED_ROLES = [
  { value: "STUDENT", label: "Siswa" },
  { value: "TEACHER", label: "Guru" },
  { value: "STAFF", label: "Staff" },
] as const;

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    role: "STUDENT",
    nis: "",
    class: "",
  });
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string; phone?: string; role?: string; nis?: string; class?: string }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<"form" | "otp">("form");
  const [otpCode, setOtpCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingPhone, setPendingPhone] = useState("");
  const [maskedNumber, setMaskedNumber] = useState<string | null>(null);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);

  const validate = (): boolean => {
    const newErrors: Partial<typeof errors> = {};
    if (!form.name?.trim()) newErrors.name = "Nama lengkap wajib diisi";
    if (!form.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = "Format email tidak valid";
    }
    if (!form.password?.trim() || form.password.length < 6) {
      newErrors.password = "Password minimal 6 karakter";
    }
    if (!form.phone?.trim()) {
      newErrors.phone = "Nomor HP wajib diisi";
    } else if (!/^(\+?62|0|8)\d{8,12}$/.test(form.phone.replace(/[\s\-().]/g, ""))) {
      newErrors.phone = "Format nomor HP tidak valid";
    }
    if (!form.role || !ALLOWED_ROLES.some((r) => r.value === form.role)) {
      newErrors.role = "Role tidak valid";
    }
    if (!form.nis?.trim()) newErrors.nis = "Nomor Induk (NIS/NIP) wajib diisi";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setSuccessMsg(null);
    if (!validate()) return;
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setApiError(data.error || "Gagal melakukan pendaftaran akun");
        return;
      }

      if (data.verificationRequired) {
        setPendingEmail(form.email.trim().toLowerCase());
        setPendingPhone(form.phone.trim());
        setMaskedNumber(data.maskedNumber || null);
        setOtpMessage(data.message || "Kode verifikasi telah dikirim ke WhatsApp Anda.");
        setStep("otp");
        return;
      }

      setSuccessMsg("Pendaftaran berhasil! Mengalihkan ke halaman login...");
      setTimeout(() => {
        router.push("/login");
      }, 1500);
    } catch {
      setApiError("Terjadi kesalahan koneksi ke server");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    if (!otpCode.trim() || !/^\d{6}$/.test(otpCode.trim())) {
      setApiError("Kode verifikasi harus 6 digit.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, phone: pendingPhone, code: otpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setApiError(data.error || data.message || "Kode verifikasi salah.");
        return;
      }
      setSuccessMsg("Akun berhasil diverifikasi. Mengalihkan ke halaman login...");
      setTimeout(() => router.push("/login"), 1500);
    } catch {
      setApiError("Terjadi kesalahan koneksi ke server");
    } finally {
      setLoading(false);
    }
  };

  if (step === "otp") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-8 bg-base">
        <div className="w-full max-w-md bg-surface p-6 sm:p-8 rounded-2xl shadow-xl border border-border">
          <h1 className="text-2xl font-extrabold text-main mb-2">Verifikasi WhatsApp</h1>
          <p className="text-muted text-sm mb-4">
            Masukkan 6 digit kode yang dikirim ke {maskedNumber || pendingPhone}.
          </p>
          {apiError && (
            <div className="bg-danger-bg text-danger-text p-3 rounded-xl text-center text-sm font-medium border border-danger-text/20 mb-3" role="alert">
              {apiError}
            </div>
          )}
          {successMsg && (
            <div className="bg-success-bg text-success-text p-3 rounded-xl text-center text-sm font-medium border border-success-bg mb-3" role="status">
              {successMsg}
            </div>
          )}
          {otpMessage && !successMsg && (
            <div className="bg-success-bg text-success-text p-3 rounded-xl text-center text-sm font-medium border border-success-bg mb-3" role="status">
              {otpMessage}
            </div>
          )}
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="form-control"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              disabled={loading}
            />
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" onClick={() => setStep("form")} disabled={loading}>
                Kembali
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Memverifikasi..." : "Verifikasi"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid auth-split-grid bg-base">
      {/* Panel informasi */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-10 xl:p-14 bg-gradient-to-br">
        <div className="absolute -top-24 -right-20 w-72 h-72 rounded-full bg-white/50 blur-2xl" aria-hidden="true"></div>
        <div className="absolute bottom-10 -left-16 w-64 h-64 rounded-full bg-surface-purple blur-2xl" aria-hidden="true"></div>

        <Link href="/login" className="relative z-10 flex items-center gap-3 min-w-0 group">
          <span className="app-sidebar__logo" aria-hidden="true">
            <BookOpen size={26} />
          </span>
          <div>
            <p className="text-xl font-extrabold text-main tracking-tight">DigiLib SMA</p>
            <p className="text-sm text-muted">Perpustakaan digital sekolah</p>
          </div>
        </Link>

        <div className="relative z-10 max-w-md">
          <span className="chip mb-5 bg-white/80">
            <Sparkles size={14} /> Mulai perjalanan literasimu
          </span>
          <h2 className="text-4xl xl:text-5xl font-extrabold text-main leading-tight mb-4">
            Bergabung dan temukan bacaan berikutnya.
          </h2>
          <p className="text-muted leading-relaxed">
            Satu akun untuk mengakses katalog buku, koleksi ebook, riwayat peminjaman, dan rekomendasi bacaan.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <span className="badge badge-purple">Katalog lengkap</span>
            <span className="badge badge-blue">Ebook</span>
            <span className="badge badge-green">Riwayat rapi</span>
            <span className="badge badge-yellow">Rekomendasi</span>
          </div>
        </div>

        <p className="relative z-10 text-xs text-muted">SMA Negeri 1 · DigiLib</p>
      </aside>

      {/* Form pendaftaran */}
      <main className="flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-xl">
          <div className="flex items-center justify-between gap-3 mb-5">
            <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-primary min-h-11">
              <ArrowLeft size={16} /> Kembali ke login
            </Link>
            <div className="lg:hidden flex items-center gap-2">
              <span className="app-sidebar__logo brand-mark-sm" aria-hidden="true">
                <BookOpen size={19} />
              </span>
              <span className="font-extrabold text-main">DigiLib</span>
            </div>
          </div>

          <div className="bg-surface p-6 sm:p-8 rounded-2xl shadow-xl border border-border">
            <div className="mb-6">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-main tracking-tight">Daftar Akun</h1>
              <p className="text-muted mt-1.5 text-sm">Lengkapi data berikut untuk membuat akun perpustakaan.</p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {apiError && (
                <div className="bg-danger-bg text-danger-text p-3 rounded-xl text-center text-sm font-medium border border-danger-text/20" role="alert">
                  {apiError}
                </div>
              )}
              {successMsg && (
                <div className="bg-success-bg text-success-text p-3 rounded-xl text-center text-sm font-medium border border-success-bg" role="status">
                  {successMsg}
                </div>
              )}

              <div>
                <label htmlFor="reg-name" className="form-label">
                  Nama Lengkap <span className="text-danger">*</span>
                </label>
                <input
                  id="reg-name"
                  className={`form-control ${errors.name ? "border-danger-text" : ""}`}
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Masukkan nama lengkap"
                  disabled={loading}
                  aria-invalid={Boolean(errors.name)}
                />
                {errors.name && <p className="form-error">{errors.name}</p>}
              </div>

              <div>
                <label htmlFor="reg-email" className="form-label">
                  Alamat Email <span className="text-danger">*</span>
                </label>
                <input
                  id="reg-email"
                  type="email"
                  className={`form-control ${errors.email ? "border-danger-text" : ""}`}
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="siswa@sma.id"
                  disabled={loading}
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email && <p className="form-error">{errors.email}</p>}
              </div>

              <div>
                <label htmlFor="reg-password" className="form-label">
                  Kata Sandi <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <input
                    id="reg-password"
                    type={showPassword ? "text" : "password"}
                    className={`form-control pr-11 ${errors.password ? "border-danger-text" : ""}`}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="Minimal 6 karakter"
                    disabled={loading}
                    aria-invalid={Boolean(errors.password)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted hover:text-primary"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && <p className="form-error">{errors.password}</p>}
              </div>

              <div>
                <label htmlFor="reg-phone" className="form-label">
                  Nomor HP <span className="text-danger">*</span>
                </label>
                <input
                  id="reg-phone"
                  type="tel"
                  className={`form-control ${errors.phone ? "border-danger-text" : ""}`}
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="Contoh: 081234567890"
                  disabled={loading}
                  aria-invalid={Boolean(errors.phone)}
                />
                {errors.phone && <p className="form-error">{errors.phone}</p>}
              </div>

              <div>
                <label htmlFor="reg-role" className="form-label">
                  Role <span className="text-danger">*</span>
                </label>
                <select
                  id="reg-role"
                  className={`form-control ${errors.role ? "border-danger-text" : ""}`}
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  disabled={loading}
                  aria-invalid={Boolean(errors.role)}
                >
                  {ALLOWED_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {errors.role && <p className="form-error">{errors.role}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reg-nis" className="form-label">
                    NIS <span className="text-danger">*</span>
                  </label>
                  <input
                    id="reg-nis"
                    className={`form-control ${errors.nis ? "border-danger-text" : ""}`}
                    value={form.nis}
                    onChange={e => setForm({ ...form, nis: e.target.value })}
                    placeholder="Contoh: 2024001"
                    disabled={loading}
                    aria-invalid={Boolean(errors.nis)}
                  />
                  {errors.nis && <p className="form-error">{errors.nis}</p>}
                </div>

                <div>
                  <label htmlFor="reg-class" className="form-label">
                    Kelas (Opsional)
                  </label>
                  <input
                    id="reg-class"
                    className="form-control"
                    value={form.class}
                    onChange={e => setForm({ ...form, class: e.target.value })}
                    placeholder="Contoh: X RPL 1"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end mt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => router.push("/login")}
                  disabled={loading}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Mendaftarkan..." : "Daftar Sekarang"}
                </Button>
              </div>

              <div className="pt-4 text-center text-xs text-muted border-t border-border">
                Sudah memiliki akun?{" "}
                <Link href="/login" className="text-primary font-semibold underline hover:text-primary-700">
                  Masuk di sini
                </Link>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
