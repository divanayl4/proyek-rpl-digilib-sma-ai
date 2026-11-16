import React from 'react';

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'default' | 'purple' | 'blue' | 'green' | 'yellow';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'default', className = "" }: BadgeProps) {
  let variantClass = "";
  switch (variant) {
    case 'info':
    case 'blue': variantClass = "badge-blue"; break;
    case 'success':
    case 'green': variantClass = "badge-green"; break;
    case 'warning':
    case 'yellow': variantClass = "badge-yellow"; break;
    case 'purple': variantClass = "badge-purple"; break;
    case 'danger': variantClass = "badge-danger"; break;
    default: variantClass = "bg-surface text-main border border-border"; break;
  }
  
  return (
    <span className={`badge ${variantClass} ${className}`}>
      {children}
    </span>
  );
}
