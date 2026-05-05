"use client";

import { motion } from "framer-motion";
import { springs } from "@/lib/constants";

interface ProgressBarProps {
  value: number;
  max: number;
  className?: string;
}

export function ProgressBar({ value, max, className = "" }: ProgressBarProps) {
  const percent = Math.min((value / max) * 100, 100);

  return (
    <div className={`h-1.5 bg-offwhite rounded-[var(--radius-pill)] overflow-hidden ${className}`}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${percent}%` }}
        transition={{ type: "spring", ...springs.default }}
        className="h-full bg-primary/60 rounded-[var(--radius-pill)]"
      />
    </div>
  );
}
