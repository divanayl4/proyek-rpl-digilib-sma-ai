"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Lock } from "lucide-react";
import { formatRemaining, getRemainingParts } from "@/lib/config/ebook";

interface EbookCountdownProps {
  expiresAt: string;
  onExpire?: () => void;
  className?: string;
  showIcon?: boolean;
}

/**
 * Live countdown to expiresAt.
 *
 * The client clock is display-only: it never grants access. When it reaches
 * zero the reader tears the document down and asks the server again, which is
 * what actually enforces the lock.
 */
export default function EbookCountdown({
  expiresAt,
  onExpire,
  className = "",
  showIcon = true,
}: EbookCountdownProps) {
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);

  const compute = () => Math.max(0, target - Date.now());

  const [remaining, setRemaining] = useState<number>(compute);

  useEffect(() => {
    setRemaining(compute());

    const interval = setInterval(() => {
      const next = compute();
      setRemaining(next);
      if (next <= 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const expired = remaining <= 0;
  const parts = getRemainingParts(remaining);
  const urgent = !expired && parts.days === 0 && parts.hours < 6;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
        expired ? "text-danger" : urgent ? "text-warning" : "text-success"
      } ${className}`}
    >
      {showIcon && (expired ? <Lock size={13} /> : <Clock size={13} />)}
      <span className="tabular-nums">{formatRemaining(remaining)}</span>
    </span>
  );
}