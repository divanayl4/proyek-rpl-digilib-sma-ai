"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, Bot } from "lucide-react";
import { useSession } from "next-auth/react";
import AIChatView from "@/components/ai/AIChatView";
import { canUseAIAssistant } from "@/lib/ai/access";

/**
 * Floating AI Assistant widget on bottom-right corner.
 * Rendered via portal directly into document.body with `position: fixed`.
 * Only available for permitted roles (STUDENT, TEACHER, LIBRARIAN, ADMIN).
 */
export default function AssistantWidget() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  // Portal requires DOM mounted; role checked from valid session
  if (!mounted || !canUseAIAssistant(session?.user?.role)) {
    return null;
  }

  return createPortal(
    <>
      {isOpen && (
        <div
          ref={panelRef}
          className="fixed bg-surface rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col"
          style={{
            position: "fixed",
            zIndex: 90,
            right: "clamp(12px, 3vw, 24px)",
            bottom: "clamp(80px, calc(16px + 56px + 12px), 92px)",
            width: "min(390px, calc(100vw - 24px))",
            maxHeight: "calc(100vh - 100px)",
            height: "min(580px, calc(100dvh - 100px), calc(100vh - 100px))",
            backgroundColor: "var(--color-surface, #FFFFFF)",
            boxShadow: "0 16px 40px -4px rgba(15, 23, 42, 0.2), 0 4px 16px -2px rgba(15, 23, 42, 0.08)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            isolation: "isolate",
          }}
          role="dialog"
          aria-label="DigiLib Assistant Chat"
        >
          <AIChatView variant="panel" onClose={() => setIsOpen(false)} />
        </div>
      )}

      {/* Floating Action Trigger Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-105 active:scale-95"
        style={{
          position: "fixed",
          zIndex: 90,
          right: "clamp(12px, 3vw, 24px)",
          bottom: "clamp(16px, 3vw, 24px)",
          width: "56px",
          height: "56px",
          backgroundColor: isOpen ? "var(--color-text-main, #29263A)" : "var(--color-primary-500, #8B7BE8)",
          color: "#FFFFFF",
          boxShadow: isOpen 
            ? "0 4px 14px rgba(0, 0, 0, 0.25)" 
            : "0 8px 24px rgba(139, 123, 232, 0.45)",
        }}
        title={isOpen ? "Tutup asisten AI" : "Buka DigiLib Assistant"}
        aria-label={isOpen ? "Tutup DigiLib Assistant" : "Buka DigiLib Assistant"}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <X size={24} className="transition-transform duration-200" />
        ) : (
          <div className="relative flex items-center justify-center">
            <Sparkles size={24} className="transition-transform duration-200" />
          </div>
        )}
      </button>
    </>,
    document.body
  );
}
