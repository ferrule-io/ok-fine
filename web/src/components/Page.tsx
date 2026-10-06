import { motion } from "motion/react";
import { type ReactNode, useEffect } from "react";

export interface PageProps {
  title: string;
  className?: string;
  children: ReactNode;
}

export function Page({ title, className, children }: PageProps) {
  useEffect(() => {
    document.title = `${title} · ok-fine`;
  }, [title]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
