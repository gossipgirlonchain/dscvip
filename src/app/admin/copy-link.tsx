"use client";

import { useState } from "react";

export function CopyLink({ url, disabled }: { url: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);

  if (disabled) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      className="text-[12px] px-2.5 py-1 rounded-[var(--radius-pill)] border border-border hover:border-border-hover transition"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
