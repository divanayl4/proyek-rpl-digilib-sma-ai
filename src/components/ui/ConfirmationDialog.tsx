"use client";

import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Konfirmasi",
  cancelText = "Batal",
  isDestructive = false
}: ConfirmationDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{cancelText}</Button>
          <Button 
            variant={isDestructive ? "danger" : "primary"} 
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4">
        {isDestructive && (
          <div className="bg-danger-bg p-3 rounded-full text-danger shrink-0 mt-1">
            <AlertTriangle size={24} />
          </div>
        )}
        <p className="text-muted text-sm min-w-0 break-words">{message}</p>
      </div>
    </Modal>
  );
}
