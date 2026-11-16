import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ 
  title = "Terjadi Kesalahan", 
  message = "Maaf, sistem tidak dapat memuat data saat ini. Silakan coba lagi.",
  onRetry 
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-10 text-center bg-danger-bg rounded-xl border border-danger-bg">
      <AlertCircle size={48} className="text-danger mb-4" />
      <h3 className="text-lg font-semibold text-danger mb-2">{title}</h3>
      <p className="text-sm text-muted max-w-md mb-6">{message}</p>
      {onRetry && (
        <Button variant="danger" onClick={onRetry}>
          Coba Lagi
        </Button>
      )}
    </div>
  );
}
