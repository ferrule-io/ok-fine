import { clsx } from "clsx";

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={clsx("animate-shimmer rounded-md bg-surface-2", className)} aria-hidden="true" />;
}
