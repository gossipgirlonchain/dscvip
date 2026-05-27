"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { proposePasteDiff, applyPasteDiff } from "../../actions";
import type { Diff, DiffChange } from "@/lib/llm/paste-parser";

type Stage = "idle" | "input" | "parsing" | "review" | "applying";

export function SmartPasteButton({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  // Index → whether the user wants this change applied. Defaults to true
  // for everything except suggest_tag / mention_person (informational only).
  const [approved, setApproved] = useState<Record<number, boolean>>({});

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cmd+Shift+V: open + paste clipboard content. Browser clipboard read
  // requires user gesture, so this works inside the keydown handler.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const isModifier = e.metaKey || e.ctrlKey;
      if (isModifier && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        setOpen(true);
        setStage("input");
        setError(null);
        try {
          const clip = await navigator.clipboard.readText();
          if (clip) setPaste(clip);
        } catch {
          // Permission denied; user can paste manually.
        }
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Autofocus the textarea when the modal opens.
  useEffect(() => {
    if (open && stage === "input") {
      const id = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open, stage]);

  function reset() {
    setStage("idle");
    setPaste("");
    setDiff(null);
    setApproved({});
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit() {
    if (!paste.trim()) return;
    setStage("parsing");
    setError(null);
    const result = await proposePasteDiff(contactId, paste);
    if (!result.ok) {
      setError(result.error);
      setStage("input");
      return;
    }
    const auto: Record<number, boolean> = {};
    result.diff.changes.forEach((c, i) => {
      auto[i] = c.kind !== "suggest_tag" && c.kind !== "mention_person";
    });
    setDiff(result.diff);
    setApproved(auto);
    setStage("review");
  }

  async function apply() {
    if (!diff) return;
    setStage("applying");
    const toApply: DiffChange[] = diff.changes.filter((_, i) => approved[i]);
    const result = await applyPasteDiff(contactId, toApply);
    if (!result.ok) {
      setError(result.error);
      setStage("review");
      return;
    }
    router.refresh();
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setStage("input");
        }}
        title="Cmd+Shift+V"
        className="font-sans inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-dark text-white hover:bg-dark/85 transition"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        </svg>
        Add context
      </button>

      {open ? (
        <Modal onClose={close}>
          {stage === "input" || stage === "parsing" ? (
            <PasteInput
              paste={paste}
              setPaste={setPaste}
              onSubmit={submit}
              onCancel={close}
              parsing={stage === "parsing"}
              error={error}
              textareaRef={textareaRef}
            />
          ) : null}

          {stage === "review" || stage === "applying" ? (
            <DiffReview
              diff={diff!}
              approved={approved}
              setApproved={setApproved}
              onApply={apply}
              onBack={() => setStage("input")}
              onCancel={close}
              applying={stage === "applying"}
              error={error}
            />
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Modal shell
   ───────────────────────────────────────────────────────────────────── */

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="font-sans fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      style={{ background: "rgba(17,17,17,0.4)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-[#ECECEC] max-h-[80vh] overflow-hidden flex flex-col"
      >
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Stage 1: paste textarea
   ───────────────────────────────────────────────────────────────────── */

function PasteInput({
  paste,
  setPaste,
  onSubmit,
  onCancel,
  parsing,
  error,
  textareaRef,
}: {
  paste: string;
  setPaste: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  parsing: boolean;
  error: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <>
      <div className="px-5 py-4 border-b border-[#ECECEC]">
        <h2 className="text-[15px] font-medium">Add context</h2>
        <p className="text-[12px] text-muted-fg mt-0.5">
          Paste anything. Address, DM, voice memo transcript, sizing, whatever.
          I&rsquo;ll sort it.
        </p>
      </div>
      <div className="px-5 py-4 flex-1 overflow-y-auto">
        <textarea
          ref={textareaRef}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (!parsing) onSubmit();
            }
          }}
          rows={12}
          disabled={parsing}
          placeholder="Paste the message, email, transcript, or anything else here..."
          className="w-full px-3 py-2.5 border border-[#ECECEC] rounded-lg text-[14px] leading-relaxed focus:outline-none focus:border-[#E11D48] resize-none disabled:opacity-60"
        />
        {error ? (
          <p className="mt-2 text-[12px] text-error">{error}</p>
        ) : null}
        <p className="mt-2 text-[11px] text-muted">
          Cmd+Enter to submit · Cmd+Shift+V from anywhere on the page
        </p>
      </div>
      <div className="px-5 py-3 border-t border-[#ECECEC] flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={parsing}
          className="px-3 py-1.5 text-[13px] text-muted-fg hover:text-dark"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={parsing || !paste.trim()}
          className="px-4 py-1.5 text-[13px] font-medium rounded-full bg-dark text-white hover:bg-dark/85 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {parsing ? "Parsing…" : "Parse"}
        </button>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Stage 2: diff review
   ───────────────────────────────────────────────────────────────────── */

function DiffReview({
  diff,
  approved,
  setApproved,
  onApply,
  onBack,
  onCancel,
  applying,
  error,
}: {
  diff: Diff;
  approved: Record<number, boolean>;
  setApproved: (a: Record<number, boolean>) => void;
  onApply: () => void;
  onBack: () => void;
  onCancel: () => void;
  applying: boolean;
  error: string | null;
}) {
  const counts = {
    selected: Object.values(approved).filter(Boolean).length,
    total: diff.changes.length,
  };

  // Group by kind for display priority: heads_up first (urgent), then sets,
  // then context, then suggestions.
  const order = ["heads_up", "set", "append_context", "suggest_tag", "mention_person"];
  const indexed = diff.changes
    .map((c, i) => ({ change: c, index: i }))
    .sort(
      (a, b) =>
        order.indexOf(a.change.kind) - order.indexOf(b.change.kind)
    );

  return (
    <>
      <div className="px-5 py-4 border-b border-[#ECECEC] flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-medium">Review proposed changes</h2>
          <p className="text-[12px] text-muted-fg mt-0.5">
            {counts.total === 0
              ? "Nothing parseable found."
              : `${counts.selected} of ${counts.total} selected.`}
          </p>
        </div>
        <button
          onClick={onBack}
          className="text-[11px] text-muted-fg hover:text-dark uppercase tracking-[0.15em]"
        >
          ← Edit paste
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {counts.total === 0 ? (
          <p className="text-[13px] text-muted py-8 text-center">
            Nothing in the paste mapped to a structured field or note.
            Try a different paste, or add as a raw context note manually.
          </p>
        ) : (
          <ul className="space-y-2">
            {indexed.map(({ change, index }) => (
              <ChangeRow
                key={index}
                change={change}
                checked={approved[index] ?? false}
                onToggle={(v) =>
                  setApproved({ ...approved, [index]: v })
                }
              />
            ))}
          </ul>
        )}

        {error ? (
          <p className="mt-3 text-[12px] text-error">{error}</p>
        ) : null}
      </div>

      <div className="px-5 py-3 border-t border-[#ECECEC] flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted">
          Suggestions (tags, mentioned people) are never auto-applied.
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={applying}
            className="px-3 py-1.5 text-[13px] text-muted-fg hover:text-dark"
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            disabled={applying || counts.selected === 0}
            className="px-4 py-1.5 text-[13px] font-medium rounded-full bg-dark text-white hover:bg-dark/85 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying
              ? "Applying…"
              : counts.selected === 0
                ? "Nothing selected"
                : `Apply ${counts.selected}`}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Per-row rendering
   ───────────────────────────────────────────────────────────────────── */

const CONFIDENCE_PILL: Record<"high" | "medium" | "low", string> = {
  high: "bg-primary-light text-primary border border-primary/20",
  medium: "bg-[#F5F5F4] text-muted-fg border border-[#ECECEC]",
  low: "bg-[#FFF4E5] text-warning border border-warning/20",
};

const KIND_LABEL: Record<DiffChange["kind"], string> = {
  set: "Field",
  append_context: "Context",
  heads_up: "Heads up",
  suggest_tag: "Tag suggestion",
  mention_person: "Mentioned",
};

const KIND_COLOR: Record<DiffChange["kind"], string> = {
  set: "text-dark",
  append_context: "text-dark",
  heads_up: "text-warning",
  suggest_tag: "text-muted-fg",
  mention_person: "text-muted-fg",
};

function ChangeRow({
  change,
  checked,
  onToggle,
}: {
  change: DiffChange;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  // suggest_tag and mention_person are informational — they have no apply path.
  const isInformational =
    change.kind === "suggest_tag" || change.kind === "mention_person";

  return (
    <li className="border border-[#ECECEC] rounded-lg p-3 flex items-start gap-3 hover:border-[#D4D4D4] transition">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        disabled={isInformational}
        className="mt-0.5 size-4 accent-dark disabled:opacity-30"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[10px] font-mono uppercase tracking-[0.15em] ${KIND_COLOR[change.kind]}`}
          >
            {KIND_LABEL[change.kind]}
          </span>
          {change.kind === "set" ? (
            <span
              className={`text-[10px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-full ${CONFIDENCE_PILL[change.confidence]}`}
            >
              {change.confidence}
            </span>
          ) : null}
        </div>

        <div className="mt-1.5">
          {change.kind === "set" ? (
            <p className="text-[14px]">
              <span className="font-mono text-muted-fg text-[12px]">
                {change.field}
              </span>{" "}
              <span className="text-muted-fg text-[12px]">→</span>{" "}
              <span className="font-medium">{change.value}</span>
            </p>
          ) : change.kind === "append_context" ? (
            <p className="text-[13px] whitespace-pre-line">{change.text}</p>
          ) : change.kind === "heads_up" ? (
            <p className="text-[13px] text-warning whitespace-pre-line">
              ⚠ {change.text}
            </p>
          ) : change.kind === "suggest_tag" ? (
            <p className="text-[13px]">
              Add tag{" "}
              <span className="font-mono px-1.5 py-0.5 bg-[#F5F5F4] rounded text-[11px]">
                {change.tag}
              </span>
              <span className="ml-2 text-[11px] text-muted">
                (suggestion only)
              </span>
            </p>
          ) : (
            <p className="text-[13px]">
              Mentioned: <span className="font-medium">{change.name}</span>
              {change.relationship ? (
                <span className="text-muted-fg"> ({change.relationship})</span>
              ) : null}
              <span className="ml-2 text-[11px] text-muted">
                (suggestion only)
              </span>
            </p>
          )}
        </div>

        {change.source ? (
          <p className="mt-1.5 text-[11px] text-muted italic pl-2 border-l-2 border-[#ECECEC]">
            &ldquo;{change.source}&rdquo;
          </p>
        ) : null}
      </div>
    </li>
  );
}
