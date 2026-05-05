"use client";

import { motion } from "framer-motion";
import { springs } from "@/lib/constants";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  gradient?: boolean;
  onClick?: () => void;
}

export function Card({ children, className = "", hover = true, gradient = false, onClick }: CardProps) {
  return (
    <motion.div
      whileHover={hover ? { y: -2, transition: { type: "spring", ...springs.default } } : undefined}
      transition={{ type: "spring", ...springs.default }}
      onClick={onClick}
      className={`
        bg-surface rounded-[var(--radius-card)] relative
        ${gradient ? "gradient-border" : "border border-border"}
        ${hover ? "hover:shadow-[var(--shadow-card-hover)] cursor-pointer" : ""}
        ${className}
      `}
    >
      <div className="relative z-[1]">{children}</div>
    </motion.div>
  );
}
