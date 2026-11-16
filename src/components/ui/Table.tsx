import React from 'react';

export function TableContainer({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`table-container bg-surface rounded-lg border border-border shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Table({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <table className={`table ${className}`}>
      {children}
    </table>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return <thead>{children}</thead>;
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <tr className={className}>{children}</tr>;
}

export function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={className}>{children}</th>;
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={className}>{children}</td>;
}
