"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markGiftPosted } from "./actions";

/**
 * Inline mark-posted control for pipeline cards. The win-metric
 * interaction — must be cheap to invoke. Idle state is a single button;
 * click expands a one-row URL paste input + commit.
 */
export function MarkPosted({ giftId }: { giftId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="font-mono text-[9px] uppercase tracking-[0.18em] px-2 py-0.5 transition w-full"
        style={{
          border: "1px solid var(--color-dsc-red)",
          background: "transparent",
          color: "var(--color-dsc-red)",
          borderRadius: 6,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--color-dsc-red)";
          e.currentTarget.style.color = "var(--color-bone)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--color-dsc-red)";
        }}
      >
        mark posted
      </button>
    );
  }

  return (
    <div
      className="space-y-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            setOpen(false);
            setUrl("");
            setError(null);
          }
        }}
        placeholder="post url"
        className="w-full px-1 py-1 text-[11px] font-mono focus:outline-none bg-transparent placeholder:text-[var(--color-muted)]"
        style={{
          borderBottom: "1px solid var(--color-dsc-red)",
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="font-mono text-[9px] uppercase tracking-[0.18em] px-2 py-0.5 transition"
          style={{
            border: "1px solid var(--color-dsc-red)",
            background: "var(--color-dsc-red)",
            color: "var(--color-bone)",
            borderRadius: 6,
          }}
        >
          {pending ? "committing…" : "commit"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setUrl("");
            setError(null);
          }}
          className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-dsc-red)]"
        >
          cancel
        </button>
      </div>
      {error ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-dsc-red)]">
          // {error}
        </p>
      ) : null}
    </div>
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await markGiftPosted(giftId, url);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setUrl("");
      router.refresh();
    });
  }
}
