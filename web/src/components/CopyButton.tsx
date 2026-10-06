import { clsx } from "clsx";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard write failures
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : (label ?? "Copy to clipboard")}
      title={copied ? "Copied" : (label ?? "Copy")}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface/80 px-2 py-1 text-xs font-medium text-muted backdrop-blur-xs transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 outline-accent-500",
        className,
      )}
    >
      {copied ? (
        <Check size={14} className="text-emerald-500 shrink-0" />
      ) : (
        <Copy size={14} className="shrink-0 text-muted" />
      )}
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}
