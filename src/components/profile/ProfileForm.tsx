"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useRouter } from "next/navigation";
import { CheckCircle, KeyRound, User as UserIcon, MessageCircle, Unlink, ShieldCheck } from "lucide-react";

export interface ProfileUser {
  id: string;
  name: string;
  email: string;
  role: string;
  gender: string | null;
  identityNumber: string | null;
  class: string | null;
  whatsappNumberMasked: string | null;
  whatsappVerified: boolean;
  whatsappNotificationsEnabled: boolean;
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

  // --- WhatsApp ---
  // Semua role dapat menautkan nomor sendiri. Nomor baru dipakai setelah
  // verifikasi OTP; nomor tersimpan tidak pernah ditampilkan utuh.
  const [whatsappVerified, setWhatsappVerified] = useState(user.whatsappVerified);
  const [whatsappNumberMasked, setWhatsappNumberMasked] = useState(user.whatsappNumberMasked);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    user.whatsappNotificationsEnabled
  );
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationRequested, setVerificationRequested] = useState(false);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappMessage, setWhatsappMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  const requestWhatsAppCode = async () => {
    setWhatsappLoading(true);
    setWhatsappMessage(null);
    try {
      const res = await fetch("/api/whatsapp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: whatsappNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setWhatsappMessage({
          type: "error",
          text: data.error || data.message || "Gagal mengirim kode verifikasi.",
        });
      } else {
        setVerificationRequested(true);
        setWhatsappMessage({
          type: "success",
          text:
            data.message ||
            "Kode verifikasi telah dikirim ke WhatsApp Anda. Masukkan 6 digit kode di bawah.",
        });
      }
    } catch {
      setWhatsappMessage({ type: "error", text: "Terjadi kesalahan saat meminta kode verifikasi." });
    } finally {
      setWhatsappLoading(false);
    }
  };

  const confirmWhatsAppCode = async () => {
    setWhatsappLoading(true);
    setWhatsappMessage(null);
    try {
      const res = await fetch("/api/whatsapp/verify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: whatsappNumber, code: verificationCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setWhatsappMessage({
          type: "error",
          text: data.error || data.message || "Kode verifikasi salah.",
        });
      } else {
        setWhatsappVerified(true);
        setNotificationsEnabled(true);
        setWhatsappNumberMasked(data.maskedNumber || whatsappNumberMasked);
        setVerificationRequested(false);
        setVerificationCode("");
        setWhatsappNumber("");
        setWhatsappMessage({
          type: "success",
          text: data.message || "Nomor WhatsApp berhasil diverifikasi.",
        });
        router.refresh();
      }
    } catch {
      setWhatsappMessage({ type: "error", text: "Terjadi kesalahan saat memverifikasi nomor." });
    } finally {
      setWhatsappLoading(false);
    }
  };

  const toggleWhatsAppNotifications = async () => {
    setWhatsappLoading(true);
    setWhatsappMessage(null);
    try {
      const res = await fetch("/api/whatsapp/link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !notificationsEnabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWhatsappMessage({
          type: "error",
          text: data.error || "Gagal memperbarui preferensi notifikasi.",
        });
      } else {
        setNotificationsEnabled(Boolean(data.notificationsEnabled));
        setWhatsappMessage({
          type: "success",
          text: data.notificationsEnabled
            ? "Notifikasi WhatsApp diaktifkan."
            : "Notifikasi WhatsApp dimatikan.",
        });
      }
    } catch {
      setWhatsappMessage({ type: "error", text: "Terjadi kesalahan saat memperbarui preferensi." });
    } finally {
      setWhatsappLoading(false);
    }
  };

  const disconnectWhatsApp = async () => {
    setWhatsappLoading(true);
    setWhatsappMessage(null);
    try {
      const res = await fetch("/api/whatsapp/link", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWhatsappMessage({
          type: "error",
          text: data.error || "Gagal memutuskan nomor WhatsApp",
        });
      } else {
        setWhatsappVerified(false);
        setWhatsappNumberMasked(null);
        setNotificationsEnabled(true);
        setVerificationRequested(false);
        setVerificationCode("");
        setWhatsappNumber("");
        setWhatsappMessage({
          type: "success",
          text: data.message || "Nomor WhatsApp berhasil diputuskan.",
        });
        router.refresh();
      }
    } catch {
      setWhatsappMessage({
        type: "error",
        text: "Terjadi kesalahan saat memutuskan nomor WhatsApp.",
      });
    } finally {
      setWhatsappLoading(false);
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle size={18} className="text-primary" /> Notifikasi WhatsApp
          </CardTitle>
          <CardDescription>
            Daftarkan nomor WhatsApp Anda untuk menerima pemberitahuan peminjaman,
            pengembalian, pengingat jatuh tempo, denda, dan e-book. Notifikasi
            dikirim dari satu nomor Admin DigiLib. Nomor hanya aktif setelah
            diverifikasi dengan kode 6 digit.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-sm text-muted">Status:</span>
            <Badge variant={whatsappVerified ? "success" : "warning"}>
              {whatsappVerified ? "Terverifikasi" : "Belum terverifikasi"}
            </Badge>
            {whatsappVerified && whatsappNumberMasked && (
              <span className="text-sm text-main font-medium">{whatsappNumberMasked}</span>
            )}
            {whatsappVerified && (
              <Badge variant={notificationsEnabled ? "info" : "default"}>
                {notificationsEnabled ? "Notifikasi aktif" : "Notifikasi dimatikan"}
              </Badge>
            )}
          </div>

          {whatsappMessage && (
            <p
              className={`text-sm p-3 rounded-lg mt-2 ${
                whatsappMessage.type === "success"
                  ? "bg-success-bg text-success"
                  : "bg-danger-bg text-danger"
              }`}
            >
              {whatsappMessage.text}
            </p>
          )}

          {!whatsappVerified && (
            <div className="mt-4 max-w-md">
              <Input
                label="Nomor WhatsApp"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="Contoh: 081234567890"
                inputMode="tel"
                autoComplete="tel"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={requestWhatsAppCode}
                  disabled={whatsappLoading || whatsappNumber.trim().length < 9}
                >
                  {whatsappLoading && !verificationRequested
                    ? "Mengirim..."
                    : "Kirim Kode Verifikasi"}
                </Button>
              </div>

              {verificationRequested && (
                <div className="mt-4">
                  <Input
                    label="Kode Verifikasi (6 digit)"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  <Button
                    type="button"
                    onClick={confirmWhatsAppCode}
                    disabled={whatsappLoading || verificationCode.length !== 6}
                  >
                    <ShieldCheck size={16} className="mr-2" />
                    {whatsappLoading ? "Memverifikasi..." : "Verifikasi Nomor"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {whatsappVerified && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={toggleWhatsAppNotifications}
                disabled={whatsappLoading}
              >
                {notificationsEnabled ? "Matikan Notifikasi WhatsApp" : "Aktifkan Notifikasi WhatsApp"}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={whatsappLoading}
              >
                <Unlink size={16} className="mr-2" /> Putuskan Nomor WhatsApp
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmationDialog
        isOpen={showDisconnectDialog}
        onClose={() => setShowDisconnectDialog(false)}
        onConfirm={disconnectWhatsApp}
        title="Putuskan Nomor WhatsApp"
        message="Apakah Anda yakin ingin memutuskan nomor WhatsApp dari akun DigiLib ini? Anda tidak akan menerima notifikasi WhatsApp sampai memverifikasi nomor kembali."
        confirmText="Ya, Putuskan"
        cancelText="Batal"
        isDestructive
      />
    </div>
  );
}
