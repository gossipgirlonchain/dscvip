"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  patchContact,
  searchContacts,
  updateGiftStatus,
  deleteGift,
  addTouchpoint,
  deleteTouchpoint,
  addContactNote,
  deleteContactNote,
  deleteContact,
} from "../../actions";
import {
  CHANNEL_LABEL,
  GIFT_STATUSES,
  LIFECYCLES,
  LIFECYCLE_LABEL,
  SIZE_BANDS,
  TOUCH_CHANNELS,
  type Contact,
  type ContactGift,
  type ContactNote,
  type ContactTouchpoint,
  type GiftStatus,
  type Lifecycle,
  type SizeBand,
} from "@/types/db";
import { SmartPasteButton } from "./smart-paste";
import { LogGiftPicker } from "./log-gift-picker";

/* ─────────────────────────────────────────────────────────────────────
   Context: autosave-aware page-wide state
   ───────────────────────────────────────────────────────────────────── */

type SaveState = "idle" | "saving" | "saved" | "error";

type Ctx = {
  contact: Contact;
  patch: (p: Partial<Contact>) => void;
  flushNow: () => Promise<void>;
  saveState: SaveState;
  lastSavedAt: number | null;
};

const ContactCtx = createContext<Ctx | null>(null);

function useContact(): Ctx {
  const c = useContext(ContactCtx);
  if (!c) throw new Error("ContactCtx not provided");
  return c;
}

/* ─────────────────────────────────────────────────────────────────────
   Shell
   ───────────────────────────────────────────────────────────────────── */

export function ContactShell({
  initial,
  gifts,
  touchpoints,
  notes,
}: {
  initial: Contact;
  gifts: ContactGift[];
  touchpoints: ContactTouchpoint[];
  notes: ContactNote[];
}) {
  const [contact, setContact] = useState<Contact>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const pending = useRef<Partial<Contact>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushNow = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;

    setSaveState("saving");
    const r = await patchContact(contact.id, patch as Record<string, unknown>);
    if (r.ok) {
      setSaveState("saved");
      setLastSavedAt(Date.now());
    } else {
      setSaveState("error");
    }
  }, [contact.id]);

  const patch = useCallback(
    (p: Partial<Contact>) => {
      setContact((c) => ({ ...c, ...p }));
      Object.assign(pending.current, p);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flushNow();
      }, 400);
    },
    [flushNow]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flushNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushNow]);

  useEffect(() => {
    const onBlur = () => void flushNow();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [flushNow]);

  const ctx = useMemo<Ctx>(
    () => ({ contact, patch, flushNow, saveState, lastSavedAt }),
    [contact, patch, flushNow, saveState, lastSavedAt]
  );

  return (
    <ContactCtx.Provider value={ctx}>
      <CommandPalette />
      <StickyHeader />
      <main className="dsc-bone relative font-sans text-[var(--color-ink)] mx-auto w-full max-w-[1180px] px-12 pt-6 pb-28">
        <PageChrome />
        <div className="relative z-10">
          <Hero />
          <HeadsUpCallout />
          <SnapshotStrip />
          <GiftsLedger gifts={gifts} />
          <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8">
            <ContextFeed notes={notes} />
            <OutreachFeed touchpoints={touchpoints} />
          </div>
          <ActivityAccordion
            gifts={gifts}
            touchpoints={touchpoints}
            notes={notes}
          />
        </div>
        <MirroredFooter />
      </main>
    </ContactCtx.Provider>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Page chrome — coil perimeter trace + chip mark with UUID hash.
   The brief says these have to be on screen at all times.
   ───────────────────────────────────────────────────────────────────── */

function PageChrome() {
  // v3: only the coil earns its space. Chip mark and registration
  // crosshairs were litter — the spec label on the left carries the
  // serial-number energy on its own.
  return (
    <>
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: 24,
          right: 24,
          bottom: 24,
          left: 24,
          border: "1px solid var(--color-dsc-red-soft)",
          borderRadius: 8,
          zIndex: 1,
        }}
      />
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: 36,
          right: 36,
          bottom: 36,
          left: 36,
          border: "1px solid var(--color-dsc-red-soft)",
          borderRadius: 6,
          zIndex: 1,
        }}
      />
    </>
  );
}


function MirroredFooter() {
  const { contact } = useContact();
  const updated = new Date(contact.updated_at)
    .toISOString()
    .slice(0, 10);
  return (
    <div
      className="absolute right-12 pointer-events-none select-none"
      style={{ bottom: 14, zIndex: 2 }}
    >
      <span
        className="dsc-mirror font-mono text-[10px] uppercase tracking-[0.18em]"
        style={{ color: "var(--color-dsc-red)", opacity: 0.6 }}
      >
        THIS IS A SPENDERS.CLUB CONTACT · UPDATED {updated} · KEEP IT SAFE
      </span>
    </div>
  );
}

/* (RegMark removed in v3 — registration crosshairs read as litter, not detail.) */

/* ─────────────────────────────────────────────────────────────────────
   Save indicator + sticky header
   ───────────────────────────────────────────────────────────────────── */

function SaveIndicator() {
  const { saveState, lastSavedAt } = useContact();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  let text = "ready";
  if (saveState === "saving") text = "committing…";
  else if (saveState === "error") text = "commit failed";
  else if (lastSavedAt) {
    const ago = Math.max(1, Math.round((Date.now() - lastSavedAt) / 1000));
    text =
      ago < 60
        ? `committed ${ago}s ago`
        : `committed ${Math.round(ago / 60)}m ago`;
  }

  // Dot pulses briefly each save commit by keying on lastSavedAt.
  return (
    <span
      className="font-mono text-[10px] lowercase tracking-[0.04em] inline-flex items-center gap-1.5 tabular-nums"
      style={{ color: "var(--color-dsc-red)" }}
      title={
        lastSavedAt
          ? `Last saved ${new Date(lastSavedAt).toLocaleString()}`
          : ""
      }
    >
      <span
        key={lastSavedAt ?? "idle"}
        className="dsc-pulse"
        style={{
          width: 6,
          height: 6,
          background: "var(--color-dsc-red)",
          display: "inline-block",
        }}
      />
      {text}
    </span>
  );
}

function StickyHeader() {
  const { contact } = useContact();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 200);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`font-sans sticky top-0 z-40 transition-opacity ${
        shown ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      style={{
        backdropFilter: "saturate(180%) blur(8px)",
        WebkitBackdropFilter: "saturate(180%) blur(8px)",
        background: "rgba(242,239,234,0.85)",
        borderBottom: "1px solid var(--color-ink-soft)",
      }}
    >
      <div className="mx-auto w-full max-w-[1180px] px-12 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-dsc-red)] shrink-0"
          >
            ← all
          </Link>
          <span
            className="font-semibold truncate"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {contact.display_name || contact.full_name}
          </span>
          <LifecyclePill compact />
        </div>
        <div className="flex items-center gap-3">
          <SmartPasteButton contactId={contact.id} compact />
          <SaveIndicator />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Hero
   ───────────────────────────────────────────────────────────────────── */

function LifecyclePill({ compact = false }: { compact?: boolean }) {
  const { contact, patch } = useContact();
  const isStrong = contact.lifecycle === "vip" || contact.lifecycle === "roster";
  const isArchived = contact.lifecycle === "archived";
  const size = compact ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-1";

  const style: React.CSSProperties = {
    appearance: "none",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.18em",
    borderRadius: 6,
    cursor: "pointer",
    border: "1px solid var(--color-dsc-red)",
    background: isStrong ? "var(--color-dsc-red)" : "transparent",
    color: isStrong ? "var(--color-bone)" : "var(--color-dsc-red)",
    textDecoration: isArchived ? "line-through" : "none",
  };

  return (
    <select
      value={contact.lifecycle}
      onChange={(e) => patch({ lifecycle: e.target.value as Lifecycle })}
      className={`${size} uppercase focus:outline-none`}
      style={style}
    >
      {LIFECYCLES.map((lc) => (
        <option
          key={lc}
          value={lc}
          style={{
            background: "var(--color-bone)",
            color: "var(--color-ink)",
          }}
        >
          {LIFECYCLE_LABEL[lc]}
        </option>
      ))}
    </select>
  );
}

function Meter({
  value,
  onChange,
  max = 5,
}: {
  value: number | null;
  onChange: (n: number) => void;
  max?: number;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      {Array.from({ length: max }).map((_, i) => {
        const filled = value != null && i < value;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i + 1 === value ? 0 : i + 1)}
            className={`w-2 h-2 rounded-full transition ${
              filled ? "bg-dark" : "bg-[#ECECEC] hover:bg-[#D4D4D4]"
            }`}
            aria-label={`Set to ${i + 1}`}
          />
        );
      })}
    </div>
  );
}

function OwnerChip() {
  const { contact, patch } = useContact();
  const [editing, setEditing] = useState(false);
  const initial = (contact.owner || "?").slice(0, 1).toUpperCase();

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={contact.owner ?? ""}
        placeholder="owner"
        onBlur={(e) => {
          patch({ owner: e.target.value.trim() || null });
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className="text-[12px] px-2 py-0.5 border border-dark/20 rounded-full focus:outline-none focus:border-[#E11D48] bg-white"
        style={{ width: 100 }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1.5 text-[12px] text-muted-fg hover:text-dark group"
    >
      <span className="w-5 h-5 rounded-full bg-dark text-white text-[10px] font-medium flex items-center justify-center">
        {initial}
      </span>
      <span>{contact.owner || "no owner"}</span>
    </button>
  );
}

function CopyIconLink({
  href,
  copyValue,
  title,
  children,
}: {
  href?: string;
  copyValue: string | null | undefined;
  title: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  if (!copyValue) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(copyValue);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
        if (href) window.open(href, "_blank", "noopener");
      }}
      title={`${title} · ${copied ? "copied" : "click to copy + open"}`}
      className="w-8 h-8 rounded-full flex items-center justify-center text-muted-fg hover:text-dark hover:bg-[#F5F5F4] transition"
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        children
      )}
    </button>
  );
}

function SocialsRow() {
  const { contact } = useContact();
  const x = contact.x_handle?.replace(/^@/, "");
  const tg = contact.telegram_handle?.replace(/^@/, "");
  const ig = contact.instagram_handle?.replace(/^@/, "");

  return (
    <div className="flex items-center gap-0.5">
      <CopyIconLink
        copyValue={tg}
        href={tg ? `https://t.me/${tg}` : undefined}
        title="Telegram"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21.5 4.5L2 12l5.5 2 1.5 5.5 3.5-3 5.5 4 3.5-15.5z" />
        </svg>
      </CopyIconLink>
      <CopyIconLink
        copyValue={x}
        href={x ? `https://x.com/${x}` : undefined}
        title="X"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18 2h3l-7 8 8 12h-6.5l-5-7-5.5 7H2l7.5-9L2 2h6.5l4.5 6.5L18 2z" />
        </svg>
      </CopyIconLink>
      <CopyIconLink
        copyValue={ig}
        href={ig ? `https://instagram.com/${ig}` : undefined}
        title="Instagram"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
        </svg>
      </CopyIconLink>
      <CopyIconLink
        copyValue={contact.email}
        href={`mailto:${contact.email}`}
        title="Email"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <polyline points="3 7 12 13 21 7" />
        </svg>
      </CopyIconLink>
      <CopyIconLink
        copyValue={contact.phone}
        href={contact.phone ? `tel:${contact.phone}` : undefined}
        title="Phone"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
        </svg>
      </CopyIconLink>
    </div>
  );
}

function InlineEdit({
  value,
  placeholder,
  onCommit,
  className = "",
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => {
          onCommit(e.target.value.trim());
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className={`bg-transparent border-b border-[#E11D48] focus:outline-none ${className}`}
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className={`${className} text-left hover:bg-[#F5F5F4] rounded px-1 -mx-1`}
    >
      {value || (
        <span className="text-muted italic">{placeholder ?? "—"}</span>
      )}
    </button>
  );
}

function EditableChip({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onCommit: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={value ?? ""}
        placeholder={placeholder}
        onBlur={(e) => {
          const v = e.target.value.trim();
          onCommit(v || null);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className="text-[12px] px-2 py-0.5 border border-[#E11D48] rounded-full focus:outline-none bg-white"
        style={{ width: 160 }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-[12px] px-2 py-0.5 rounded-full hover:bg-[#F5F5F4] text-muted-fg hover:text-dark transition"
      title={label}
    >
      {value ?? (
        <span className="italic">+ {label.toLowerCase()}</span>
      )}
    </button>
  );
}

function HeroKebab() {
  const [open, setOpen] = useState(false);
  const { contact } = useContact();
  useEffect(() => {
    if (!open) return;
    const onClick = () => setOpen(false);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-7 h-7 rounded-full hover:bg-[#F5F5F4] flex items-center justify-center text-muted-fg hover:text-dark transition"
        title="More"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 top-full mt-1 bg-white border border-[#ECECEC] rounded-lg shadow-lg py-1 min-w-[160px] z-30">
          <form action={deleteContact}>
            <input type="hidden" name="id" value={contact.id} />
            <button
              type="submit"
              className="w-full text-left px-3 py-1.5 text-[12px] text-error hover:bg-[#FFF1F2]"
              onClick={(e) => {
                if (
                  !confirm(
                    `Delete ${contact.display_name || contact.full_name}? This cannot be undone.`
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              PURGE RECORD
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Hero() {
  const { contact, patch } = useContact();

  return (
    <header
      className="space-y-2.5 px-5 py-4"
      style={{
        background: "var(--color-bone-surface)",
        border: "1px solid rgba(14,14,14,0.12)",
        borderRadius: 8,
      }}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h1
            className="text-[36px] leading-[0.95] font-bold tracking-tight uppercase"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <InlineEdit
              value={contact.display_name || contact.full_name}
              placeholder="Name"
              onCommit={(v) => {
                if (!v) return;
                patch({ display_name: v });
              }}
            />
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-fg">
            <LifecyclePill />
            <OwnerChip />
            <span className="flex items-center gap-1.5">
              <span>Priority</span>
              <Meter
                value={contact.priority}
                onChange={(n) => patch({ priority: n === 0 ? null : n })}
              />
            </span>
            <span className="flex items-center gap-1.5">
              <span>Warmth</span>
              <Meter
                value={contact.warmth}
                onChange={(n) => patch({ warmth: n === 0 ? null : n })}
              />
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <EditableChip
              label="City"
              value={contact.base_city}
              placeholder="base city"
              onCommit={(v) => patch({ base_city: v })}
            />
            <ChipDot />
            <EditableChip
              label="Timezone"
              value={contact.timezone}
              placeholder="timezone"
              onCommit={(v) => patch({ timezone: v })}
            />
            <ChipDot />
            <EditableChip
              label="Community"
              value={contact.community}
              placeholder="community"
              onCommit={(v) => patch({ community: v })}
            />
            <ChipDot />
            <EditableChip
              label="Project"
              value={contact.project}
              placeholder="project"
              onCommit={(v) => patch({ project: v })}
            />
            <ChipDot />
            <EditableChip
              label="Intro"
              value={contact.introduced_by}
              placeholder="introduced by"
              onCommit={(v) => patch({ introduced_by: v })}
            />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <SmartPasteButton contactId={contact.id} />
            <SaveIndicator />
            <HeroKebab />
          </div>
          <SocialsRow />
        </div>
      </div>
    </header>
  );
}

function ChipDot() {
  return <span className="text-muted opacity-50 text-[10px]">·</span>;
}

/* ─────────────────────────────────────────────────────────────────────
   Heads-up callout
   ───────────────────────────────────────────────────────────────────── */

function HeadsUpCallout() {
  const { contact, patch } = useContact();
  if (!contact.heads_up) return null;
  return (
    <div
      className="mt-4 p-3 flex items-start gap-3"
      style={{
        border: "1px solid var(--color-dsc-red)",
        background: "var(--color-dsc-red-mist)",
      }}
    >
      <span
        className="font-mono text-[10px] uppercase tracking-[0.2em] shrink-0"
        style={{ color: "var(--color-dsc-red)" }}
      >
        // heads up
      </span>
      <p
        className="flex-1 text-[12px] whitespace-pre-line leading-relaxed"
        style={{ color: "var(--color-ink)" }}
      >
        {contact.heads_up}
      </p>
      <button
        type="button"
        onClick={() => patch({ heads_up: null })}
        className="font-mono text-[11px] text-[var(--color-dsc-red)] hover:opacity-70 shrink-0"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Snapshot strip — replaces the right rail
   ───────────────────────────────────────────────────────────────────── */

type SnapshotTile = "tier" | "flags" | "sizing" | "tags" | "shipping";

function SnapshotStrip() {
  const { contact } = useContact();
  const [open, setOpen] = useState<SnapshotTile | null>(null);

  function toggle(t: SnapshotTile) {
    setOpen((current) => (current === t ? null : t));
  }

  const shipLine = (() => {
    const place = [
      contact.city_region?.split(",")[0]?.trim(),
      contact.country,
    ]
      .filter(Boolean)
      .join(", ");
    return place || "no address";
  })();

  const sizeLine = `${contact.shirt_size}·${contact.pants_size}·${contact.shorts_size}·${contact.sweatshirt_size}${contact.shoe_size ? ` · ${contact.shoe_size}` : ""}`;

  return (
    <section className="mt-5">
      <div
        className="grid grid-cols-2 md:grid-cols-5 overflow-hidden"
        style={{
          border: "1px solid rgba(14,14,14,0.12)",
          background: "var(--color-bone-surface)",
          borderRadius: 8,
        }}
      >
        <Tile
          active={open === "tier"}
          onClick={() => toggle("tier")}
          label="Tier"
          value={
            contact.roster_tier ? (
              <span className="font-medium">{contact.roster_tier}</span>
            ) : (
              <span className="text-muted italic">none</span>
            )
          }
        />
        <Tile
          active={open === "flags"}
          onClick={() => toggle("flags")}
          label="Flags"
          value={<FlagsSummary />}
        />
        <Tile
          active={open === "sizing"}
          onClick={() => toggle("sizing")}
          label="Sizing"
          value={
            <span className="font-mono text-[12px]">{sizeLine}</span>
          }
        />
        <Tile
          active={open === "tags"}
          onClick={() => toggle("tags")}
          label="Tags"
          value={<TagsSummary />}
        />
        <Tile
          active={open === "shipping"}
          onClick={() => toggle("shipping")}
          label="Ships to"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className="truncate">{shipLine}</span>
              {contact.address_verified ? (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
                  title="verified"
                />
              ) : null}
            </span>
          }
        />
      </div>

      {open ? (
        <div className="mt-2 border border-[#ECECEC] rounded-lg bg-white p-4">
          {open === "tier" ? <TierEditor /> : null}
          {open === "flags" ? <FlagsEditor /> : null}
          {open === "sizing" ? <SizingEditor /> : null}
          {open === "tags" ? <TagsEditor /> : null}
          {open === "shipping" ? <ShippingEditor /> : null}
        </div>
      ) : null}
    </section>
  );
}

function Tile({
  active,
  onClick,
  label,
  value,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left px-3 py-2.5 border-r border-b md:border-b-0 last:border-r-0 border-[#ECECEC] transition ${
        active ? "bg-[#F5F5F4]" : "hover:bg-[#FAFAFA]"
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-fg">
        {label}
      </div>
      <div className="mt-0.5 text-[13px] truncate">{value}</div>
    </button>
  );
}

function FlagsSummary() {
  const { contact } = useContact();
  const on = [
    contact.gifting_eligible && "G",
    contact.castable && "C",
    contact.permanent_vip && "★V",
    contact.permanent_roster && "★R",
  ].filter(Boolean);
  const blocks = [
    contact.do_not_gift && "NO-GIFT",
    contact.do_not_engage && "NO-ENGAGE",
  ].filter(Boolean) as string[];

  if (on.length === 0 && blocks.length === 0) {
    return <span className="text-muted italic">none</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {on.map((s) => (
        <span
          key={s as string}
          className="font-mono text-[10px] px-1 py-0.5 bg-[#F5F5F4] rounded"
        >
          {s}
        </span>
      ))}
      {blocks.map((s) => (
        <span
          key={s}
          className="font-mono text-[10px] px-1 py-0.5 bg-[#FFF1F2] text-error rounded"
        >
          {s}
        </span>
      ))}
    </span>
  );
}

function TagsSummary() {
  const { contact } = useContact();
  if (contact.tags.length === 0) {
    return <span className="text-muted italic">none</span>;
  }
  const visible = contact.tags.slice(0, 2);
  const extra = contact.tags.length - visible.length;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
      {visible.map((t) => (
        <span key={t} className="text-muted-fg">
          {t}
        </span>
      ))}
      {extra > 0 ? <span className="text-muted">+{extra}</span> : null}
    </span>
  );
}

function TierEditor() {
  const { contact, patch } = useContact();
  const tiers = ["A", "B", "C"] as const;
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-dsc-red)]">
        roster tier
      </span>
      <div className="inline-flex">
        {tiers.map((t) => {
          const active = contact.roster_tier === t;
          return (
            <button
              key={t}
              onClick={() => patch({ roster_tier: active ? null : t })}
              className="font-mono text-[14px] font-medium transition focus:outline-none"
              style={{
                width: 36,
                height: 36,
                border: "1px solid var(--color-dsc-red)",
                marginLeft: t === "A" ? 0 : -1,
                background: active ? "var(--color-dsc-red)" : "transparent",
                color: active ? "var(--color-bone)" : "var(--color-dsc-red)",
                borderRadius: 2, // punched-card squares stay sharp
              }}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FlagsEditor() {
  const { contact, patch } = useContact();
  type FlagKey =
    | "castable"
    | "gifting_eligible"
    | "permanent_vip"
    | "permanent_roster"
    | "do_not_gift"
    | "do_not_engage";
  const flags: Array<{ key: FlagKey; label: string; danger?: boolean }> = [
    { key: "gifting_eligible", label: "Gifting eligible" },
    { key: "castable", label: "Castable" },
    { key: "permanent_vip", label: "Permanent VIP" },
    { key: "permanent_roster", label: "Permanent roster" },
    { key: "do_not_gift", label: "Do not gift", danger: true },
    { key: "do_not_engage", label: "Do not engage", danger: true },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
      {flags.map((f) => {
        const checked = Boolean(contact[f.key]);
        return (
          <label
            key={f.key}
            className="flex items-center gap-2 text-[13px] cursor-pointer select-none"
          >
            <DscCheckbox
              checked={checked}
              onChange={(v) =>
                patch({ [f.key]: v } as Partial<Contact>)
              }
            />
            <span
              style={{
                color: f.danger && checked
                  ? "var(--color-dsc-red)"
                  : "var(--color-ink)",
              }}
            >
              {f.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* Ghost-red button — DSC's primary control treatment.
   Transparent fill, 1px red border, mono uppercase label.
   Hover flips fill to red, text to bone. No gradient, no shadow. */
function DscButton({
  children,
  onClick,
  type = "button",
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  size?: "sm" | "md";
}) {
  const sizing =
    size === "sm" ? "text-[9px] px-2 py-1" : "text-[10px] px-3 py-1.5";
  return (
    <button
      type={type}
      onClick={onClick}
      className={`font-mono uppercase tracking-[0.18em] transition cursor-pointer focus:outline-none ${sizing}`}
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
      {children}
    </button>
  );
}

/* Bottom-hairline-only text input. Idle has 1px ink/20%, focus turns red. */
function DscField({
  name,
  placeholder,
  defaultValue,
  required,
  autoFocus,
  mono,
  onBlur,
  type = "text",
}: {
  name?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  autoFocus?: boolean;
  mono?: boolean;
  type?: string;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      name={name}
      type={type}
      placeholder={placeholder}
      defaultValue={defaultValue}
      required={required}
      autoFocus={autoFocus}
      onBlur={onBlur}
      className={`bg-transparent border-0 px-1 py-1 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] ${
        mono ? "font-mono text-[12px]" : ""
      }`}
      style={{
        borderBottom: "1px solid rgba(14,14,14,0.20)",
        color: "var(--color-ink)",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderBottom = "1px solid var(--color-dsc-red)";
      }}
      onBlurCapture={(e) => {
        e.currentTarget.style.borderBottom = "1px solid rgba(14,14,14,0.20)";
      }}
    />
  );
}

function DscSelect({
  name,
  defaultValue,
  children,
  onChange,
}: {
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      onChange={onChange}
      className="bg-transparent border-0 px-1 py-1 text-[13px] focus:outline-none cursor-pointer"
      style={{
        borderBottom: "1px solid rgba(14,14,14,0.20)",
        color: "var(--color-ink)",
        appearance: "none",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderBottom = "1px solid var(--color-dsc-red)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderBottom = "1px solid rgba(14,14,14,0.20)";
      }}
    >
      {children}
    </select>
  );
}

/* Square 14px checkbox with a red X when checked */
function DscCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center justify-center"
      style={{
        width: 14,
        height: 14,
        border: "1px solid var(--color-ink)",
        background: checked ? "var(--color-dsc-red)" : "transparent",
        borderRadius: 2, // punched-card sharpness
      }}
    >
      {checked ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          stroke="var(--color-bone)"
          strokeWidth="1.5"
        >
          <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
          <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
        </svg>
      ) : null}
    </button>
  );
}

function SizingEditor() {
  const { contact, patch } = useContact();
  const sizeFields: Array<{
    key:
      | "shirt_size"
      | "pants_size"
      | "shorts_size"
      | "sweatshirt_size"
      | "hat_size";
    label: string;
    optional?: boolean;
  }> = [
    { key: "shirt_size", label: "Shirt" },
    { key: "pants_size", label: "Pants" },
    { key: "shorts_size", label: "Shorts" },
    { key: "sweatshirt_size", label: "Sweat" },
    { key: "hat_size", label: "Hat", optional: true },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-[12px]">
        {sizeFields.map((f) => {
          const value = contact[f.key] as SizeBand | null;
          return (
            <div key={f.key}>
              <div className="text-[10px] uppercase tracking-[0.15em] text-muted-fg mb-1">
                {f.label}
              </div>
              <select
                value={value ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  patch({
                    [f.key]: (v || null) as SizeBand | null,
                  } as Partial<Contact>);
                }}
                className="w-full px-2 py-1 border border-[#ECECEC] rounded text-[12px] focus:outline-none focus:border-[#E11D48]"
              >
                {f.optional ? <option value="">—</option> : null}
                {SIZE_BANDS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-fg mb-1">
            Shoe
          </div>
          <input
            defaultValue={contact.shoe_size ?? ""}
            placeholder="—"
            onBlur={(e) =>
              patch({ shoe_size: e.target.value.trim() || null })
            }
            className="w-full px-2 py-1 border border-[#ECECEC] rounded text-[12px] focus:outline-none focus:border-[#E11D48]"
          />
        </div>
      </div>
    </div>
  );
}

function TagsEditor() {
  const { contact, patch } = useContact();
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const v = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (!v) return;
    if (contact.tags.includes(v)) return;
    patch({ tags: [...contact.tags, v] });
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {contact.tags.map((t) => (
        <button
          key={t}
          onClick={() =>
            patch({ tags: contact.tags.filter((x) => x !== t) })
          }
          title="Remove tag"
          className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F5F5F4] hover:bg-[#EEEEEC] font-mono text-[11px] text-muted-fg hover:text-dark transition"
        >
          {t}
          <span className="opacity-0 group-hover:opacity-100 text-[10px]">
            ×
          </span>
        </button>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (
            e.key === "Backspace" &&
            draft === "" &&
            contact.tags.length
          ) {
            patch({ tags: contact.tags.slice(0, -1) });
          }
        }}
        onBlur={() => draft && commit(draft)}
        placeholder={contact.tags.length ? "+ tag" : "+ add tag"}
        className="font-mono text-[11px] bg-transparent placeholder:text-muted focus:outline-none focus:border-[#E11D48] border-b border-transparent min-w-[80px]"
      />
    </div>
  );
}

function ShippingEditor() {
  const { contact, patch } = useContact();

  const input = (extra = "") =>
    `w-full px-2 py-1 border border-[#ECECEC] rounded text-[12px] focus:outline-none focus:border-[#E11D48] ${extra}`;
  const labelClass =
    "text-[10px] uppercase tracking-[0.15em] text-muted-fg mb-1 block";

  return (
    <div className="space-y-2.5 text-[12px]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label>
          <span className={labelClass}>Recipient</span>
          <input
            defaultValue={contact.shipping_recipient ?? ""}
            placeholder={contact.full_name}
            onBlur={(e) =>
              patch({ shipping_recipient: e.target.value.trim() || null })
            }
            className={input()}
          />
        </label>
        <label>
          <span className={labelClass}>Street</span>
          <input
            defaultValue={contact.address_line1}
            onBlur={(e) => patch({ address_line1: e.target.value })}
            className={input()}
          />
        </label>
        <label>
          <span className={labelClass}>Apt / suite</span>
          <input
            defaultValue={contact.address_line2 ?? ""}
            onBlur={(e) =>
              patch({ address_line2: e.target.value.trim() || null })
            }
            className={input()}
          />
        </label>
        <label>
          <span className={labelClass}>City, state, region</span>
          <input
            defaultValue={contact.city_region}
            onBlur={(e) => patch({ city_region: e.target.value })}
            className={input()}
          />
        </label>
        <label>
          <span className={labelClass}>Postal / zip</span>
          <input
            defaultValue={contact.postal_code}
            onBlur={(e) => patch({ postal_code: e.target.value })}
            className={input("font-mono")}
          />
        </label>
        <label>
          <span className={labelClass}>Country</span>
          <input
            defaultValue={contact.country}
            onBlur={(e) => patch({ country: e.target.value })}
            className={input()}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none pt-1">
        <input
          type="checkbox"
          checked={contact.address_verified}
          onChange={(e) => patch({ address_verified: e.target.checked })}
          className="size-4 accent-dark"
        />
        <span>Address verified</span>
      </label>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Gifts ledger — full width, above the fold
   ───────────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/* DSC stamp pills — single accent (oxblood). Active states use red fill,
   bone text. Inactive/in-progress states use red border, varying tints. */
const GIFT_STATUS_STAMP: Record<GiftStatus, React.CSSProperties> = {
  queued: {
    border: "1px solid var(--color-muted)",
    background: "transparent",
    color: "var(--color-muted-deep)",
  },
  packed: {
    border: "1px solid var(--color-dsc-red)",
    background: "transparent",
    color: "var(--color-dsc-red)",
  },
  shipped: {
    border: "1px solid var(--color-dsc-red)",
    background: "var(--color-dsc-red-mist)",
    color: "var(--color-dsc-red)",
  },
  delivered: {
    border: "1px solid var(--color-dsc-red)",
    background: "var(--color-dsc-red)",
    color: "var(--color-bone)",
  },
  posted: {
    border: "1px solid var(--color-dsc-red)",
    background: "var(--color-dsc-red)",
    color: "var(--color-bone)",
  },
  returned: {
    border: "1px dashed var(--color-dsc-red)",
    background: "transparent",
    color: "var(--color-dsc-red)",
  },
};

function GiftsLedger({ gifts }: { gifts: ContactGift[] }) {
  const { contact } = useContact();
  const [adding, setAdding] = useState(false);

  return (
    <section
      className="relative mt-8 px-5 py-4"
      style={{
        background: "var(--color-bone-surface)",
        border: "1px solid rgba(14,14,14,0.12)",
        borderRadius: 8,
      }}
    >
      <div className="flex items-end justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <h2
            className="text-[18px] font-bold uppercase tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            LEDGER
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-dsc-red)]">
            [{gifts.length}]
          </span>
        </div>
        <DscButton onClick={() => setAdding(true)}>+ log gift</DscButton>
      </div>

      {adding ? (
        <LogGiftPicker
          contact={contact}
          recentProductIds={Array.from(
            new Set(
              gifts
                .map((g) => g.product_id)
                .filter((id): id is string => !!id)
            )
          ).slice(0, 5)}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {gifts.length === 0 ? (
        <EmptyGifts
          name={contact.display_name || contact.full_name}
          onAdd={() => setAdding(true)}
        />
      ) : (
        <div
          className="relative overflow-hidden"
          style={{
            background: "var(--color-bone-surface)",
            border: "1px solid rgba(14,14,14,0.12)",
            borderRadius: 8,
          }}
        >
          <table className="w-full text-[13px]">
            <thead>
              <tr
                className="text-left font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{
                  color: "var(--color-dsc-red)",
                  borderBottom: "1px solid var(--color-dsc-red)",
                }}
              >
                <th className="px-3 py-2 font-normal w-[80px]">date</th>
                <th className="px-3 py-2 font-normal">item</th>
                <th className="px-3 py-2 font-normal">drop</th>
                <th className="px-3 py-2 font-normal w-[110px]">status</th>
                <th className="px-3 py-2 font-normal">tracking</th>
                <th className="px-3 py-2 font-normal">by</th>
                <th className="px-3 py-2 font-normal w-[40px]" />
              </tr>
            </thead>
            <tbody>
              <tr aria-hidden style={{ height: 0 }}>
                <td colSpan={7} style={{ padding: 0 }} />
              </tr>
              {gifts.map((g) => (
                <tr
                  key={g.id}
                  className="group hover:bg-[var(--color-bone-deep)] transition"
                  style={{ borderBottom: "1px solid rgba(14,14,14,0.08)" }}
                >
                  <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--color-muted)] align-top">
                    {fmtDate(g.sent_at ?? g.created_at)}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="font-medium">{g.item}</div>
                    {g.notes ? (
                      <div className="text-[11px] text-[var(--color-muted)] italic">
                        {g.notes}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 align-top text-[var(--color-muted)]">
                    {g.drop_name ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <GiftStatusPill gift={g} />
                  </td>
                  <td className="px-3 py-2.5 align-top font-mono text-[11px] text-[var(--color-muted)]">
                    {g.tracking ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 align-top text-[11px] text-[var(--color-muted)]">
                    {g.logged_by ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 align-top text-right">
                    <form action={deleteGift}>
                      <input type="hidden" name="id" value={g.id} />
                      <input
                        type="hidden"
                        name="contact_id"
                        value={contact.id}
                      />
                      <button
                        type="submit"
                        className="text-[11px] text-muted-fg hover:text-error opacity-0 group-hover:opacity-100 transition"
                      >
                        ×
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GiftStatusPill({ gift }: { gift: ContactGift }) {
  const { contact } = useContact();
  return (
    <form action={updateGiftStatus} className="inline-block">
      <input type="hidden" name="id" value={gift.id} />
      <input type="hidden" name="contact_id" value={contact.id} />
      <select
        name="status"
        defaultValue={gift.status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.15em] cursor-pointer focus:outline-none"
        style={{
          appearance: "none",
          borderRadius: 6,
          ...GIFT_STATUS_STAMP[gift.status],
        }}
      >
        {GIFT_STATUSES.map((s) => (
          <option
            key={s}
            value={s}
            style={{
              background: "var(--color-bone)",
              color: "var(--color-ink)",
            }}
          >
            {s}
          </option>
        ))}
      </select>
    </form>
  );
}

function EmptyGifts({
  name,
  onAdd,
}: {
  name: string;
  onAdd: () => void;
}) {
  // v3: slim. One line + button, left-aligned. No dashed container,
  // no reserved real estate — the empty state was eating the page.
  return (
    <div className="py-3 space-y-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted-deep)]">
        // no gifts logged. nothing shipped to {name.toLowerCase()} yet.
      </p>
      <button
        onClick={onAdd}
        className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 transition"
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
        log first gift
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Context feed — left column below ledger
   ───────────────────────────────────────────────────────────────────── */

function ContextFeed({ notes }: { notes: ContactNote[] }) {
  const { contact } = useContact();
  const [adding, setAdding] = useState(false);

  return (
    <section
      className="px-5 py-4"
      style={{
        background: "var(--color-bone-surface)",
        border: "1px solid rgba(14,14,14,0.12)",
        borderRadius: 8,
      }}
    >
      <div
        className="flex items-baseline justify-between mb-3 pb-1"
        style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
      >
        <h2
          className="font-mono text-[10px] uppercase tracking-[0.2em]"
          style={{ color: "var(--color-dsc-red)" }}
        >
          dossier
        </h2>
        <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
          [{notes.length}]
        </span>
      </div>

      {adding ? (
        <form
          action={async (fd) => {
            await addContactNote(fd);
            setAdding(false);
          }}
          className="border border-[#ECECEC] rounded-lg p-3 mb-2 space-y-2"
        >
          <input type="hidden" name="contact_id" value={contact.id} />
          <textarea
            name="body"
            required
            autoFocus
            rows={3}
            placeholder="What should the team know?"
            className="w-full px-2 py-1.5 border border-[#ECECEC] rounded text-[13px] focus:outline-none focus:border-[#E11D48] resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <input
              name="author"
              placeholder="by"
              className="text-[11px] px-2 py-1 border border-[#ECECEC] rounded focus:outline-none focus:border-[#E11D48] w-24"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-[12px] text-muted-fg hover:text-dark"
              >
                cancel
              </button>
              <button
                type="submit"
                className="text-[12px] font-medium px-3 py-1 rounded-full bg-dark text-white hover:bg-dark/85"
              >
                Add note
              </button>
            </div>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full text-left text-[12px] text-muted-fg hover:text-dark py-2 border-b border-[#ECECEC] mb-2"
        >
          + add note
        </button>
      )}

      {notes.length === 0 ? (
        <p className="text-[12px] text-muted py-4">
          // no context. paste a DM or log a note to start.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <NoteEntry key={n.id} note={n} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteEntry({ note }: { note: ContactNote }) {
  const { contact } = useContact();
  const sourcePill: Record<ContactNote["source"], string> = {
    manual: "bg-[#F5F5F4] text-muted-fg",
    paste: "bg-[#FEF3C7] text-[#92400E]",
    outreach: "bg-[#DBEAFE] text-[#1E40AF]",
  };

  return (
    <li className="group">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-mono text-muted">
            {fmtDate(note.created_at)}
          </span>
          {note.author ? (
            <span className="text-muted-fg">{note.author}</span>
          ) : null}
          <span
            className={`font-mono text-[9px] uppercase tracking-[0.15em] px-1 py-0.5 rounded ${sourcePill[note.source]}`}
          >
            {note.source}
          </span>
        </div>
        <form action={deleteContactNote}>
          <input type="hidden" name="id" value={note.id} />
          <input type="hidden" name="contact_id" value={contact.id} />
          <button
            type="submit"
            className="text-[11px] text-muted hover:text-error opacity-0 group-hover:opacity-100 transition"
            title="Delete"
          >
            ×
          </button>
        </form>
      </div>
      <p className="text-[13px] whitespace-pre-line leading-relaxed">
        {note.body}
      </p>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Outreach feed — right column
   ───────────────────────────────────────────────────────────────────── */

function OutreachFeed({
  touchpoints,
}: {
  touchpoints: ContactTouchpoint[];
}) {
  const { contact } = useContact();
  const [adding, setAdding] = useState(false);

  return (
    <section
      className="px-5 py-4"
      style={{
        background: "var(--color-bone-surface)",
        border: "1px solid rgba(14,14,14,0.12)",
        borderRadius: 8,
      }}
    >
      <div
        className="flex items-baseline justify-between mb-3 pb-1"
        style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
      >
        <h2
          className="font-mono text-[10px] uppercase tracking-[0.2em]"
          style={{ color: "var(--color-dsc-red)" }}
        >
          transmissions
        </h2>
        <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
          [{touchpoints.length}]
        </span>
      </div>

      {adding ? (
        <form
          action={async (fd) => {
            await addTouchpoint(fd);
            setAdding(false);
          }}
          className="border border-[#ECECEC] rounded-lg p-3 mb-2 space-y-2 text-[13px]"
        >
          <input type="hidden" name="contact_id" value={contact.id} />
          <div className="grid grid-cols-2 gap-2">
            <select
              name="channel"
              defaultValue="dm_tg"
              className="px-2 py-1.5 border border-[#ECECEC] rounded focus:outline-none focus:border-[#E11D48]"
            >
              {TOUCH_CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {CHANNEL_LABEL[ch]}
                </option>
              ))}
            </select>
            <select
              name="direction"
              defaultValue="outbound"
              className="px-2 py-1.5 border border-[#ECECEC] rounded focus:outline-none focus:border-[#E11D48]"
            >
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </select>
          </div>
          <textarea
            name="summary"
            required
            rows={2}
            placeholder="What was said / what's the ask"
            className="w-full px-2 py-1.5 border border-[#ECECEC] rounded focus:outline-none focus:border-[#E11D48] resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              name="follow_up_at"
              type="date"
              className="px-2 py-1.5 border border-[#ECECEC] rounded focus:outline-none focus:border-[#E11D48]"
            />
            <input
              name="logged_by"
              placeholder="by"
              className="px-2 py-1.5 border border-[#ECECEC] rounded focus:outline-none focus:border-[#E11D48]"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-[12px] text-muted-fg hover:text-dark"
            >
              cancel
            </button>
            <button
              type="submit"
              className="text-[12px] font-medium px-3 py-1 rounded-full bg-dark text-white hover:bg-dark/85"
            >
              Log
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full text-left text-[12px] text-muted-fg hover:text-dark py-2 border-b border-[#ECECEC] mb-2"
        >
          + log touchpoint
        </button>
      )}

      {touchpoints.length === 0 ? (
        <p className="text-[12px] text-muted py-4">
          // no outreach logged. log a DM, reply, or call.
        </p>
      ) : (
        <ul className="space-y-3">
          {touchpoints.map((t) => (
            <TouchpointEntry key={t.id} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TouchpointEntry({ t }: { t: ContactTouchpoint }) {
  const { contact } = useContact();
  return (
    <li className="group">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-mono text-muted">{fmtDate(t.occurred_at)}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-fg">
            {CHANNEL_LABEL[t.channel]}
          </span>
          <span className="text-muted">
            {t.direction === "outbound" ? "→" : "←"}
          </span>
          {t.logged_by ? (
            <span className="text-muted-fg">{t.logged_by}</span>
          ) : null}
        </div>
        <form action={deleteTouchpoint}>
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="contact_id" value={contact.id} />
          <button
            type="submit"
            className="text-[11px] text-muted hover:text-error opacity-0 group-hover:opacity-100 transition"
          >
            ×
          </button>
        </form>
      </div>
      <p className="text-[13px] whitespace-pre-line leading-relaxed">
        {t.summary}
      </p>
      {t.follow_up_at ? (
        <p className="text-[11px] text-primary font-mono mt-0.5">
          follow up {fmtDate(t.follow_up_at)}
        </p>
      ) : null}
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Activity — collapsed accordion at the bottom
   ───────────────────────────────────────────────────────────────────── */

type TimelineEvent =
  | { kind: "gift"; at: string; gift: ContactGift }
  | { kind: "touch"; at: string; touch: ContactTouchpoint }
  | { kind: "note"; at: string; note: ContactNote }
  | { kind: "added"; at: string };

function ActivityAccordion({
  gifts,
  touchpoints,
  notes,
}: {
  gifts: ContactGift[];
  touchpoints: ContactTouchpoint[];
  notes: ContactNote[];
}) {
  const { contact } = useContact();
  const [open, setOpen] = useState(false);

  const events: TimelineEvent[] = [
    ...gifts.map((g) => ({
      kind: "gift" as const,
      at: g.sent_at ?? g.created_at,
      gift: g,
    })),
    ...touchpoints.map((t) => ({
      kind: "touch" as const,
      at: t.occurred_at,
      touch: t,
    })),
    ...notes.map((n) => ({
      kind: "note" as const,
      at: n.created_at,
      note: n,
    })),
    { kind: "added" as const, at: contact.created_at },
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <section
      className="mt-8 px-5 py-3"
      style={{
        background: "var(--color-bone-surface)",
        border: "1px solid rgba(14,14,14,0.12)",
        borderRadius: 8,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full text-left group"
      >
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{ color: "var(--color-dsc-red)" }}
          >
            log
          </span>
          <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
            [{events.length}]
          </span>
        </div>
        <span
          className={`font-mono text-[12px] text-[var(--color-dsc-red)] transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>

      {open ? (
        <ol className="mt-4 space-y-1.5">
          {events.map((ev, i) => (
            <li
              key={i}
              className="grid grid-cols-[90px_1fr] gap-3 text-[12px]"
            >
              <span className="font-mono text-muted">{fmtDate(ev.at)}</span>
              {ev.kind === "gift" ? (
                <span>
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted-fg mr-2">
                    gift · {ev.gift.status}
                  </span>
                  {ev.gift.item}
                  {ev.gift.drop_name ? ` · ${ev.gift.drop_name}` : ""}
                </span>
              ) : ev.kind === "touch" ? (
                <span>
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted-fg mr-2">
                    {CHANNEL_LABEL[ev.touch.channel]} ·{" "}
                    {ev.touch.direction === "outbound" ? "out" : "in"}
                  </span>
                  {ev.touch.summary.slice(0, 100)}
                  {ev.touch.summary.length > 100 ? "…" : ""}
                </span>
              ) : ev.kind === "note" ? (
                <span>
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted-fg mr-2">
                    note · {ev.note.source}
                  </span>
                  {ev.note.body.slice(0, 100)}
                  {ev.note.body.length > 100 ? "…" : ""}
                </span>
              ) : (
                <span>
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted-fg mr-2">
                    added · {contact.source}
                  </span>
                  Contact created
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Command palette — Cmd+K
   ───────────────────────────────────────────────────────────────────── */

function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    Awaited<ReturnType<typeof searchContacts>>
  >([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
        setResults([]);
        setActive(0);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (q.length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      const r = await searchContacts(q);
      if (!cancelled) {
        setResults(r);
        setActive(0);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, open]);

  if (!open) return null;

  return (
    <div
      className="font-sans fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      style={{ background: "rgba(17,17,17,0.35)" }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden border border-[#ECECEC]"
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              router.push(`/admin/c/${results[active].id}`);
              setOpen(false);
            }
          }}
          placeholder="Find a contact..."
          className="w-full px-5 py-4 text-[15px] focus:outline-none border-b border-[#ECECEC]"
        />
        <ul className="max-h-[420px] overflow-y-auto">
          {results.length === 0 && q.length > 0 ? (
            <li className="px-5 py-6 text-[13px] text-muted text-center">
              No matches.
            </li>
          ) : null}
          {results.map((r, i) => (
            <li key={r.id}>
              <Link
                href={`/admin/c/${r.id}`}
                onClick={() => setOpen(false)}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center justify-between gap-3 px-5 py-2.5 ${
                  i === active ? "bg-[#F5F5F4]" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] truncate">{r.label}</div>
                  <div className="text-[12px] text-muted-fg truncate">
                    {r.sub}
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-fg font-mono">
                  {r.lifecycle}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="px-5 py-2 text-[10px] text-muted-fg font-mono uppercase tracking-[0.15em] border-t border-[#ECECEC] flex justify-between">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}
