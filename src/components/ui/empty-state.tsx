"use client";

import { motion } from "framer-motion";
import { Button } from "./button";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="w-12 h-12 rounded-[var(--radius-card)] bg-offwhite border border-border flex items-center justify-center text-muted mb-5"
      >
        {icon}
      </motion.div>
      <h3 className="text-sm font-semibold text-dark mb-1.5">{title}</h3>
      <p className="text-muted text-[13px] text-center max-w-xs mb-6">
        {description}
      </p>
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
