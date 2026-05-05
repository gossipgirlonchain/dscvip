"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { springs } from "@/lib/constants";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-dark/20 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", ...springs.default }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-surface rounded-[var(--radius-modal)] shadow-[var(--shadow-modal)] border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
              {title && (
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                  <h2 className="text-base font-semibold text-dark">{title}</h2>
                  <button
                    onClick={onClose}
                    className="p-1.5 rounded-[var(--radius-nav)] hover:bg-offwhite transition-colors text-muted hover:text-dark"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="p-6">{children}</div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
