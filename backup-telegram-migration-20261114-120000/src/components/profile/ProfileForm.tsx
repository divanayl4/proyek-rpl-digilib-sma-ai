"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { LIBRARY_CONFIG } from "@/lib/config/library";
import { useRouter } from "next/navigation";
import { CheckCircle, KeyRound, User as UserIcon, Send, Unlink } from "lucide-react";

export interface ProfileUser {
  id: string;
  name: string;
  email: string;
  role: string;
  gender: string | null;
  identityNumber: string | null;
  class: string | null;
  telegramLinked: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  LIBRARIAN: "Pustakawan",
  STUDENT: "Siswa",
  TEACHER: "Guru",
  STAFF: "Staf",
};

export default function ProfileForm({ user }: { user: ProfileUser }) {
  const router = useRouter();

  // --- Data diri ---
  const [name, setName] = useState(user.name);
  const [gender, setGender] = useState(user.gender ?? "");
  const [identityNumber, setIdentityNumber] = useState(user.identityNumber ?? "");
  const [userClass, setUserClass] = useState(user.class ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // --- Password ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // --- Telegram ---
  // Telegram hanya untuk peminjam (Siswa, Guru, Staf Sekolah) — selaras dengan
  // aturan peminjam di konfigurasi perpustakaan. ADMIN/LIBRARIAN tidak termasuk.
  const canUseTelegram = LIBRARY_CONFIG.borrowerRoles.includes(user.role);
  const [telegramLinked, setTelegramLinked] = useState(user.telegramLinked);
  const [telegramLink, setTelegramLink] = useState<{
    code: string;
    deepLink: string | null;
    botUsername: string | null;
  } | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  const connectTelegram = async () => {
    setTelegramLoading(true);
    setTelegramMessage(null);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTelegramMessage({ type: "error", text: data.error || "Gagal membuat kode pengaitan" });
      } else {
        setTelegramLink({
          code: data.code,
          deepLink: data.deepLink,
          botUsername: data.botUsername,
        });
        setTelegramMessage({
          type: "success",
          text: "Kode pengaitan dibuat. Kirim /start ke bot, lalu kirim kode ini sebagai pesan terpisah (berlaku 15 menit).",
        });
      }
    } catch {
      setTelegramMessage({ type: "error", text: "Terjadi kesalahan saat menghubungkan Telegram." });
    } finally {
      setTelegramLoading(false);
    }
  };

  const disconnectTelegram = async () => {
    setTelegramLoading(true);
    setTelegramMessage(null);
    try {
      const res = await fetch("/api/telegram/link", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setTelegramMessage({
          type: "error",
          text: data.error || "Gagal memutuskan koneksi Telegram",
        });
      } else {
        setTelegramLinked(false);
        setTelegramLink(null);
        setTelegramMessage({
          type: "success",
          text: data.message || "Koneksi Telegram berhasil diputuskan.",
        });
      }
    } catch {
      setTelegramMessage({
        type: "error",
        text: "Terjadi kesalahan saat memutuskan koneksi Telegram.",
      });
    } finally {
      setTelegramLoading(false);
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          gender,
          identityNumber,
          class: userClass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMessage({ type: "error", text: data.error || "Gagal menyimpan profil" });
      } else {
        setProfileMessage({ type: "success", text: "Profil berhasil diperbarui." });
        router.refresh();
      }
    } catch {
      setProfileMessage({ type: "error", text: "Terjadi kesalahan saat menyimpan." });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: "error", text: "Konfirmasi password tidak sama." });
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordMessage({ type: "error", text: data.error || "Gagal mengubah password" });
      } else {
        setPasswordMessage({ type: "success", text: "Password berhasil diubah." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setPasswordMessage({ type: "error", text: "Terjadi kesalahan saat mengubah password." });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading">Profil Saya</h1>
          <p className="page-description">Kelola informasi akun dan keamanan Anda.</p>
        </div>
      </div>

      <Card className="card-accent-purple">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserIcon size={18} className="text-primary" aria-hidden="true" /> Informasi Profil
          </CardTitle>
          <CardDescription>Perbarui data diri Anda. Email dan role tidak dapat diubah di sini.</CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <Input label="Nama Lengkap" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
            <div className="mb-4">
              <label className="form-label">Email</label>
              <div className="form-control bg-base text-muted cursor-not-allowed" title="Hubungi Admin untuk mengubah email">
                {user.email}
              </div>
            </div>
            <div className="mb-4">
              <label className="form-label">Role</label>
              <div className="flex items-center h-10">
                <Badge variant="info">{ROLE_LABELS[user.role] || user.role}</Badge>
              </div>
            </div>
            <div className="mb-4">
              <label className="form-label">Jenis Kelamin</label>
              <Select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">Tidak disebutkan</option>
                <option value="MALE">Laki-laki</option>
                <option value="FEMALE">Perempuan</option>
              </Select>
            </div>
            <Input
              label="Nomor Identitas (NIS/NIP)"
              value={identityNumber}
              onChange={(e) => setIdentityNumber(e.target.value)}
              maxLength={100}
              placeholder="Contoh: 2024001"
            />
            {user.role === "STUDENT" && (
              <Input
                label="Kelas"
                value={userClass}
                onChange={(e) => setUserClass(e.target.value)}
                maxLength={100}
                placeholder="Contoh: X IPA 1"
              />
            )}
          </div>

          {profileMessage && (
            <p
              className={`text-sm p-3 rounded-lg mt-2 ${
                profileMessage.type === "success"
                  ? "bg-success-bg text-success"
                  : "bg-danger-bg text-danger"
              }`}
            >
              {profileMessage.text}
            </p>
          )}

          <div className="mt-4">
            <Button type="button" onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound size={18} className="text-warning" /> Ubah Password
          </CardTitle>
          <CardDescription>Masukkan password lama untuk mengganti password.</CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6">
            <Input
              label="Password Lama"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Input
              label="Password Baru"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Input
              label="Konfirmasi Password Baru"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {passwordMessage && (
            <p
              className={`text-sm p-3 rounded-lg mt-2 ${
                passwordMessage.type === "success"
                  ? "bg-success-bg text-success"
                  : "bg-danger-bg text-danger"
              }`}
            >
              {passwordMessage.text}
            </p>
          )}

          <div className="mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={changePassword}
              disabled={savingPassword || !currentPassword || !newPassword}
            >
              {savingPassword ? "Menyimpan..." : (
                <>
                  <CheckCircle size={16} className="mr-2" /> Ubah Password
                </>
              )}
            </Button>
          </div>
        </CardBody>
      </Card>

      {canUseTelegram && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send size={18} className="text-primary" /> Notifikasi Telegram
            </CardTitle>
            <CardDescription>
              Hubungkan akun Telegram Anda untuk menerima pemberitahuan peminjaman,
              pengembalian, denda, dan e-book. Telegram hanya saluran tambahan.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm text-muted">Status:</span>
              <Badge variant={telegramLinked ? "success" : "warning"}>
                {telegramLinked ? "Terhubung" : "Belum terhubung"}
              </Badge>
            </div>

            {telegramMessage && (
              <p
                className={`text-sm p-3 rounded-lg mt-2 ${
                  telegramMessage.type === "success"
                    ? "bg-success-bg text-success"
                    : "bg-danger-bg text-danger"
                }`}
              >
                {telegramMessage.text}
              </p>
            )}

            {telegramLink && (
              <div className="text-sm text-muted mt-3 flex flex-col gap-1">
                <p>
                  1. Buka bot{" "}
                  <strong>{telegramLink.botUsername ?? "Telegram DigiLib"}</strong> di Telegram,
                  lalu tekan <strong>Mulai</strong> atau kirim{" "}
                  <code className="bg-base px-1 rounded">/start</code>.
                </p>
                <p>
                  2. Kirim kode ini sebagai pesan terpisah:{" "}
                  <code className="bg-base px-1 rounded">{telegramLink.code}</code>
                </p>
                {telegramLink.deepLink && (
                  <p>
                    3. Atau buka{" "}
                    <a className="text-primary underline" href={telegramLink.deepLink} target="_blank" rel="noreferrer">
                      tautan pengaitan ini
                    </a>{" "}
                    (format lama, tetap didukung).
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {!telegramLinked && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={connectTelegram}
                  disabled={telegramLoading}
                >
                  {telegramLoading ? "Memproses..." : "Hubungkan Telegram"}
                </Button>
              )}
              {telegramLinked && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setShowDisconnectDialog(true)}
                  disabled={telegramLoading}
                >
                  <Unlink size={16} className="mr-2" /> Putuskan Koneksi Telegram
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {canUseTelegram && (
        <ConfirmationDialog
          isOpen={showDisconnectDialog}
          onClose={() => setShowDisconnectDialog(false)}
          onConfirm={disconnectTelegram}
          title="Putuskan Koneksi Telegram"
          message="Apakah Anda yakin ingin memutuskan koneksi Telegram dari akun DigiLib ini? Anda tidak akan menerima notifikasi Telegram sampai menghubungkannya kembali."
          confirmText="Ya, Putuskan"
          cancelText="Batal"
          isDestructive
        />
      )}
    </div>
  );
}
