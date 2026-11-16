import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

export function Button({ variant = 'primary', size = 'md', className = "", children, ...props }: ButtonProps) {
  let variantClass = "btn-primary";
  switch (variant) {
    case 'secondary': variantClass = "btn-secondary"; break;
    case 'danger': variantClass = "btn-danger"; break;
    case 'ghost': variantClass = "btn-ghost"; break;
  }

  let sizeClass = "";
  if (size === 'sm') sizeClass = "btn-sm";
  if (size === 'lg') sizeClass = "btn-lg";

  return (
    <button 
      className={`btn ${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
