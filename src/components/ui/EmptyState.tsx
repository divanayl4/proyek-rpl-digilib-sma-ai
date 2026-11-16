import React from 'react';
import { FileQuestion, FolderOpen } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-10 text-center bg-surface border border-dashed border-border rounded-xl">
      <div className="w-14 h-14 sm:w-16 sm:h-16 bg-bg-subtle text-muted flex items-center justify-center rounded-full mb-4">
        {icon || <FolderOpen size={32} />}
      </div>
      <h3 className="text-lg font-semibold text-main mb-1">{title}</h3>
      <p className="text-sm text-muted max-w-md mb-6">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
