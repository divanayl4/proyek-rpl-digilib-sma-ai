"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  List,
  PlugZap,
  Power,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  isAIProviderId,
  type AIProviderId,
} from "@/lib/ai/providers";

interface PublicConfig {
  provider: AIProviderId;
  model: string;
  fallbackModels: string[];
  disableThinking: boolean;
  baseUrl: string;
  updatedAt: string;
  updatedBy: string | null;
  activatedAt?: string;
  hasApiKey: boolean;
  apiKeyValid: boolean;
}

interface LastTest {
  ok: boolean;
  category: string;
  message: string;
  at: string;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  httpStatus: number | null;
  testedBy: string | null;
  configFingerprint: string | null;
}

interface PublicState {
  configured: boolean;
  source: "DATABASE" | "ENV" | "NONE" | "INVALID";
  effective: {
    provider: string | null;
    providerLabel: string | null;
    model: string | null;
    fallbackModels: string[];
    baseUrl: string | null;
    disableThinking: boolean;
  };
  active: PublicConfig | null;
  draft: PublicConfig | null;
  env: {
    configured: boolean;
    provider: string;
    providerLabel: string;
    model: string;
    baseUrl: string;
    disableThinking: boolean;
  };
  lastTest: LastTest | null;
  diagnostics?: {
    runtimeSource: "DATABASE" | "ENV" | "NONE" | "INVALID";
    draft: {
      present: boolean;
      secretPresent: boolean;
      secretValid: boolean;
      testedSuccessfully: boolean;
      changedSinceTest: boolean;
    };
    active: {
      present: boolean;
      secretPresent: boolean;
      secretValid: boolean;
    };
    encryption: {
      source: "AI_CONFIG_ENCRYPTION_KEY" | "NEXTAUTH_SECRET" | null;
      fallbackInUse: boolean;
    };
    env: {
      configured: boolean;
      keyAvailableForDraftProvider: boolean;
      providerMatchesDraft: boolean;
    };
    lastTest: {
      ok: boolean;
      category: string;
      at: string;
    } | null;
    nextAction: {
      code:
        | "NONE"
        | "SAVE_DRAFT"
        | "PROVIDE_KEY"
        | "FIX_KEY"
        | "TEST_DRAFT"
        | "RETRY_TEST"
        | "ACTIVATE_DRAFT"
        | "FIX_ACTIVE";
      message: string;
    };
  };
  encryption: {
    available: boolean;
    source: "AI_CONFIG_ENCRYPTION_KEY" | "NEXTAUTH_SECRET" | null;
    message: string | null;
  };
  message: string | null;
}

interface FormState {
  provider: AIProviderId;
  model: string;
  fallbackModels: string;
  disableThinking: boolean;
}

type Feedback = { type: "success" | "error" | "info"; message: string } | null;
type ConfirmKind = "activate" | "deactivate" | "discard" | "clearKey" | null;

function defaultForm(state: PublicState): FormState {
  const source = state.draft ?? state.active;
  if (source) {
    return {
      provider: source.provider,
      model: source.model,
      fallbackModels: source.fallbackModels.join(", "),
      disableThinking: source.disableThinking,
    };
  }
  const envProvider = isAIProviderId(state.env.provider)
    ? state.env.provider
    : ("NVIDIA" as AIProviderId);
  return {
    provider: envProvider,
    model: state.env.configured ? state.env.model : "",
    fallbackModels: "",
    disableThinking: true,
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return value;
  }
}

function categoryLabel(category: string): string {
  switch (category) {
    case "SUCCESS":
      return "Berhasil";
    case "AUTH":
      return "Autentikasi";
    case "MODEL":
      return "Model";
    case "RATE_LIMIT":
      return "Rate limit";
    case "QUOTA":
      return "Kuota";
    case "NETWORK":
      return "Jaringan";
    case "TIMEOUT":
      return "Timeout";
    case "PROVIDER_UNAVAILABLE":
      return "Provider gangguan";
    case "INVALID_RESPONSE":
      return "Respons tidak valid";
    case "INVALID_REQUEST":
      return "Request ditolak";
    case "INVALID_CONFIG":
      return "Konfigurasi tidak valid";
    default:
      return "Tidak diketahui";
  }
}

function categoryVariant(category: string): "success" | "warning" | "danger" | "info" {
  if (category === "SUCCESS") return "success";
  if (category === "RATE_LIMIT" || category === "QUOTA" || category === "TIMEOUT") {
    return "warning";
  }
  if (
    category === "UNKNOWN" ||
    category === "INVALID_RESPONSE" ||
    category === "INVALID_REQUEST"
  ) {
    return "info";
  }
  return "danger";
}

function sourceLabel(source: PublicState["source"]): string {
  switch (source) {
    case "DATABASE":
      return "Aktif dari database";
    case "ENV":
      return "Fallback .env";
    case "INVALID":
      return "Konfigurasi aktif bermasalah";
    default:
      return "Belum dikonfigurasi";
  }
}

export default function AIConfigView() {
  const [state, setState] = useState<PublicState | null>(null);
  const [form, setForm] = useState<FormState>({
    provider: "NVIDIA",
    model: "",
    fallbackModels: "",
    disableThinking: true,
  });
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<LastTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadError, setLoadError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  const applyState = useCallback((next: PublicState, resetForm = true) => {
    setState(next);
    if (resetForm) setForm(defaultForm(next));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/ai-config", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal memuat konfigurasi AI.");
      applyState(data.state as PublicState);
      setTestResult((data.state as PublicState).lastTest ?? null);
      setApiKey("");
      setShowKey(false);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Gagal memuat konfigurasi AI."
      );
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedProvider = AI_PROVIDERS[form.provider];
  const serverConfig = state?.draft ?? state?.active ?? null;

  const dirty = useMemo(() => {
    if (!serverConfig) return true;
    if (apiKey.trim().length > 0) return true;
    return (
      serverConfig.provider !== form.provider ||
      serverConfig.model !== form.model.trim() ||
      serverConfig.fallbackModels.join(", ") !== form.fallbackModels.trim() ||
      (form.provider === "NVIDIA" &&
        serverConfig.disableThinking !== form.disableThinking)
    );
  }, [apiKey, form, serverConfig]);

  const storedKeyForProvider = Boolean(
    (state?.draft?.provider === form.provider && state.draft.hasApiKey) ||
      (state?.active?.provider === form.provider && state.active.hasApiKey)
  );
  const envKeyForProvider = Boolean(
    state?.env.configured && state.env.provider === form.provider
  );
  const keyAvailable =
    apiKey.trim().length > 0 || storedKeyForProvider || envKeyForProvider;
  const providerChangedFromActive =
    Boolean(state?.active) && state?.active?.provider !== form.provider;

  const buildPayload = useCallback(
    (includeKey: boolean) => {
      const payload: Record<string, unknown> = {
        provider: form.provider,
        model: form.model.trim(),
        fallbackModels: form.fallbackModels
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        disableThinking: form.disableThinking,
      };
      if (includeKey && apiKey.trim().length > 0) {
        payload.apiKey = apiKey.trim();
      }
      return payload;
    },
    [form, apiKey]
  );

  const saveDraft = useCallback(async (): Promise<PublicState | null> => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(true)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error || "Gagal menyimpan konfigurasi AI.",
        });
        return null;
      }
      applyState(data.state as PublicState, false);
      setApiKey("");
      setShowKey(false);
      setFeedback({
        type: "success",
        message:
          data.message ||
          "Draft konfigurasi disimpan. Konfigurasi aktif belum berubah.",
      });
      return data.state as PublicState;
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan." });
      return null;
    } finally {
      setSaving(false);
    }
  }, [applyState, buildPayload]);

  const runTest = useCallback(async () => {
    setTesting(true);
    setFeedback(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/ai-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(true)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure: LastTest = {
          ok: false,
          category: typeof data.category === "string" ? data.category : "INVALID_CONFIG",
          message: data.error || "Uji koneksi gagal.",
          at: new Date().toISOString(),
          provider: form.provider,
          model: form.model.trim() || null,
          latencyMs: null,
          httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : null,
          testedBy: null,
          configFingerprint: null,
        };
        setTestResult(failure);
        setFeedback({ type: "error", message: failure.message });
        if (data.state) applyState(data.state as PublicState, false);
        return;
      }
      const result: LastTest = {
        ok: Boolean(data.ok),
        category: typeof data.category === "string" ? data.category : "UNKNOWN",
        message: typeof data.message === "string" ? data.message : "",
        at: typeof data.testedAt === "string" ? data.testedAt : new Date().toISOString(),
        provider: typeof data.provider === "string" ? data.provider : form.provider,
        model: typeof data.model === "string" ? data.model : form.model.trim(),
        latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
        httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : null,
        testedBy: null,
        configFingerprint: null,
      };
      setTestResult(result);
      setFeedback({
        type: result.ok ? "success" : "error",
        message: result.message,
      });
      if (data.state) applyState(data.state as PublicState, false);
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan saat uji koneksi." });
    } finally {
      setTesting(false);
    }
  }, [form, buildPayload, applyState]);

  const activate = useCallback(async () => {
    setActivating(true);
    setFeedback(null);
    try {
      // Pastikan konfigurasi yang akan diuji/diaktifkan tersimpan sebagai draft.
      if (dirty || apiKey.trim().length > 0) {
        const savedState = await saveDraft();
        if (!savedState) return;
      }

      const res = await fetch("/api/admin/ai-config/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.test) setTestResult(data.test as LastTest);
        setFeedback({
          type: "error",
          message: data.error || "Aktivasi konfigurasi gagal.",
        });
        if (data.state) applyState(data.state as PublicState, false);
        return;
      }
      applyState(data.state as PublicState, false);
      if (data.test) setTestResult(data.test as LastTest);
      setApiKey("");
      setShowKey(false);
      setFeedback({
        type: "success",
        message:
          data.message ||
          "Konfigurasi AI berhasil diaktifkan dan berlaku untuk request berikutnya.",
      });
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan saat aktivasi." });
    } finally {
      setActivating(false);
    }
  }, [applyState, apiKey, dirty, saveDraft]);

  const deactivate = useCallback(async () => {
    setDeactivating(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai-config/deactivate", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error || "Gagal menonaktifkan konfigurasi AI.",
        });
        return;
      }
      applyState(data.state as PublicState, true);
      setFeedback({ type: "success", message: data.message });
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan." });
    } finally {
      setDeactivating(false);
    }
  }, [applyState]);

  const discard = useCallback(async () => {
    setClearing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "draft" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Gagal membuang draft." });
        return;
      }
      applyState(data.state as PublicState, true);
      setTestResult((data.state as PublicState).lastTest ?? null);
      setApiKey("");
      setModels([]);
      setFeedback({ type: "success", message: data.message });
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan." });
    } finally {
      setClearing(false);
    }
  }, [applyState]);

  const clearDraftKey = useCallback(async () => {
    setClearing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "key" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Gagal menghapus API key draft." });
        return;
      }
      applyState(data.state as PublicState, false);
      setApiKey("");
      setFeedback({ type: "success", message: data.message });
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan." });
    } finally {
      setClearing(false);
    }
  }, [applyState]);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ai-config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(true)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message:
            data.error ||
            "Daftar model tidak dapat dimuat. Masukkan nama model secara manual.",
        });
        return;
      }
      const list = Array.isArray(data.models)
        ? (data.models as unknown[]).filter((item): item is string => typeof item === "string")
        : [];
      setModels(list);
      if (list.length === 0) {
        setFeedback({
          type: "info",
          message:
            "Provider tidak mengembalikan model. Masukkan nama model secara manual.",
        });
      } else {
        setFeedback({
          type: "success",
          message: `${list.length} model dimuat dari provider. Pilih dari daftar atau ketik manual.`,
        });
      }
    } catch {
      setFeedback({ type: "error", message: "Terjadi kesalahan jaringan saat memuat model." });
    } finally {
      setLoadingModels(false);
    }
  }, [buildPayload]);

  const handleProviderChange = (provider: AIProviderId) => {
    setForm((prev) => ({
      ...prev,
      provider,
      // Jangan bawa model/fallback dari provider lain.
      model: state?.active?.provider === provider ? state.active.model : "",
      fallbackModels:
        state?.active?.provider === provider
          ? state.active.fallbackModels.join(", ")
          : "",
      disableThinking: provider === "NVIDIA" ? true : false,
    }));
    setModels([]);
    setTestResult(null);
    setApiKey("");
    setShowKey(false);
  };

  if (loading) return <LoadingState message="Memuat konfigurasi AI..." />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!state) return <ErrorState message="Konfigurasi AI tidak tersedia." onRetry={load} />;

  const visibleTest = testResult ?? state.lastTest;
  const draftPending = Boolean(state.draft);
  const active = state.active;
  const providerDef = selectedProvider;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-heading flex items-center gap-2">
            <Bot size={24} className="text-primary flex-shrink-0" aria-hidden="true" />
            Konfigurasi AI
          </h1>
          <p className="page-description">
            Kelola provider, API key, dan model AI Assistant. Perubahan baru dipakai
            runtime setelah diuji dan diaktifkan.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={state.source === "DATABASE" ? "success" : state.source === "ENV" ? "warning" : state.source === "INVALID" ? "danger" : "default"}>
            {sourceLabel(state.source)}
          </Badge>
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={15} className="mr-1.5" />
            Muat Ulang
          </Button>
        </div>
      </div>

      <div className="ai-config-alerts">
        {state.message && (
          <div
            className="flex items-start gap-3 p-4 rounded-xl text-sm"
            style={{
              backgroundColor:
                state.source === "INVALID"
                  ? "var(--color-danger-bg)"
                  : state.source === "ENV"
                    ? "var(--color-warning-bg)"
                    : "var(--color-info-bg)",
              color:
                state.source === "INVALID"
                  ? "var(--color-danger-text)"
                  : state.source === "ENV"
                    ? "var(--color-warning-text)"
                    : "var(--color-info-text)",
            }}
          >
            {state.source === "INVALID" ? (
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            ) : (
              <Info size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            )}
            <span className="min-w-0">{state.message}</span>
          </div>
        )}

        {state.diagnostics && state.source !== "DATABASE" && (
          <div
            className="flex items-start gap-3 p-4 rounded-xl text-sm"
            style={{
              backgroundColor:
                state.source === "INVALID"
                  ? "var(--color-danger-bg)"
                  : "var(--color-info-bg)",
              color:
                state.source === "INVALID"
                  ? "var(--color-danger-text)"
                  : "var(--color-info-text)",
            }}
          >
            <Info size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div className="min-w-0">
              <p className="font-semibold">Langkah berikutnya</p>
              <p className="mt-1">{state.diagnostics.nextAction.message}</p>
            </div>
          </div>
        )}
      </div>

      {!state.encryption.available && (
        <div
          className="flex items-start gap-3 p-4 rounded-xl text-sm"
          style={{ backgroundColor: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}
        >
          <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="font-semibold">Kunci enkripsi server belum tersedia.</p>
            <p className="mt-1">{state.encryption.message}</p>
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
                : feedback.type === "info"
                  ? "var(--color-info-bg)"
                  : "var(--color-danger-bg)",
            color:
              feedback.type === "success"
                ? "var(--color-success-text)"
                : feedback.type === "info"
                  ? "var(--color-info-text)"
                  : "var(--color-danger-text)",
          }}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 size={16} className="flex-shrink-0" />
          ) : feedback.type === "info" ? (
            <Info size={16} className="flex-shrink-0" />
          ) : (
            <AlertTriangle size={16} className="flex-shrink-0" />
          )}
          <span className="min-w-0">{feedback.message}</span>
        </div>
      )}

      <div className="ai-config-layout">
        <div className="ai-config-column">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server size={18} className="text-primary" /> A. Provider AI
              </CardTitle>
              <CardDescription>
                Pilih provider. Endpoint provider menggunakan daftar tetap yang sudah
                dikenal; URL arbitrer tidak diizinkan untuk mencegah SSRF.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <div className="ai-config-form">
                <div className="ai-config-provider-grid">
                  <Select
                    label="Provider"
                    value={form.provider}
                    onChange={(event) => {
                      if (isAIProviderId(event.target.value)) {
                        handleProviderChange(event.target.value);
                      }
                    }}
                  >
                    {AI_PROVIDER_IDS.map((id) => (
                      <option key={id} value={id}>
                        {AI_PROVIDERS[id].label}
                      </option>
                    ))}
                  </Select>

                  <div className="rounded-xl border border-border p-4 mb-4">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-semibold text-main">{providerDef.label}</span>
                      <Badge variant="info">{providerDef.protocolLabel}</Badge>
                      <Badge
                        variant={providerDef.toolCalling === "supported" ? "success" : "warning"}
                      >
                        Tool calling:{" "}
                        {providerDef.toolCalling === "supported"
                          ? "didukung adapter"
                          : "tergantung model"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted break-words">{providerDef.description}</p>
                    <p className="text-xs text-muted mt-2 text-wrap-anywhere">
                      Endpoint: {providerDef.baseUrl}
                    </p>
                    <p className="text-xs text-muted mt-2 break-words">
                      {providerDef.toolCallingNote}
                    </p>
                    {providerDef.notes.map((note) => (
                      <p key={note} className="text-xs text-muted mt-1 break-words">
                        • {note}
                      </p>
                    ))}
                  </div>
                </div>

                {providerDef.toolCalling === "model-dependent" && (
                  <div
                    className="flex items-start gap-2 p-3 rounded-lg text-xs"
                    style={{ backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}
                  >
                    <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      Model AI wajib mendukung function calling agar seluruh kemampuan
                      AI Assistant (katalog, transaksi, denda) berfungsi. Uji koneksi
                      hanya memastikan model merespons; uji tool calling per model
                      belum dapat dijamin dari halaman ini.
                    </span>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound size={18} className="text-primary" /> B. API Key
              </CardTitle>
              <CardDescription>
                API key disimpan terenkripsi AES-256-GCM di server. Nilai lengkap tidak
                pernah dikirim kembali ke browser.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <div className="ai-config-form">
                <label className="form-label" htmlFor="ai-api-key">
                  {providerDef.keyLabel}
                </label>
                <div className="relative mb-2">
                  <input
                    id="ai-api-key"
                    className="form-control pr-12"
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder={
                      storedKeyForProvider
                        ? "API key tersimpan — isi hanya jika ingin mengganti"
                        : "Masukkan API key provider"
                    }
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted hover:bg-surface-hover"
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={showKey ? "Sembunyikan API key" : "Tampilkan API key"}
                  >
                    {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap mb-4">
                  {storedKeyForProvider ? (
                    <Badge variant="success">
                      <ShieldCheck size={13} className="mr-1" /> API key telah tersimpan
                    </Badge>
                  ) : envKeyForProvider ? (
                    <Badge variant="info">
                      <ShieldCheck size={13} className="mr-1" /> API key .env server tersedia
                    </Badge>
                  ) : (
                    <Badge variant="warning">API key belum tersimpan untuk provider ini</Badge>
                  )}
                  {apiKey.trim().length > 0 && (
                    <Badge variant="info">API key baru sedang dimasukkan</Badge>
                  )}
                </div>

                {providerChangedFromActive && !keyAvailable && (
                  <div
                    className="flex items-start gap-2 p-3 rounded-lg text-xs mb-4"
                    style={{ backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}
                  >
                    <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      Provider berbeda dari konfigurasi aktif. API key provider baru wajib
                      dimasukkan; API key provider lama tidak dipakai ulang.
                    </span>
                  </div>
                )}

                {state.draft?.hasApiKey && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirm("clearKey")}
                    disabled={clearing}
                  >
                    <Trash2 size={14} className="mr-1.5" />
                    Hapus API key draft
                  </Button>
                )}
                <p className="text-xs text-muted mt-2">
                  Menghapus API key draft tidak menghapus API key konfigurasi aktif.
                  API key tidak disimpan di localStorage/sessionStorage/URL.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu size={18} className="text-primary" /> C. Model
              </CardTitle>
              <CardDescription>
                Model utama wajib diisi. Model fallback dipakai hanya bila model utama
                gagal dengan status yang memang dapat dicoba ulang.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <div className="ai-config-form">
                <datalist id="ai-model-options">
                  {models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>

                <div className="ai-config-field-grid">
                  <Input
                    label="Model utama"
                    value={form.model}
                    list="ai-model-options"
                    placeholder={
                      form.provider === "GEMINI"
                        ? "mis. gemini-2.0-flash"
                        : form.provider === "OPENROUTER"
                          ? "mis. openai/gpt-4o-mini"
                          : "mis. meta/llama-3.1-8b-instruct"
                    }
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, model: event.target.value }))
                    }
                  />

                  <Input
                    label="Model fallback (opsional, pisahkan dengan koma)"
                    value={form.fallbackModels}
                    placeholder="mis. model-cadangan-1, model-cadangan-2"
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, fallbackModels: event.target.value }))
                    }
                  />
                </div>

                {form.provider === "NVIDIA" && (
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-border mb-4 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={form.disableThinking}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          disableThinking: event.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm">
                      <span className="font-medium text-main">Nonaktifkan mode thinking</span>
                      <span className="block text-xs text-muted mt-0.5">
                        Hanya dikirim ke NVIDIA NIM. Mempercepat respons model reasoning
                        dan mencegah jawaban kosong karena kuota token habis.
                      </span>
                    </span>
                  </label>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="secondary" onClick={loadModels} disabled={loadingModels}>
                    <List size={15} className="mr-1.5" />
                    {loadingModels ? "Memuat model..." : "Muat Daftar Model"}
                  </Button>
                  <span className="text-xs text-muted">
                    Jika daftar gagal/tidak tersedia, isi model secara manual.
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlugZap size={18} className="text-primary" /> E. Tindakan
              </CardTitle>
              <CardDescription>
                Simpan draft terlebih dahulu, uji koneksi, lalu aktifkan. Aktivasi
                melakukan uji ulang di server sebelum mengganti konfigurasi aktif.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <div className="ai-config-actions">
                <Button onClick={saveDraft} disabled={saving || clearing || activating}>
                  <Save size={15} className="mr-1.5" />
                  {saving ? "Menyimpan..." : "Simpan Konfigurasi"}
                </Button>
                <Button variant="secondary" onClick={runTest} disabled={testing || activating}>
                  <PlugZap size={15} className="mr-1.5" />
                  {testing ? "Menguji..." : "Uji Koneksi"}
                </Button>
                <Button onClick={() => setConfirm("activate")} disabled={activating || saving}>
                  <BadgeCheck size={15} className="mr-1.5" />
                  {activating ? "Mengaktifkan..." : "Aktifkan Konfigurasi"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirm("discard")}
                  disabled={clearing || !draftPending}
                >
                  <RefreshCw size={15} className="mr-1.5" />
                  Batalkan Perubahan
                </Button>
                {active && (
                  <Button
                    variant="danger"
                    onClick={() => setConfirm("deactivate")}
                    disabled={deactivating}
                  >
                    <Power size={15} className="mr-1.5" />
                    {deactivating ? "Menonaktifkan..." : "Nonaktifkan Konfigurasi"}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted mt-4">
                Tombol &quot;Aktifkan&quot; akan menyimpan perubahan yang belum tersimpan
                sebagai draft, lalu server menguji koneksi live. Bila uji gagal,
                konfigurasi aktif sebelumnya tetap dipakai.
              </p>
              <p className="text-xs text-muted mt-2">
                &quot;Uji Koneksi&quot; mengirim satu request generasi minimal ke provider
                dan model yang dipilih. Pengujian tidak menyimpan draft, tidak
                mengaktifkan provider, dan tidak pernah memakai API key provider lain.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="ai-config-column">
          {state.diagnostics && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info size={18} className="text-primary" /> Diagnostik Konfigurasi
                </CardTitle>
                <CardDescription>
                  Status ini dibaca langsung dari database dan konfigurasi server, bukan
                  dari cache browser.
                </CardDescription>
              </CardHeader>
              <CardBody>
                <dl className="ai-config-kv">
                  <div className="ai-config-kv__row">
                    <dt>Sumber runtime</dt>
                    <dd>{sourceLabel(state.diagnostics.runtimeSource)}</dd>
                  </div>
                  <div className="ai-config-kv__row">
                    <dt>Draft</dt>
                    <dd>
                      <Badge variant={state.diagnostics.draft.present ? "info" : "default"}>
                        {state.diagnostics.draft.present ? "Tersedia" : "Belum ada"}
                      </Badge>
                    </dd>
                  </div>
                  <div className="ai-config-kv__row">
                    <dt>API key draft</dt>
                    <dd>
                      {state.diagnostics.draft.secretPresent
                        ? state.diagnostics.draft.secretValid
                          ? "Tersimpan & dapat didekripsi"
                          : "Tersimpan tetapi tidak dapat didekripsi"
                        : "Belum tersimpan"}
                    </dd>
                  </div>
                  <div className="ai-config-kv__row">
                    <dt>Status uji draft</dt>
                    <dd>
                      {state.diagnostics.draft.testedSuccessfully
                        ? "Berhasil diuji"
                        : state.diagnostics.draft.changedSinceTest
                          ? "Draft berubah setelah uji terakhir"
                          : state.diagnostics.lastTest && !state.diagnostics.lastTest.ok
                            ? `Uji terakhir gagal (${categoryLabel(
                                state.diagnostics.lastTest.category
                              )})`
                            : "Belum diuji"}
                    </dd>
                  </div>
                  <div className="ai-config-kv__row">
                    <dt>Konfigurasi aktif</dt>
                    <dd>
                      <Badge
                        variant={
                          state.diagnostics.active.secretValid
                            ? "success"
                            : state.diagnostics.active.present
                              ? "danger"
                              : "default"
                        }
                      >
                        {state.diagnostics.active.secretValid
                          ? "Aktif"
                          : state.diagnostics.active.present
                            ? "Ada, tetapi secret bermasalah"
                            : "Belum aktif"}
                      </Badge>
                    </dd>
                  </div>
                  <div className="ai-config-kv__row">
                    <dt>API key aktif</dt>
                    <dd>
                      {state.diagnostics.active.secretPresent
                        ? state.diagnostics.active.secretValid
                          ? "Tersimpan & dapat didekripsi"
                          : "Tersimpan tetapi tidak dapat didekripsi"
                        : "Belum tersimpan"}
                    </dd>
                  </div>
                  <div className="ai-config-kv__row">
                    <dt>Kunci enkripsi</dt>
                    <dd className="text-wrap-anywhere">
                      {state.diagnostics.encryption.source ?? "Tidak tersedia"}
                    </dd>
                  </div>
                </dl>
                {state.diagnostics.encryption.fallbackInUse && (
                  <div
                    className="flex items-start gap-2 p-3 rounded-lg text-xs mt-4"
                    style={{
                      backgroundColor: "var(--color-warning-bg)",
                      color: "var(--color-warning-text)",
                    }}
                  >
                    <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      Enkripsi memakai fallback NEXTAUTH_SECRET. Jika nilai itu dirotasi,
                      API key yang sudah tersimpan tidak dapat didekripsi. Tetapkan{" "}
                      <code>AI_CONFIG_ENCRYPTION_KEY</code> yang stabil sebelum menyimpan
                      key produksi.
                    </span>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-primary" /> D. Status
              </CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="ai-config-kv">
                <div className="ai-config-kv__row">
                  <dt>Sumber konfigurasi runtime</dt>
                  <dd>{sourceLabel(state.source)}</dd>
                </div>
                <div className="ai-config-kv__row">
                  <dt>Provider efektif</dt>
                  <dd>{state.effective.providerLabel ?? "—"}</dd>
                </div>
                <div className="ai-config-kv__row">
                  <dt>Model utama efektif</dt>
                  <dd className="text-wrap-anywhere">{state.effective.model ?? "—"}</dd>
                </div>
                <div className="ai-config-kv__row">
                  <dt>Model fallback efektif</dt>
                  <dd className="text-wrap-anywhere">
                    {state.effective.fallbackModels.length > 0
                      ? state.effective.fallbackModels.join(", ")
                      : "Tidak ada"}
                  </dd>
                </div>
                <div className="ai-config-kv__row">
                  <dt>Konfigurasi tersimpan (draft)</dt>
                  <dd>
                    <Badge variant={draftPending ? "info" : "default"}>
                      {draftPending ? "Ada draft" : "Belum ada draft"}
                    </Badge>
                  </dd>
                </div>
                <div className="ai-config-kv__row">
                  <dt>Konfigurasi aktif</dt>
                  <dd>
                    <Badge variant={active?.apiKeyValid ? "success" : active ? "danger" : "default"}>
                      {active
                        ? active.apiKeyValid
                          ? "Aktif"
                          : "Aktif — API key bermasalah"
                        : "Belum aktif"}
                    </Badge>
                  </dd>
                </div>
                <div className="ai-config-kv__row">
                  <dt>Terakhir diperbarui</dt>
                  <dd>
                    <Clock size={13} className="inline mr-1" />
                    {formatDate(active?.updatedAt ?? state.draft?.updatedAt)}
                  </dd>
                </div>
                <div className="ai-config-kv__row">
                  <dt>Diaktifkan pada</dt>
                  <dd>{formatDate(active?.activatedAt ?? active?.updatedAt)}</dd>
                </div>
                <div className="ai-config-kv__row">
                  <dt>Diubah oleh</dt>
                  <dd>{active?.updatedBy ?? state.draft?.updatedBy ?? "—"}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlugZap size={18} className="text-primary" /> Hasil Uji Terakhir
              </CardTitle>
            </CardHeader>
            <CardBody>
              {visibleTest ? (
                <div className="flex flex-col gap-2 text-sm">
                  <Badge variant={categoryVariant(visibleTest.category)}>
                    {visibleTest.ok ? "Berhasil" : categoryLabel(visibleTest.category)}
                  </Badge>
                  <p className="text-main break-words">{visibleTest.message}</p>
                  <p className="text-xs text-muted text-wrap-anywhere">
                    {visibleTest.provider ?? "—"} / {visibleTest.model ?? "—"}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDate(visibleTest.at)}
                    {visibleTest.latencyMs !== null
                      ? ` • ${visibleTest.latencyMs} ms`
                      : ""}
                  </p>
                  {visibleTest.testedBy && (
                    <p className="text-xs text-muted">Diuji oleh: {visibleTest.testedBy}</p>
                  )}
                  <p className="text-xs text-muted">
                    Hasil ini bukan jaminan seluruh model fallback atau tool calling
                    berfungsi.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted">Belum ada hasil uji koneksi.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound size={18} className="text-primary" /> Keamanan
              </CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="text-xs text-muted flex flex-col gap-2 list-disc pl-4 break-words">
                <li>API key tidak pernah dikirim kembali secara utuh ke browser.</li>
                <li>
                  Enkripsi: AES-256-GCM, kunci dari{" "}
                  {state.encryption.source === "AI_CONFIG_ENCRYPTION_KEY"
                    ? "AI_CONFIG_ENCRYPTION_KEY"
                    : state.encryption.source === "NEXTAUTH_SECRET"
                      ? "NEXTAUTH_SECRET (fallback)"
                      : "konfigurasi server"}
                  .
                </li>
                <li>Endpoint hanya dapat diakses ADMIN; diperiksa di server.</li>
                <li>Tidak ada API key di URL, localStorage, atau audit log.</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={confirm === "activate"}
        onClose={() => setConfirm(null)}
        onConfirm={activate}
        title="Aktifkan konfigurasi AI?"
        message={
          "Server akan menguji koneksi live ke provider dan model yang dipilih. Jika berhasil, konfigurasi langsung dipakai request AI berikutnya tanpa restart server. Jika gagal, konfigurasi aktif lama tetap dipakai."
        }
        confirmText="Uji & Aktifkan"
      />

      <ConfirmationDialog
        isOpen={confirm === "deactivate"}
        onClose={() => setConfirm(null)}
        onConfirm={deactivate}
        title="Nonaktifkan konfigurasi AI aktif?"
        message={
          "Konfigurasi aktif akan dihapus dari database. Runtime kembali ke konfigurasi .env bila tersedia. Draft dan API key draft tetap disimpan."
        }
        confirmText="Nonaktifkan"
        isDestructive
      />

      <ConfirmationDialog
        isOpen={confirm === "discard"}
        onClose={() => setConfirm(null)}
        onConfirm={discard}
        title="Buang draft konfigurasi?"
        message={
          "Draft dan API key draft akan dihapus. Konfigurasi aktif serta API key aktif tidak berubah."
        }
        confirmText="Buang Draft"
        isDestructive
      />

      <ConfirmationDialog
        isOpen={confirm === "clearKey"}
        onClose={() => setConfirm(null)}
        onConfirm={clearDraftKey}
        title="Hapus API key draft?"
        message={
          "API key pada draft akan dihapus. Konfigurasi aktif dan API key aktif tetap tersimpan, tetapi aktivasi draft memerlukan API key baru."
        }
        confirmText="Hapus API Key Draft"
        isDestructive
      />
    </div>
  );
}
