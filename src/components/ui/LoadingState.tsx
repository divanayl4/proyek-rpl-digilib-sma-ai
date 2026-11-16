import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Memuat data..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center">
      <Loader2 size={32} className="animate-spin text-primary mb-4" />
      <p className="text-sm text-muted font-medium">{message}</p>
    </div>
  );
}
