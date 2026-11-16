import React from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  /** Pass options as prop OR use children (<option> elements) */
  options?: { label: string; value: string | number }[];
  /** Additional class to apply to the wrapper div. Use selectClassName for the select element. */
  wrapperClassName?: string;
}

export function Select({ label, options, className = "", wrapperClassName = "", id, children, ...props }: SelectProps) {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  
  return (
    <div className={`${label ? "mb-4" : ""} ${wrapperClassName}`}>
      {label && <label htmlFor={selectId} className="form-label">{label}</label>}
      <select 
        id={selectId}
        className={`form-control ${className}`}
        {...props}
      >
        {children ?? options?.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
