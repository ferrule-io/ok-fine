import { clsx } from "clsx";
import { useId } from "react";

export interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 24, className }: LogoProps) {
  const gradId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={clsx("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="7" fill={`url(#${gradId})`} />
      <path
        d="M7 12.5l3.2 3.2L17 8.8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface WordmarkProps {
  className?: string;
  size?: number;
}

export function Wordmark({ className, size = 24 }: WordmarkProps) {
  return (
    <div className={clsx("inline-flex items-center gap-2 font-semibold tracking-tight text-fg", className)}>
      <Logo size={size} />
      <span>ok-fine</span>
    </div>
  );
}
