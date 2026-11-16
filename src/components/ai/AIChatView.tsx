"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Send,
  Bot,
  User,
  Sparkles,
  BookOpen,
  AlertCircle,
  RotateCcw,
  Copy,
  Check,
  Plus,
  Clock,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import MarkdownMessage from "@/components/ai/MarkdownMessage";

interface BookReference {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  available?: number | null;
}

type MessageRole = "user" | "assistant" | "error";

interface Message {
  role: MessageRole;
  content: string;
  references?: BookReference[];
  /** Identitas provider/model yang benar-benar menjawab (bila ada). */
  ai?: AIResponseMeta;
  /** Waktu pesan dibuat (tidak dikirim ke API). */
  at: number;
}

interface AIResponseMeta {
  provider: string;
  model: string;
  /** True bila jawaban berasal dari provider/model cadangan. */
  fallbackUsed?: boolean;
  primaryProvider?: string;
  primaryModel?: string;
}

/** Batas panjang pesan pengguna — sama dengan validasi backend. */
const MAX_INPUT_LENGTH = 2000;

const DEFAULT_PROMPTS = [
  "Buku apa yang sedang saya pinjam?",
  "Berapa denda saya?",
  "Ada berapa buku di perpustakaan?",
  "Rekomendasikan buku Fisika di perpustakaan.",
];

const LIBRARIAN_PROMPTS = [
  "Tampilkan transaksi peminjaman terbaru.",
  "Buku apa saja yang sedang terlambat?",
  "Berapa total denda yang belum dibayar?",
  "Ada berapa buku di perpustakaan?",
];

const ADMIN_PROMPTS = [
  "Berapa jumlah pengguna per role?",
  "Tampilkan transaksi peminjaman terbaru.",
  "Berapa total denda yang belum dibayar?",
  "Ada berapa buku di perpustakaan?",
];

function promptsForRole(role: string | null | undefined): string[] {
  if (role === "LIBRARIAN") return LIBRARIAN_PROMPTS;
  if (role === "ADMIN") return ADMIN_PROMPTS;
  return DEFAULT_PROMPTS;
}

function formatTime(at: number): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return "";
  }
}

interface AIChatViewProps {
  variant?: "page" | "panel";
  onClose?: () => void;
}

const WELCOME_MESSAGE =
  "Halo! Saya DigiLib Assistant. Tanya saya soal katalog, jumlah buku, peminjaman, riwayat, atau denda kamu. Ada yang bisa saya bantu?";

export default function AIChatView({ variant = "page", onClose }: AIChatViewProps) {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: WELCOME_MESSAGE, at: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  /** True setelah tunggu cukup lama: server kemungkinan sedang retry 429. */
  const [slowResponse, setSlowResponse] = useState(false);
  const [failedQuery, setFailedQuery] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Penjaga berbasis ref agar dua pesan cepat tidak memicu dua permintaan. */
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const suggestedPrompts = promptsForRole(session?.user?.role);

  // Auto-scroll di dalam conversation container saja, tidak mengganggu halaman
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, isLoading]);

  // Indikator "mencoba kembali" saat respons lebih lama dari biasanya.
  // Server melakukan retry 429 secara otomatis; UI tidak menampilkan error
  // merah berulang, cukup indikator halus ini.
  useEffect(() => {
    if (!isLoading) {
      setSlowResponse(false);
      return;
    }
    const timer = setTimeout(() => setSlowResponse(true), 7_000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Sesuaikan tinggi textarea dengan isi (maksimal 120px).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // Sapaan pertama dipersonalisasi memakai identitas akun yang sedang login.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/chat")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data.greeting !== "string") return;
        setMessages((prev) =>
          prev.length === 1 && prev[0].role === "assistant"
            ? [{ role: "assistant", content: data.greeting, at: Date.now() }]
            : prev
        );
      })
      .catch(() => {
        /* biarkan sapaan default bila gagal */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runRequest = useCallback(async (history: Message[]) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    setFailedQuery(null);

    const controller = new AbortController();
    abortRef.current = controller;
    // Server dapat menunggu reset rate-limit (dibatasi ±50 detik) sebelum
    // menjawab. Batas klien dibuat lebih longgar agar tidak memutus retry.
    const timeout = setTimeout(() => controller.abort(), 125_000);

    try {
      const apiMessages = history
        .filter((m) => m.role !== "error")
        .map((m) => ({
          role: m.role,
          content: m.content,
          ...(Array.isArray(m.references) && m.references.length > 0
            ? {
                references: m.references.map((r) => ({
                  id: r.id,
                  title: r.title,
                  author: r.author,
                  ...(typeof r.available === "number" || r.available === null
                    ? { available: r.available }
                    : {}),
                })),
              }
            : {}),
        }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.error || "Maaf, asisten AI sedang mengalami gangguan. Silakan coba kembali."
        );
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: typeof data.message === "string" ? data.message : "",
          references: Array.isArray(data.references) ? data.references : undefined,
          ai:
            data.ai && typeof data.ai.provider === "string" && typeof data.ai.model === "string"
              ? (data.ai as AIResponseMeta)
              : undefined,
          at: Date.now(),
        },
      ]);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const text = aborted
        ? "Waktu tunggu habis. Koneksi ke asisten AI terlalu lama — silakan coba lagi."
        : err instanceof Error && err.message
          ? err.message
          : "Maaf, asisten AI sedang mengalami gangguan. Silakan coba kembali beberapa saat lagi.";
      setMessages((prev) => [...prev, { role: "error", content: text, at: Date.now() }]);
      setFailedQuery(history[history.length - 1]?.content ?? null);
    } finally {
      clearTimeout(timeout);
      if (abortRef.current === controller) abortRef.current = null;
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  const sendMessage = (text: string) => {
    const trimmed = text.trim().slice(0, MAX_INPUT_LENGTH);
    if (!trimmed || inFlightRef.current) return;

    const next: Message[] = [...messages, { role: "user", content: trimmed, at: Date.now() }];
    setMessages(next);
    setInput("");
    void runRequest(next);
  };

  const retryLast = () => {
    if (!failedQuery || inFlightRef.current) return;
    // Buang pesan galat di ujung; riwayat yang tersisa berakhir pada pesan pengguna.
    const trimmed = [...messages];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "error") {
      trimmed.pop();
    }
    if (trimmed.length === 0 || trimmed[trimmed.length - 1].role !== "user") return;
    setMessages(trimmed);
    void runRequest(trimmed);
  };

  const startNewChat = () => {
    if (inFlightRef.current) abortRef.current?.abort();
    setFailedQuery(null);
    setMessages([{ role: "assistant", content: WELCOME_MESSAGE, at: Date.now() }]);
  };

  const copyMessage = async (index: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((v) => (v === index ? null : v)), 1500);
    } catch {
      /* clipboard tidak tersedia — abaikan */
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isFirstExchange = messages.length <= 1;
  const inputTooLong = input.length > MAX_INPUT_LENGTH;

  const containerClass =
    variant === "panel"
      ? "ai-chat-view ai-chat-view--panel"
      : "ai-chat-view ai-chat-view--page";

  return (
    <div className={containerClass}>
      {/* Chat Header */}
      <div 
        className="px-4 py-3 border-b border-border bg-base flex items-center justify-between gap-3 flex-shrink-0"
        style={{ flexShrink: 0, position: "relative", zIndex: 10 }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <span
              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-success border-2 border-surface"
              title="Asisten online"
            />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-main leading-tight truncate">DigiLib Assistant</h2>
            <p className="text-[11px] text-muted truncate">
              {isLoading
                ? slowResponse
                  ? "Menyesuaikan kapasitas…"
                  : "Sedang mengetik…"
                : "Online • Asisten Perpustakaan"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={startNewChat}
            className="row-action hover:bg-base hover:text-main transition-colors"
            title="Mulai percakapan baru"
            aria-label="Mulai percakapan baru"
          >
            <Plus size={18} />
          </button>
          {variant === "panel" && onClose && (
            <button
              onClick={onClose}
              className="row-action hover:bg-danger-bg hover:text-danger transition-colors"
              title="Tutup asisten"
              aria-label="Tutup asisten"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4" 
        role="log" 
        aria-live="polite"
        style={{ 
          flex: "1 1 0%", 
          minHeight: 0, 
          maxHeight: "100%", 
          overflowY: "auto", 
          overflowX: "hidden", 
          position: "relative", 
          zIndex: 1 
        }}
      >
        {messages.map((msg, index) => {
          const isUser = msg.role === "user";
          const isError = msg.role === "error";
          return (
            <div
              key={index}
              className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"} items-start`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {isUser ? (
                  <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shadow-xs">
                    <User size={16} />
                  </div>
                ) : isError ? (
                  <div className="w-8 h-8 rounded-full bg-danger text-white flex items-center justify-center shadow-xs">
                    <AlertCircle size={16} />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-info text-white flex items-center justify-center shadow-xs">
                    <Bot size={16} />
                  </div>
                )}
              </div>

              <div className={`flex flex-col gap-1.5 min-w-0 max-w-[85%] md:max-w-[78%] ${isUser ? "items-end" : "items-start"}`}>
                <div
                  className={`chat-bubble-text px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    isUser
                      ? "bg-primary text-primary-foreground rounded-tr-md shadow-xs"
                      : isError
                      ? "bg-danger-bg text-danger border border-danger/20 rounded-tl-md"
                      : "bg-base border border-border text-main rounded-tl-md shadow-xs"
                  }`}
                >
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  ) : (
                    <MarkdownMessage content={msg.content} />
                  )}
                </div>

                <div className="flex items-center gap-2 px-1">
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                    <Clock size={10} />
                    {formatTime(msg.at)}
                  </span>
                  {!isUser && !isError && msg.content && (
                    <button
                      onClick={() => copyMessage(index, msg.content)}
                      className="chat-meta-action text-[10px] text-muted hover:text-primary"
                      title="Salin jawaban"
                      aria-label="Salin jawaban"
                    >
                      {copiedIndex === index ? <Check size={10} /> : <Copy size={10} />}
                      {copiedIndex === index ? "Disalin" : "Salin"}
                    </button>
                  )}
                </div>

                {/* Transparansi fallback: jangan diam-diam berpindah provider/model. */}
                {!isUser && !isError && msg.ai?.fallbackUsed && (
                  <p className="px-1 text-[10px] leading-relaxed text-muted">
                    Catatan: penyedia utama {msg.ai.primaryProvider ?? "-"}
                    {msg.ai.primaryModel ? ` (${msg.ai.primaryModel})` : ""} tidak dapat
                    dihubungi. Jawaban ini dihasilkan oleh {msg.ai.provider} ({msg.ai.model}).
                  </p>
                )}

                {isError && failedQuery && (
                  <Button variant="secondary" size="sm" onClick={retryLast} className="self-start">
                    <RotateCcw size={14} /> Coba lagi
                  </Button>
                )}

                {/* Book References (Rich UI) */}
                {msg.references && msg.references.length > 0 && (
                  <div className={`grid ${variant === "panel" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"} gap-2.5 mt-1 w-full`}>
                    {msg.references.map((book) => (
                      <Link
                        key={book.id}
                        href={`/catalog/${book.id}`}
                        className="flex items-start gap-3 p-3 rounded-xl border border-border bg-base hover:border-primary/50 hover:shadow-xs transition-all group"
                      >
                        <div className="w-12 h-16 bg-surface rounded-md flex-shrink-0 overflow-hidden relative border border-border/50">
                          {book.coverUrl ? (
                            <Image src={book.coverUrl} alt={book.title} fill className="object-cover" />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-muted">
                              <BookOpen size={16} />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-main text-sm line-clamp-1 group-hover:text-primary transition-colors">
                            {book.title}
                          </p>
                          <p className="text-xs text-muted line-clamp-1">{book.author}</p>
                          {typeof book.available === "number" && (
                            <p
                              className={`text-[11px] mt-1 font-medium ${
                                book.available > 0 ? "text-success" : "text-danger"
                              }`}
                            >
                              {book.available > 0
                                ? `Tersedia ${book.available} eksemplar`
                                : "Stok habis"}
                            </p>
                          )}
                          <span className="text-[10px] text-primary font-medium mt-1 inline-block">
                            Lihat Detail →
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isFirstExchange && (
          <div className="pt-1">
            <p className="text-[11px] font-medium text-muted text-center mb-2">Saran pertanyaan:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  disabled={isLoading}
                  className="prompt-chip text-xs px-3 rounded-full bg-surface border border-border text-muted hover:text-primary hover:border-primary-300 hover:bg-primary-50 hover:shadow-xs transition-all disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex gap-2.5 items-start">
            <div className="flex-shrink-0 mt-0.5">
              <div className="w-8 h-8 rounded-full bg-info text-white flex items-center justify-center shadow-xs">
                <Bot size={16} />
              </div>
            </div>
            <div className="px-4 py-3.5 rounded-2xl rounded-tl-md bg-base border border-border shadow-xs">
              <div className="flex gap-1.5 items-center" aria-label="Asisten sedang mengetik">
                <div className="w-2 h-2 rounded-full bg-muted animate-bounce" style={{ animationDelay: "0ms" }}></div>
                <div className="w-2 h-2 rounded-full bg-muted animate-bounce" style={{ animationDelay: "150ms" }}></div>
                <div className="w-2 h-2 rounded-full bg-muted animate-bounce" style={{ animationDelay: "300ms" }}></div>
              </div>
              {slowResponse && (
                <p className="text-[11px] text-muted mt-1.5">
                  AI sedang mencoba kembali, mohon tunggu…
                </p>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div 
        className="p-3 md:p-4 border-t border-border bg-base flex-shrink-0"
        style={{ flexShrink: 0, position: "relative", zIndex: 10 }}
      >
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tanya soal katalog, peminjaman, denda… (Enter untuk kirim)"
              aria-label="Pesan untuk DigiLib Assistant"
              rows={1}
              maxLength={MAX_INPUT_LENGTH + 100}
              className={`w-full bg-surface border text-main rounded-xl px-4 py-3 pr-14 focus:outline-none focus:ring-2 resize-none min-h-[50px] max-h-[120px] text-sm placeholder:text-muted ${
                inputTooLong
                  ? "border-danger focus:ring-danger/40"
                  : "border-border focus:ring-primary/50"
              }`}
            />
            <span
              className={`absolute bottom-2 right-3 text-[10px] tabular-nums ${
                inputTooLong ? "text-danger font-medium" : "text-muted"
              }`}
            >
              {input.length}/{MAX_INPUT_LENGTH}
            </span>
          </div>
          <Button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading || inputTooLong}
            aria-label="Kirim pesan"
            className="h-[50px] w-[52px] px-0 rounded-xl shrink-0 justify-center"
          >
            <Send size={18} />
          </Button>
        </div>
        {inputTooLong && (
          <p className="text-[11px] text-danger mt-1.5 px-1">
            Pesan terlalu panjang. Maksimal {MAX_INPUT_LENGTH} karakter.
          </p>
        )}
        <p className="text-center text-[10px] text-muted mt-2">
          AI mungkin membuat kesalahan. Cek ketersediaan buku secara langsung.
        </p>
      </div>
    </div>
  );
}
