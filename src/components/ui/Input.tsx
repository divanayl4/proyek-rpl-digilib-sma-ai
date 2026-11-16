import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Additional class for the wrapper div. Use className for the input itself. */
  wrapperClassName?: string;
}

export function Input({ label, className = "", wrapperClassName = "", id, ...props }: InputProps) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  
  return (
    <div className={`${label ? "mb-4" : ""} ${wrapperClassName}`}>
      {label && <label htmlFor={inputId} className="form-label">{label}</label>}
      <input 
        id={inputId}
        className={`form-control ${className}`}
        {...props}
      />
    </div>
  );
}
