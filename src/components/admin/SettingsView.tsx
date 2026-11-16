"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Badge } from "@/components/ui/Badge";
import { Settings as SettingsIcon, Coins, Save, AlertTriangle, CheckCircle } from "lucide-react";

interface DamageCondition {
  key: string;
  label: string;
  amountIDR: number;
  configured: boolean;
  defaultIDR: number;
}

interface SettingsPayload {
  finePerDayIDR: number;
  fineRateConfigured: boolean;
  fineRateDefault: number;
  damageConditions: DamageCondition[];
}

interface SettingsViewProps {
  heading?: string;
  description?: string;
}

export default function SettingsView({
  heading = "Pengaturan Sistem",
  description = "Konfigurasi kebijakan perpustakaan yang dapat diubah Administrator.",
}: SettingsViewProps = {}) {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [value, setValue] = useState("");
  const [damageValues, setDamageValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDamage, setSavingDamage] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [damageFeedback, setDamageFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Gagal memuat pengaturan");
      }
      const data = await res.json();
      setSettings(data.settings);
      setValue(String(data.settings.finePerDayIDR));
      const conditions: DamageCondition[] = Array.isArray(data.settings.damageConditions)
        ? data.settings.damageConditions
        : [];
      setDamageValues(
        Object.fromEntries(conditions.map((c) => [c.key, String(c.amountIDR)]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finePerDayIDR: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Gagal menyimpan tarif denda" });
        return;
      }
      setFeedback({ type: "success", message: "Tarif denda berhasil disimpan." });
      await load();
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan." });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDamage = async () => {
    setSavingDamage(true);
    setDamageFeedback(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ damageConditions: damageValues }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDamageFeedback({ type: "error", message: data.error || "Gagal menyimpan tarif kerusakan" });
        return;
      }
      setDamageFeedback({ type: "success", message: "Tarif denda kerusakan berhasil disimpan." });
      await load();
    } catch {
      setDamageFeedback({ type: "error", message: "Terjadi kesalahan jaringan." });
    } finally {
      setSavingDamage(false);
    }
  };

  if (loading) return <LoadingState message="Memuat pengaturan..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const preview = Number.parseInt(value || "0", 10) || 0;
  const damageConditions = settings?.damageConditions ?? [];
  const hasUnconfiguredDamage = damageConditions.some((c) => !c.configured);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <SettingsIcon size={24} className="text-primary flex-shrink-0" aria-hidden="true" /> {heading}
          </h1>
          <p className="page-description">{description}</p>
        </div>
      </div>

      {settings && !settings.fineRateConfigured && (
        <div
          className="flex items-start gap-3 p-4 rounded-xl"
          style={{ backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}
        >
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
          <div className="text-sm">
            <p className="font-semibold">Tarif denda belum ditetapkan secara resmi.</p>
            <p className="mt-1">
              Sistem saat ini memakai tarif bawaan Rp{settings.fineRateDefault.toLocaleString("id-ID")}/hari.
              Mohon tetapkan tarif resmi di bawah agar perhitungan denda sesuai kebijakan sekolah.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Coins size={18} className="text-primary" /> Tarif Denda Keterlambatan
              </CardTitle>
              <CardDescription>
                Denda dihitung per hari keterlambatan buku fisik. Ebook yang masa aksesnya
                berakhir tidak dikenai denda.
              </CardDescription>
            </div>
            {settings && (
              <Badge variant={settings.fineRateConfigured ? "success" : "warning"}>
                {settings.fineRateConfigured ? "Sudah ditetapkan" : "Nilai bawaan"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardBody>
          <div className="max-w-md">
            <Input
              label="Tarif denda per hari (Rp)"
              type="number"
              min={0}
              step={500}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="text-sm text-muted -mt-2 mb-4">
              Contoh: keterlambatan 3 hari → Rp{(preview * 3).toLocaleString("id-ID")}.
            </p>

            {feedback && (
              <div
                className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm"
                style={{
                  backgroundColor:
                    feedback.type === "success" ? "var(--color-success-bg)" : "var(--color-danger-bg)",
                  color:
                    feedback.type === "success" ? "var(--color-success-text)" : "var(--color-danger-text)",
                }}
              >
                {feedback.type === "success" ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <span>{feedback.message}</span>
              </div>
            )}

            <Button onClick={handleSave} disabled={saving}>
              <Save size={16} className="mr-2" />
              {saving ? "Menyimpan..." : "Simpan Tarif Denda"}
            </Button>
          </div>
          <p className="text-xs text-muted mt-6">
            Catatan: perubahan tarif hanya berlaku untuk perhitungan denda berikutnya. Denda
            yang sudah tercatat pada transaksi lama tidak ikut berubah.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-primary" /> Tarif Denda Kondisi Buku
              </CardTitle>
              <CardDescription>
                Denda kerusakan dipilih dari kategori kondisi saat buku dikembalikan.
                Isi Rp 0 untuk kategori tanpa denda (mis. kondisi baik). Tarif ini
                menggantikan nilai bawaan sistem.
              </CardDescription>
            </div>
            <Badge variant={hasUnconfiguredDamage ? "warning" : "success"}>
              {hasUnconfiguredDamage ? "Sebagian nilai bawaan" : "Sudah ditetapkan"}
            </Badge>
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-4 max-w-2xl">
            {damageConditions.map((c) => (
              <div key={c.key} className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1">
                  <label className="form-label" htmlFor={`damage-${c.key}`}>
                    {c.label}
                    {!c.configured && (
                      <span className="text-xs text-muted ml-2">
                        (bawaan Rp {c.defaultIDR.toLocaleString("id-ID")})
                      </span>
                    )}
                  </label>
                  <Input
                    id={`damage-${c.key}`}
                    type="number"
                    min={0}
                    step={1000}
                    value={damageValues[c.key] ?? ""}
                    onChange={(e) =>
                      setDamageValues((prev) => ({ ...prev, [c.key]: e.target.value }))
                    }
                  />
                </div>
              </div>
            ))}

            {damageFeedback && (
              <div
                className="flex items-center gap-2 p-3 rounded-lg text-sm"
                style={{
                  backgroundColor:
                    damageFeedback.type === "success" ? "var(--color-success-bg)" : "var(--color-danger-bg)",
                  color:
                    damageFeedback.type === "success" ? "var(--color-success-text)" : "var(--color-danger-text)",
                }}
              >
                {damageFeedback.type === "success" ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <span>{damageFeedback.message}</span>
              </div>
            )}

            <div>
              <Button onClick={handleSaveDamage} disabled={savingDamage}>
                <Save size={16} className="mr-2" />
                {savingDamage ? "Menyimpan..." : "Simpan Tarif Kondisi"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted mt-6">
            Catatan: denda kondisi dibekukan (snapshot) saat buku dikembalikan, sehingga
            perubahan tarif tidak mengubah denda transaksi yang sudah selesai.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
