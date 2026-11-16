"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const target = e.currentTarget;
    const email = (target.elements.namedItem("email") as HTMLInputElement).value;
    const password = (target.elements.namedItem("password") as HTMLInputElement).value;

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (res?.error) {
      setError("Email atau kata sandi yang Anda masukkan salah.");
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-base">
      {/* Panel dekoratif — hanya tampil di layar besar */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-10 xl:p-14 bg-gradient-to-br">
        <div className="absolute -top-24 -right-20 w-72 h-72 rounded-full bg-white/50 blur-2xl" aria-hidden="true"></div>
        <div className="absolute bottom-10 -left-16 w-64 h-64 rounded-full bg-surface-yellow blur-2xl" aria-hidden="true"></div>
        <div className="relative z-10 flex items-center gap-3">
          <span className="app-sidebar__logo" aria-hidden="true">
            <BookOpen size={26} />
          </span>
          <div>
            <p className="text-xl font-extrabold text-main tracking-tight">DigiLib SMA</p>
            <p className="text-sm text-muted">Perpustakaan digital sekolah</p>
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <span className="chip mb-5 bg-white/80">
            <Sparkles size={14} /> Literasi tanpa batas
          </span>
          <h2 className="text-4xl xl:text-5xl font-extrabold text-main leading-tight mb-4">
            Satu pintu untuk koleksi, peminjaman, dan asisten literasi.
          </h2>
          <p className="text-muted leading-relaxed">
            Temukan buku fisik dan ebook, kelola peminjaman, serta dapatkan rekomendasi bacaan yang sesuai untukmu.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <span className="badge badge-purple">Katalog</span>
            <span className="badge badge-blue">Ebook</span>
            <span className="badge badge-green">Peminjaman</span>
            <span className="badge badge-yellow">Asisten AI</span>
          </div>
        </div>
        <p className="relative z-10 text-xs text-muted">SMA Negeri 1 · DigiLib</p>
      </aside>

      {/* Form login */}
      <main className="flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-6 lg:hidden">
            <div className="app-sidebar__logo mx-auto mb-3" aria-hidden="true">
              <BookOpen size={26} />
            </div>
            <p className="text-xl font-extrabold text-main">DigiLib SMA</p>
            <p className="text-muted text-sm mt-1">Perpustakaan digital sekolah</p>
          </div>

          <div className="bg-surface p-6 sm:p-9 rounded-2xl shadow-xl w-full border border-border">
            {/* Brand Header */}
            <div className="text-center mb-8">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-main tracking-tight">Masuk ke Akun</h1>
              <p className="text-muted mt-1.5 text-sm">Gunakan akun DigiLib yang diberikan sekolah.</p>
            </div>
            
            {error && (
              <div className="bg-danger-bg text-danger-text p-3.5 rounded-xl mb-5 text-center text-sm font-medium border border-danger-text/20" role="alert">
                {error}
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label htmlFor="login-email" className="form-label">
                  Alamat Email
                </label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  className="form-control"
                  placeholder="Masukkan email anda"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="login-password" className="form-label">
                  Kata Sandi
                </label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  required
                  className="form-control"
                  placeholder="Masukkan kata sandi anda"
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 text-base rounded-xl"
                >
                  {loading ? "Memproses..." : "Masuk ke Akun"}
                </Button>
              </div>
            </form>
            
            <div className="mt-8 pt-6 border-t border-border text-center">
              <p className="text-sm text-muted">
                Belum memiliki akun?{" "}
                <Link href="/register" className="text-primary font-semibold underline hover:text-primary-700">
                  Daftar sekarang
                </Link>
              </p>
            </div>
          </div>

          <p className="text-center text-xs text-muted mt-5">
            Butuh bantuan? Hubungi pustakawan sekolah.
          </p>
        </div>
      </main>
    </div>
  );
}
