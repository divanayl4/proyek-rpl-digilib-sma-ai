"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Info,
  Loader2,
  Megaphone,
  MessageCircle,
  Phone,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  Wifi,
} from "lucide-react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Table,
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui/Table";
import {
  WHATSAPP_BROADCAST_CATEGORIES,
  WHATSAPP_CATEGORY_LABELS,
  type WhatsAppCategory,
} from "@/lib/whatsapp-shared";

type ConfigSource = "database" | "environment" | "none";
type ConnectionStatus = "UNKNOWN" | "CONNECTED" | "FAILED";
type DeliveryStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";
type TabKey = "config" | "announce" | "users" | "history";

interface ConfigSummary {
  configured: boolean;
  tokenMasked: string | null;
  tokenSource: ConfigSource;
  adminNumber: string | null;
  adminNumberSource: ConfigSource;
  enabled: boolean;
  enabledCategories: WhatsAppCategory[];
  allCategories: { key: WhatsAppCategory; label: string }[];
  lastConnection: {
    status: ConnectionStatus;
    message: string;
    checkedAt: string | null;
  };
}

interface DeliveryRow {
  id: string;
  eventKey: string;
  userId: string | null;
  category: string;
  recipientNumber: string;
  title: string;
  message: string;
  status: DeliveryStatus;
  providerStatus: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface WhatsAppUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  whatsappVerified: boolean;
  whatsappVerifiedAt: string | null;
  whatsappNotificationsEnabled: boolean;
  whatsappNumberMasked: string | null;
  hasWhatsappNumber: boolean;
}

interface Feedback {
  type: "success" | "error" | "info";
  text: string;
}

const ROLE_OPTIONS = [
  { value: "STUDENT", label: "Siswa" },
  { value: "TEACHER", label: "Guru" },
  { value: "STAFF", label: "Staf" },
  { value: "LIBRARIAN", label: "Pustakawan" },
  { value: "ADMIN", label: "Administrator" },
];

const STATUS_OPTIONS: { value: DeliveryStatus; label: string }[] = [
  { value: "SENT", label: "Terkirim" },
  { value: "PENDING", label: "Diproses" },
  { value: "FAILED", label: "Gagal" },
  { value: "SKIPPED", label: "Dilewati" },
];

const TABS: { key: TabKey; label: string; icon: typeof Settings2 }[] = [
  { key: "config", label: "Konfigurasi & Status", icon: Settings2 },
  { key: "announce", label: "Pengumuman", icon: Megaphone },
  { key: "users", label: "Nomor Pengguna", icon: Users },
  { key: "history", label: "Riwayat Pengiriman", icon: History },
];

function roleLabel(role: string): string {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label ?? role;
}

function categoryLabel(category: string): string {
  return (WHATSAPP_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

function statusBadge(status: DeliveryStatus) {
  switch (status) {
    case "SENT":
      return <Badge variant="success">Terkirim</Badge>;
    case "PENDING":
      return <Badge variant="warning">Diproses</Badge>;
    case "FAILED":
      return <Badge variant="danger">Gagal</Badge>;
    default:
      return <Badge variant="default">Dilewati</Badge>;
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceLabel(source: ConfigSource): string {
  if (source === "database") return "Dari dashboard";
  if (source === "environment") return "Dari .env server";
  return "Belum diatur";
}

export default function WhatsAppSettingsView() {
  const [tab, setTab] = useState<TabKey>("config");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // --- Konfigurasi ---------------------------------------------------------
  const [config, setConfig] = useState<ConfigSummary | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");

  const [token, setToken] = useState("");
  const [adminNumber, setAdminNumber] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [categories, setCategories] = useState<WhatsAppCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTarget, setTestTarget] = useState("");
  const [testCustomMessage, setTestCustomMessage] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testFeedback, setTestFeedback] = useState<Feedback | null>(null);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError("");
    try {
      const res = await fetch("/api/admin/whatsapp/config", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal memuat konfigurasi WhatsApp.");
      const next = data.config as ConfigSummary;
      setConfig(next);
      setAdminNumber(next.adminNumber ?? "");
      setEnabled(next.enabled);
      setCategories(next.enabledCategories ?? []);
      setToken("");
      return next;
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Terjadi kesalahan.");
      return null;
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const toggleCategory = (category: WhatsAppCategory) => {
    setCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    );
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/whatsapp/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(token.trim() ? { token: token.trim() } : {}),
          adminNumber: adminNumber.trim(),
          enabled,
          enabledCategories: categories,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", text: data.error || "Gagal menyimpan konfigurasi." });
        return;
      }
      setConfig(data.config);
      setToken("");
      setFeedback({ type: "success", text: "Konfigurasi WhatsApp berhasil disimpan." });
      await loadConfig();
    } catch {
      setFeedback({ type: "error", text: "Terjadi kesalahan jaringan." });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestFeedback(null);
    try {
      const res = await fetch("/api/admin/whatsapp/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && data.ok === true;
      setTestFeedback({
        type: ok ? "success" : "error",
        text:
          data.message ||
          (ok ? "Koneksi Fonnte berhasil." : "Koneksi Fonnte gagal diuji.") +
            (data.deviceName ? ` Device: ${data.deviceName}.` : "") +
            (data.quota ? ` Kuota: ${data.quota}.` : ""),
      });
      await loadConfig();
    } catch {
      setTestFeedback({ type: "error", text: "Terjadi kesalahan jaringan." });
    } finally {
      setTesting(false);
    }
  };

  const handleSendTest = async () => {
    setSendingTest(true);
    setTestFeedback(null);
    try {
      const res = await fetch("/api/admin/whatsapp/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(testTarget.trim() ? { target: testTarget.trim() } : {}),
          ...(testCustomMessage.trim() ? { message: testCustomMessage.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setTestFeedback({
          type: "error",
          text: data.error || data.message || "Pesan percobaan gagal dikirim.",
        });
        return;
      }
      setTestFeedback({
        type: "success",
        text: data.message || "Pesan percobaan berhasil dikirim ke Fonnte.",
      });
      setTestCustomMessage("");
    } catch {
      setTestFeedback({ type: "error", text: "Terjadi kesalahan jaringan." });
    } finally {
      setSendingTest(false);
    }
  };

  // --- Pengguna ------------------------------------------------------------
  const [users, setUsers] = useState<WhatsAppUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userSearchInput, setUserSearchInput] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userSummary, setUserSummary] = useState({ verified: 0, withoutNumber: 0 });
  const [userFeedback, setUserFeedback] = useState<Feedback | null>(null);

  const [editingUser, setEditingUser] = useState<WhatsAppUserRow | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editVerified, setEditVerified] = useState(true);
  const [editNotifications, setEditNotifications] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [removingUser, setRemovingUser] = useState<WhatsAppUserRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const params = new URLSearchParams({
        page: String(userPage),
        pageSize: "20",
      });
      if (userSearch) params.set("search", userSearch);
      if (userRole) params.set("role", userRole);
      const res = await fetch(`/api/admin/whatsapp/users?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal memuat daftar pengguna.");
      setUsers(data.users ?? []);
      setUserTotalPages(data.totalPages ?? 1);
      setUserSummary(data.summary ?? { verified: 0, withoutNumber: 0 });
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Terjadi kesalahan.");
    } finally {
      setUsersLoading(false);
    }
  }, [userPage, userSearch, userRole]);

  useEffect(() => {
    if (tab === "users") loadUsers();
  }, [tab, loadUsers]);

  const openEditUser = (user: WhatsAppUserRow) => {
    setEditingUser(user);
    setEditNumber("");
    setEditVerified(user.whatsappVerified);
    setEditNotifications(user.whatsappNotificationsEnabled);
    setEditError("");
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;
    setEditSaving(true);
    setEditError("");
    try {
      const payload: Record<string, unknown> = {
        notificationsEnabled: editNotifications,
      };
      if (editNumber.trim()) {
        payload.whatsappNumber = editNumber.trim();
        payload.verified = editVerified;
      } else if (editingUser.hasWhatsappNumber && editVerified !== editingUser.whatsappVerified) {
        payload.verified = editVerified;
      }

      const res = await fetch(`/api/admin/whatsapp/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(data.error || "Gagal memperbarui data WhatsApp pengguna.");
        return;
      }
      setEditingUser(null);
      setUserFeedback({
        type: "success",
        text: `Nomor WhatsApp ${editingUser.name} berhasil diperbarui.`,
      });
      await loadUsers();
    } catch {
      setEditError("Terjadi kesalahan jaringan.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleRemoveUserNumber = async () => {
    if (!removingUser) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/users/${removingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappNumber: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUserFeedback({
          type: "error",
          text: data.error || "Gagal menghapus nomor WhatsApp.",
        });
        return;
      }
      setUserFeedback({
        type: "success",
        text: `Nomor WhatsApp ${removingUser.name} telah dihapus.`,
      });
      setRemovingUser(null);
      await loadUsers();
    } catch {
      setUserFeedback({ type: "error", text: "Terjadi kesalahan jaringan." });
    } finally {
      setRemoving(false);
    }
  };

  // --- Pengumuman ----------------------------------------------------------
  const [annTitle, setAnnTitle] = useState("");
  const [annMessage, setAnnMessage] = useState("");
  const [annAudience, setAnnAudience] = useState<"ALL" | "ROLE" | "USER">("ALL");
  const [annRole, setAnnRole] = useState("STUDENT");
  const [annCategory, setAnnCategory] =
    useState<(typeof WHATSAPP_BROADCAST_CATEGORIES)[number]>("ANNOUNCEMENT");
  const [annUserId, setAnnUserId] = useState("");
  const [annUserOptions, setAnnUserOptions] = useState<WhatsAppUserRow[]>([]);
  const [annUserOptionsLoading, setAnnUserOptionsLoading] = useState(false);
  const [annSending, setAnnSending] = useState(false);
  const [annFeedback, setAnnFeedback] = useState<Feedback | null>(null);
  const [annResult, setAnnResult] = useState<{
    targetedUsers: number;
    inAppCreated: number;
    whatsappSent: number;
    whatsappSkipped: number;
    whatsappFailed: number;
  } | null>(null);

  useEffect(() => {
    if (tab !== "announce" || annAudience !== "USER" || annUserOptions.length > 0) return;
    let cancelled = false;
    setAnnUserOptionsLoading(true);
    fetch("/api/admin/whatsapp/users?pageSize=100", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Gagal memuat pengguna.");
        if (!cancelled) setAnnUserOptions(data.users ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          setAnnFeedback({
            type: "error",
            text: error instanceof Error ? error.message : "Gagal memuat pengguna.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setAnnUserOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, annAudience, annUserOptions.length]);

  const handleSendAnnouncement = async () => {
    setAnnSending(true);
    setAnnFeedback(null);
    setAnnResult(null);
    try {
      const res = await fetch("/api/admin/whatsapp/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: annTitle.trim(),
          message: annMessage.trim(),
          audience: annAudience,
          ...(annAudience === "ROLE" ? { role: annRole } : {}),
          ...(annAudience === "USER" ? { userId: annUserId } : {}),
          category: annCategory,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setAnnFeedback({
          type: "error",
          text: data.error || "Pengumuman gagal dikirim.",
        });
        return;
      }
      setAnnResult(data.summary);
      setAnnFeedback({
        type: "success",
        text: "Pengumuman berhasil diproses. Notifikasi in-app dan WhatsApp tercatat di riwayat.",
      });
      setAnnTitle("");
      setAnnMessage("");
    } catch {
      setAnnFeedback({ type: "error", text: "Terjadi kesalahan jaringan." });
    } finally {
      setAnnSending(false);
    }
  };

  // --- Riwayat -------------------------------------------------------------
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState("");
  const [deliveryCategory, setDeliveryCategory] = useState("");
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliverySearchInput, setDeliverySearchInput] = useState("");
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveryTotalPages, setDeliveryTotalPages] = useState(1);
  const [deliverySummary, setDeliverySummary] = useState({
    PENDING: 0,
    SENT: 0,
    FAILED: 0,
    SKIPPED: 0,
  });

  const loadDeliveries = useCallback(async () => {
    setDeliveriesLoading(true);
    setDeliveriesError("");
    try {
      const params = new URLSearchParams({
        page: String(deliveryPage),
        pageSize: "20",
      });
      if (deliveryStatus) params.set("status", deliveryStatus);
      if (deliveryCategory) params.set("category", deliveryCategory);
      if (deliverySearch) params.set("search", deliverySearch);
      const res = await fetch(`/api/admin/whatsapp/deliveries?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal memuat riwayat pengiriman.");
      setDeliveries(data.deliveries ?? []);
      setDeliveryTotalPages(data.totalPages ?? 1);
      setDeliverySummary(data.summary ?? { PENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 });
    } catch (error) {
      setDeliveriesError(error instanceof Error ? error.message : "Terjadi kesalahan.");
    } finally {
      setDeliveriesLoading(false);
    }
  }, [deliveryPage, deliveryStatus, deliveryCategory, deliverySearch]);

  useEffect(() => {
    if (tab === "history") loadDeliveries();
  }, [tab, loadDeliveries]);

  const categoryOptions = useMemo(
    () =>
      (config?.allCategories ?? []).map((item) => ({
        value: item.key,
        label: item.label,
      })),
    [config]
  );

  const connectionBadge = useMemo(() => {
    if (!config) return null;
    if (!config.configured) return <Badge variant="danger">Token belum diatur</Badge>;
    if (!config.enabled) return <Badge variant="warning">Notifikasi nonaktif</Badge>;
    if (!config.adminNumber) return <Badge variant="warning">Nomor Admin belum diatur</Badge>;
    if (config.lastConnection.status === "CONNECTED")
      return <Badge variant="success">Terhubung</Badge>;
    if (config.lastConnection.status === "FAILED")
      return <Badge variant="danger">Uji koneksi gagal</Badge>;
    return <Badge variant="default">Belum diuji</Badge>;
  }, [config]);

  if (configLoading && !config) return <LoadingState message="Memuat konfigurasi WhatsApp..." />;
  if (configError && !config) return <ErrorState message={configError} onRetry={loadConfig} />;

  const isReady = Boolean(config?.configured && config?.adminNumber && config?.enabled);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <MessageCircle size={24} className="text-primary flex-shrink-0" aria-hidden="true" />
            Notifikasi WhatsApp
          </h1>
          <p className="page-description">
            Kelola pengiriman notifikasi DigiLib melalui WhatsApp (Fonnte). Token hanya disimpan
            di server dan tidak pernah ditampilkan utuh.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {connectionBadge}
          <Button variant="secondary" size="sm" onClick={loadConfig} disabled={configLoading}>
            <RefreshCw size={15} className={`mr-1.5 ${configLoading ? "animate-spin" : ""}`} />
            Muat Ulang
          </Button>
        </div>
      </div>

      {config && !isReady && (
        <div
          className="flex items-start gap-3 p-4 rounded-xl text-sm"
          style={{ backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}
        >
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div className="min-w-0">
            <p className="font-semibold">Notifikasi WhatsApp belum aktif sepenuhnya.</p>
            <p className="mt-1">
              Pastikan token Fonnte, nomor WhatsApp Admin, dan sakelar notifikasi sudah diatur.
              Tanpa ketiganya, tidak ada pesan yang dikirim ke pengguna.
            </p>
          </div>
        </div>
      )}

      {feedback && (
        <div
          className="flex items-start gap-2 p-3 rounded-lg text-sm"
          style={{
            backgroundColor:
              feedback.type === "success"
                ? "var(--color-success-bg)"
                : feedback.type === "error"
                  ? "var(--color-danger-bg)"
                  : "var(--color-info-bg)",
            color:
              feedback.type === "success"
                ? "var(--color-success-text)"
                : feedback.type === "error"
                  ? "var(--color-danger-text)"
                  : "var(--color-info-text)",
          }}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 size={16} className="flex-shrink-0" />
          ) : feedback.type === "error" ? (
            <AlertTriangle size={16} className="flex-shrink-0" />
          ) : (
            <Info size={16} className="flex-shrink-0" />
          )}
          <span className="min-w-0">{feedback.text}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Menu notifikasi WhatsApp">
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(item.key);
                setFeedback(null);
              }}
              className={`btn ${active ? "btn-primary" : "btn-secondary"} btn-sm`}
            >
              <Icon size={15} className="mr-1.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "config" && config && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wifi size={18} className="text-primary" /> Status Konfigurasi
              </CardTitle>
              <CardDescription>
                Status ini dihitung dari pengaturan tersimpan dan hasil uji koneksi terakhir.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">Token Fonnte</p>
                  <p className="font-semibold text-main mt-1 break-all">
                    {config.tokenMasked ?? "Belum diatur"}
                  </p>
                  <p className="text-xs text-muted mt-1">{sourceLabel(config.tokenSource)}</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">Nomor WhatsApp Admin</p>
                  <p className="font-semibold text-main mt-1 break-all">
                    {config.adminNumber ?? "Belum diatur"}
                  </p>
                  <p className="text-xs text-muted mt-1">{sourceLabel(config.adminNumberSource)}</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs text-muted">Uji koneksi terakhir</p>
                  <p className="font-semibold text-main mt-1">
                    {config.lastConnection.status === "CONNECTED"
                      ? "Berhasil"
                      : config.lastConnection.status === "FAILED"
                        ? "Gagal"
                        : "Belum diuji"}
                  </p>
                  <p className="text-xs text-muted mt-1">
                    {formatDateTime(config.lastConnection.checkedAt)}
                  </p>
                </div>
              </div>
              {config.lastConnection.message && (
                <p className="text-sm text-muted mt-4 break-words">
                  Catatan uji terakhir: {config.lastConnection.message}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 size={18} className="text-primary" /> Pengaturan Fonnte
              </CardTitle>
              <CardDescription>
                Token disimpan terenkripsi. Biarkan kolom token kosong untuk mempertahankan token
                yang sudah tersimpan.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="fonnte-token">
                    Token Fonnte
                  </label>
                  <input
                    id="fonnte-token"
                    className="form-control"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={
                      config.tokenMasked
                        ? `${config.tokenMasked} — kosongkan untuk mempertahankan`
                        : "Masukkan token API Fonnte"
                    }
                  />
                  <p className="text-xs text-muted mt-2">
                    Token hanya dibaca di server. Nilai penuh tidak pernah dikirim kembali ke
                    browser.
                  </p>
                </div>
                <Input
                  label="Nomor WhatsApp Admin (pengirim)"
                  type="tel"
                  inputMode="tel"
                  value={adminNumber}
                  onChange={(event) => setAdminNumber(event.target.value)}
                  placeholder="081234567890"
                />
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer select-none my-2">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                <span className="text-sm text-main">
                  Aktifkan pengiriman notifikasi WhatsApp
                </span>
              </label>

              <div className="mt-5">
                <p className="form-label">Kategori notifikasi aktif</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {config.allCategories.map((item) => {
                    const checked = categories.includes(item.key);
                    return (
                      <label
                        key={item.key}
                        className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          checked={checked}
                          onChange={() => toggleCategory(item.key)}
                        />
                        <span className="text-sm text-main">{item.label}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted mt-2">
                  Notifikasi untuk kategori yang tidak dicentang tetap tercatat in-app, tetapi tidak
                  dikirim ke WhatsApp.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-6">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save size={16} className="mr-2" />
                  {saving ? "Menyimpan..." : "Simpan Konfigurasi"}
                </Button>
                <Button variant="secondary" onClick={handleTestConnection} disabled={testing}>
                  {testing ? (
                    <Loader2 size={16} className="mr-2 animate-spin" />
                  ) : (
                    <Wifi size={16} className="mr-2" />
                  )}
                  {testing ? "Menguji..." : "Uji Koneksi"}
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send size={18} className="text-primary" /> Kirim Pesan Percobaan
              </CardTitle>
              <CardDescription>
                Pesan dikirim dari nomor Admin. Kosongkan tujuan untuk mengirim ke nomor Admin
                sendiri. Hasil tercatat pada riwayat dengan kategori Pesan Percobaan.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <div className="grid gap-4 lg:grid-cols-2">
                <Input
                  label="Nomor tujuan (opsional)"
                  type="tel"
                  inputMode="tel"
                  value={testTarget}
                  onChange={(event) => setTestTarget(event.target.value)}
                  placeholder={config.adminNumber ?? "081234567890"}
                />
                <div>
                  <label className="form-label" htmlFor="test-message-body">
                    Pesan khusus (opsional)
                  </label>
                  <textarea
                    id="test-message-body"
                    className="form-control"
                    rows={4}
                    maxLength={1000}
                    value={testCustomMessage}
                    onChange={(event) => setTestCustomMessage(event.target.value)}
                    placeholder="Kosongkan untuk memakai pesan percobaan bawaan."
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Button
                  onClick={handleSendTest}
                  disabled={sendingTest || !config.configured || !config.adminNumber}
                >
                  {sendingTest ? (
                    <Loader2 size={16} className="mr-2 animate-spin" />
                  ) : (
                    <Send size={16} className="mr-2" />
                  )}
                  {sendingTest ? "Mengirim..." : "Kirim Pesan Percobaan"}
                </Button>
                {(testFeedback ?? feedback) && (
                  <span
                    className="text-sm inline-flex items-center gap-1.5"
                    style={{
                      color:
                        (testFeedback ?? feedback)?.type === "success"
                          ? "var(--color-success-text)"
                          : (testFeedback ?? feedback)?.type === "error"
                            ? "var(--color-danger-text)"
                            : "var(--color-info-text)",
                    }}
                  >
                    {(testFeedback ?? feedback)?.type === "success" ? (
                      <CheckCircle2 size={15} />
                    ) : (testFeedback ?? feedback)?.type === "error" ? (
                      <AlertTriangle size={15} />
                    ) : (
                      <Info size={15} />
                    )}
                    {(testFeedback ?? feedback)?.text}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mt-4">
                Pengiriman dianggap berhasil hanya bila Fonnte membalas status sukses. HTTP 200
                tanpa status sukses tetap dicatat sebagai gagal.
              </p>
            </CardBody>
          </Card>
        </>
      )}

      {tab === "announce" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone size={18} className="text-primary" /> Pengumuman &amp; Gangguan Sistem
            </CardTitle>
            <CardDescription>
              Pengumuman selalu dibuat sebagai notifikasi in-app. WhatsApp hanya dikirim ke
              pengguna dengan nomor terverifikasi dan notifikasi aktif.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <div className="grid gap-4 lg:grid-cols-2">
              <Input
                label="Judul pengumuman"
                value={annTitle}
                maxLength={120}
                onChange={(event) => setAnnTitle(event.target.value)}
                placeholder="Contoh: Perpustakaan tutup sementara"
              />
              <Select
                label="Kategori"
                value={annCategory}
                onChange={(event) =>
                  setAnnCategory(
                    event.target.value as (typeof WHATSAPP_BROADCAST_CATEGORIES)[number]
                  )
                }
              >
                {WHATSAPP_BROADCAST_CATEGORIES.map((key) => (
                  <option key={key} value={key}>
                    {WHATSAPP_CATEGORY_LABELS[key]}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="form-label" htmlFor="announcement-body">
                Isi pengumuman
              </label>
              <textarea
                id="announcement-body"
                className="form-control"
                rows={6}
                maxLength={2000}
                value={annMessage}
                onChange={(event) => setAnnMessage(event.target.value)}
                placeholder="Tuliskan informasi yang akan dikirim ke pengguna."
              />
              <p className="text-xs text-muted mt-1">{annMessage.length}/2000 karakter</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-3 mt-4">
              <Select
                label="Tujuan"
                value={annAudience}
                onChange={(event) => {
                  setAnnAudience(event.target.value as "ALL" | "ROLE" | "USER");
                  setAnnUserId("");
                }}
              >
                <option value="ALL">Semua pengguna aktif</option>
                <option value="ROLE">Role tertentu</option>
                <option value="USER">Satu pengguna</option>
              </Select>

              {annAudience === "ROLE" && (
                <Select
                  label="Role tujuan"
                  value={annRole}
                  onChange={(event) => setAnnRole(event.target.value)}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </Select>
              )}

              {annAudience === "USER" && (
                <Select
                  label="Pengguna tujuan"
                  value={annUserId}
                  onChange={(event) => setAnnUserId(event.target.value)}
                  disabled={annUserOptionsLoading}
                >
                  <option value="">
                    {annUserOptionsLoading ? "Memuat pengguna..." : "Pilih pengguna"}
                  </option>
                  {annUserOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} — {roleLabel(user.role)}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            {annFeedback && (
              <div
                className="flex items-start gap-2 p-3 rounded-lg text-sm mt-4"
                style={{
                  backgroundColor:
                    annFeedback.type === "success"
                      ? "var(--color-success-bg)"
                      : "var(--color-danger-bg)",
                  color:
                    annFeedback.type === "success"
                      ? "var(--color-success-text)"
                      : "var(--color-danger-text)",
                }}
              >
                {annFeedback.type === "success" ? (
                  <CheckCircle2 size={16} className="flex-shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="flex-shrink-0" />
                )}
                <span className="min-w-0">{annFeedback.text}</span>
              </div>
            )}

            {annResult && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-4">
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted">Target pengguna</p>
                  <p className="text-lg font-semibold text-main">{annResult.targetedUsers}</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted">Notifikasi in-app</p>
                  <p className="text-lg font-semibold text-main">{annResult.inAppCreated}</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted">WhatsApp terkirim</p>
                  <p className="text-lg font-semibold" style={{ color: "var(--color-success-text)" }}>
                    {annResult.whatsappSent}
                  </p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted">Dilewati / gagal</p>
                  <p className="text-lg font-semibold text-main">
                    {annResult.whatsappSkipped} / {annResult.whatsappFailed}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6">
              <Button
                onClick={handleSendAnnouncement}
                disabled={
                  annSending ||
                  annTitle.trim().length < 3 ||
                  annMessage.trim().length < 3 ||
                  (annAudience === "USER" && !annUserId)
                }
              >
                {annSending ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <Megaphone size={16} className="mr-2" />
                )}
                {annSending ? "Mengirim..." : "Kirim Pengumuman"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "users" && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Phone size={18} className="text-primary" /> Nomor WhatsApp Pengguna
                </CardTitle>
                <CardDescription>
                  Nomor lengkap tidak ditampilkan. Administrator dapat menetapkan, memverifikasi,
                  atau menghapus nomor; setiap nomor unik untuk satu akun.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="success">
                  <ShieldCheck size={12} className="mr-1" /> {userSummary.verified} terverifikasi
                </Badge>
                <Badge variant="default">{userSummary.withoutNumber} tanpa nomor</Badge>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <form
              className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4"
              onSubmit={(event) => {
                event.preventDefault();
                setUserPage(1);
                setUserSearch(userSearchInput.trim());
              }}
            >
              <div className="flex-1 min-w-0">
                <Input
                  label="Cari pengguna"
                  value={userSearchInput}
                  onChange={(event) => setUserSearchInput(event.target.value)}
                  placeholder="Nama, email, atau NIS/NIP"
                />
              </div>
              <div className="w-full sm:w-48">
                <Select
                  label="Role"
                  value={userRole}
                  onChange={(event) => {
                    setUserPage(1);
                    setUserRole(event.target.value);
                  }}
                >
                  <option value="">Semua role</option>
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="mb-4">
                <Button type="submit" variant="secondary">
                  Cari
                </Button>
              </div>
            </form>

            {userFeedback && (
              <div
                className="flex items-start gap-2 p-3 rounded-lg text-sm mb-4"
                style={{
                  backgroundColor:
                    userFeedback.type === "success"
                      ? "var(--color-success-bg)"
                      : "var(--color-danger-bg)",
                  color:
                    userFeedback.type === "success"
                      ? "var(--color-success-text)"
                      : "var(--color-danger-text)",
                }}
              >
                {userFeedback.type === "success" ? (
                  <CheckCircle2 size={16} className="flex-shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="flex-shrink-0" />
                )}
                <span className="min-w-0">{userFeedback.text}</span>
              </div>
            )}

            {usersLoading ? (
              <LoadingState message="Memuat data pengguna..." />
            ) : usersError ? (
              <ErrorState message={usersError} onRetry={loadUsers} />
            ) : users.length === 0 ? (
              <EmptyState
                title="Tidak ada pengguna"
                description="Tidak ada pengguna yang cocok dengan pencarian atau filter role."
                icon={<Users size={28} />}
              />
            ) : (
              <>
                <TableContainer>
                  <Table>
                    <Thead>
                      <tr>
                        <Th>Pengguna</Th>
                        <Th>Role</Th>
                        <Th>Nomor WhatsApp</Th>
                        <Th>Status</Th>
                        <Th>Notifikasi</Th>
                        <Th>Aksi</Th>
                      </tr>
                    </Thead>
                    <Tbody>
                      {users.map((user) => (
                        <Tr key={user.id}>
                          <Td>
                            <div className="min-w-0">
                              <p className="font-medium text-main truncate">{user.name}</p>
                              <p className="text-xs text-muted truncate">{user.email}</p>
                            </div>
                          </Td>
                          <Td>{roleLabel(user.role)}</Td>
                          <Td className="whitespace-nowrap">
                            {user.whatsappNumberMasked ?? (
                              <span className="text-muted">Belum ada</span>
                            )}
                          </Td>
                          <Td>
                            {user.whatsappVerified ? (
                              <Badge variant="success">Terverifikasi</Badge>
                            ) : user.hasWhatsappNumber ? (
                              <Badge variant="warning">Belum verifikasi</Badge>
                            ) : (
                              <Badge variant="default">Tanpa nomor</Badge>
                            )}
                          </Td>
                          <Td>
                            {user.whatsappNotificationsEnabled ? (
                              <Badge variant="info">Aktif</Badge>
                            ) : (
                              <Badge variant="default">Nonaktif</Badge>
                            )}
                          </Td>
                          <Td>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openEditUser(user)}
                              >
                                Atur
                              </Button>
                              {user.hasWhatsappNumber && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setRemovingUser(user)}
                                  aria-label={`Hapus nomor WhatsApp ${user.name}`}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              )}
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </TableContainer>
                <Pagination
                  currentPage={userPage}
                  totalPages={userTotalPages}
                  onPageChange={setUserPage}
                />
              </>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "history" && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <History size={18} className="text-primary" /> Riwayat Pengiriman WhatsApp
              </CardTitle>
              <CardDescription>
                Setiap percobaan pengiriman tercatat. Status &ldquo;Terkirim&rdquo; hanya diberikan
                bila Fonnte membalas sukses.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted">Terkirim</p>
                <p className="text-lg font-semibold" style={{ color: "var(--color-success-text)" }}>
                  {deliverySummary.SENT}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted">Diproses</p>
                <p className="text-lg font-semibold text-main">{deliverySummary.PENDING}</p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted">Gagal</p>
                <p className="text-lg font-semibold" style={{ color: "var(--color-danger-text)" }}>
                  {deliverySummary.FAILED}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted">Dilewati</p>
                <p className="text-lg font-semibold text-main">{deliverySummary.SKIPPED}</p>
              </div>
            </div>

            <form
              className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4"
              onSubmit={(event) => {
                event.preventDefault();
                setDeliveryPage(1);
                setDeliverySearch(deliverySearchInput.trim());
              }}
            >
              <div className="flex-1 min-w-0">
                <Input
                  label="Cari"
                  value={deliverySearchInput}
                  onChange={(event) => setDeliverySearchInput(event.target.value)}
                  placeholder="Judul atau nomor penerima"
                />
              </div>
              <div className="w-full sm:w-44">
                <Select
                  label="Status"
                  value={deliveryStatus}
                  onChange={(event) => {
                    setDeliveryPage(1);
                    setDeliveryStatus(event.target.value);
                  }}
                >
                  <option value="">Semua status</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-full sm:w-52">
                <Select
                  label="Kategori"
                  value={deliveryCategory}
                  onChange={(event) => {
                    setDeliveryPage(1);
                    setDeliveryCategory(event.target.value);
                  }}
                >
                  <option value="">Semua kategori</option>
                  {categoryOptions.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="mb-4">
                <Button type="submit" variant="secondary">
                  Terapkan
                </Button>
              </div>
            </form>

            {deliveriesLoading ? (
              <LoadingState message="Memuat riwayat pengiriman..." />
            ) : deliveriesError ? (
              <ErrorState message={deliveriesError} onRetry={loadDeliveries} />
            ) : deliveries.length === 0 ? (
              <EmptyState
                title="Belum ada riwayat"
                description="Belum ada pengiriman WhatsApp yang cocok dengan filter saat ini."
                icon={<History size={28} />}
              />
            ) : (
              <>
                <TableContainer>
                  <Table>
                    <Thead>
                      <tr>
                        <Th>Waktu</Th>
                        <Th>Kategori</Th>
                        <Th>Judul</Th>
                        <Th>Penerima</Th>
                        <Th>Status</Th>
                        <Th>Detail</Th>
                      </tr>
                    </Thead>
                    <Tbody>
                      {deliveries.map((delivery) => (
                        <Tr key={delivery.id}>
                          <Td className="whitespace-nowrap">{formatDateTime(delivery.createdAt)}</Td>
                          <Td className="whitespace-nowrap">{categoryLabel(delivery.category)}</Td>
                          <Td>
                            <p className="font-medium text-main max-w-[22rem] truncate">
                              {delivery.title}
                            </p>
                          </Td>
                          <Td className="whitespace-nowrap">{delivery.recipientNumber || "—"}</Td>
                          <Td>{statusBadge(delivery.status)}</Td>
                          <Td>
                            <span
                              className="text-xs text-muted block max-w-[18rem] truncate"
                              title={delivery.errorMessage ?? delivery.providerStatus ?? undefined}
                            >
                              {delivery.status === "SENT"
                                ? delivery.providerStatus || "Terkirim"
                                : delivery.errorMessage || delivery.providerStatus || "—"}
                            </span>
                            <span className="text-xs text-muted block">
                              {formatDateTime(delivery.sentAt)}
                            </span>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </TableContainer>
                <Pagination
                  currentPage={deliveryPage}
                  totalPages={deliveryTotalPages}
                  onPageChange={setDeliveryPage}
                />
              </>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        isOpen={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title={
          editingUser ? `Kelola WhatsApp — ${editingUser.name}` : "Kelola WhatsApp Pengguna"
        }
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setEditingUser(null)} disabled={editSaving}>
              Batal
            </Button>
            <Button onClick={handleSaveUser} disabled={editSaving}>
              <Save size={16} className="mr-2" />
              {editSaving ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        }
      >
        {editingUser && (
          <div className="flex flex-col gap-4">
            <div className="text-sm text-muted">
              <p>
                Nomor saat ini:{" "}
                <span className="text-main font-medium">
                  {editingUser.whatsappNumberMasked ?? "Belum ada"}
                </span>
              </p>
              <p className="mt-1">{editingUser.email} — {roleLabel(editingUser.role)}</p>
            </div>

            <Input
              label="Nomor WhatsApp baru (opsional)"
              type="tel"
              inputMode="tel"
              value={editNumber}
              onChange={(event) => setEditNumber(event.target.value)}
              placeholder={
                editingUser.hasWhatsappNumber
                  ? "Kosongkan untuk mempertahankan nomor saat ini"
                  : "081234567890"
              }
            />

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={editVerified}
                onChange={(event) => setEditVerified(event.target.checked)}
              />
              <span className="text-sm text-main">
                Tandai nomor terverifikasi (dapat menerima notifikasi)
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={editNotifications}
                onChange={(event) => setEditNotifications(event.target.checked)}
              />
              <span className="text-sm text-main">Aktifkan notifikasi WhatsApp untuk pengguna ini</span>
            </label>

            {editError && (
              <div
                className="flex items-start gap-2 p-3 rounded-lg text-sm"
                style={{
                  backgroundColor: "var(--color-danger-bg)",
                  color: "var(--color-danger-text)",
                }}
              >
                <AlertTriangle size={16} className="flex-shrink-0" />
                <span className="min-w-0">{editError}</span>
              </div>
            )}

            <p className="text-xs text-muted">
              Menetapkan nomor secara manual akan menandainya terverifikasi. Pengguna juga dapat
              memverifikasi nomornya sendiri melalui halaman Profil dengan kode OTP.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(removingUser)}
        onClose={() => setRemovingUser(null)}
        title="Hapus Nomor WhatsApp"
        size="sm"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setRemovingUser(null)} disabled={removing}>
              Batal
            </Button>
            <Button variant="danger" onClick={handleRemoveUserNumber} disabled={removing}>
              <Trash2 size={16} className="mr-2" />
              {removing ? "Menghapus..." : "Hapus Nomor"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-main">
          Hapus nomor WhatsApp{" "}
          <span className="font-semibold">{removingUser?.whatsappNumberMasked}</span> milik{" "}
          <span className="font-semibold">{removingUser?.name}</span>?
        </p>
        <p className="text-sm text-muted mt-2">
          Akun, transaksi, dan riwayat lain tidak terhapus. Pengguna tidak akan menerima notifikasi
          WhatsApp sampai memverifikasi nomor baru.
        </p>
      </Modal>
    </div>
  );
}
