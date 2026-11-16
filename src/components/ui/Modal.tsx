"use client";

import React, { useEffect, useId } from "react";
import { X } from "lucide-react";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "full";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const titleId = useId();

  // Close on Escape key and prevent body scroll when open
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleEsc);
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        window.removeEventListener("keydown", handleEsc);
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClass = `modal-${size}`;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
      style={{ zIndex: 100 }}
    >
      <div
        className={`modal-content ${sizeClass}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <h3 id={titleId} className="text-lg font-semibold text-main truncate pr-2">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="row-action hover:bg-base hover:text-main transition-colors flex-shrink-0"
            title="Tutup (Esc)"
            aria-label="Tutup dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div className="modal-body">
          {children}
        </div>

        {/* Modal Footer - Always pinned at bottom */}
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
