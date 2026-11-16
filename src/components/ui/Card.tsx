import React from 'react';

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`card-header ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={`card-title ${className}`}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`card-description ${className}`}>
      {children}
    </p>
  );
}

export function CardBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`card-body ${className}`}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`card-footer ${className}`}>
      {children}
    </div>
  );
}
