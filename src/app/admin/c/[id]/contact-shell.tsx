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
  addGift,
  updateGiftStatus,
  deleteGift,
  addTouchpoint,
  deleteTouchpoint,
  deleteContact,
} from "../../actions";
import {
  CHANNEL_LABEL,
  GIFT_STATUSES,
  LIFECYCLES,
  LIFECYCLE_LABEL,
  TOUCH_CHANNELS,
  type Contact,
  type ContactGift,
  type ContactTouchpoint,
  type Lifecycle,
} from "@/types/db";

/* ─────────────────────────────────────────────────────────────────────
   Context: page-wide state for autosave. Every child reads `contact`
   and calls `patch()` to mutate. Saves are debounced 400ms.
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
}: {
  initial: Contact;
  gifts: ContactGift[];
  touchpoints: ContactTouchpoint[];
}) {
  const [contact, setContact] = useState<Contact>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Pending changes accumulate here; flushed by the debounce timer or
  // by Cmd+S. Using a ref means rapid edits to multiple fields coalesce
  // into a single round-trip.
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

  // Cmd+S forces save and flashes the indicator.
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

  // Flush on blur of the window so a tab switch doesn't lose typing.
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
      <main className="font-sans text-dark mx-auto w-full max-w-[1180px] px-6 pt-6 pb-24">
        <Hero />
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-x-12 gap-y-8">
          <ContextPanel />
          <SnapshotRail />
        </div>
        <Tabs gifts={gifts} touchpoints={touchpoints} />
      </main>
    </ContactCtx.Provider>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Sticky header — appears after hero scrolls
   ───────────────────────────────────────────────────────────────────── */

function SaveIndicator() {
  const { saveState, lastSavedAt } = useContact();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  let text = "All saved";
  if (saveState === "saving") text = "Saving…";
  else if (saveState === "error") text = "Save failed";
  else if (lastSavedAt) {
    const ago = Math.max(1, Math.round((Date.now() - lastSavedAt) / 1000));
    text =
      ago < 60
        ? `Saved · ${ago}s ago`
        : `Saved · ${Math.round(ago / 60)}m ago`;
  }

  return (
    <span
      className={`text-[12px] tabular-nums ${
        saveState === "error" ? "text-error" : "text-muted-fg"
      }`}
      title={
        lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : ""
      }
    >
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
        background: "rgba(255,255,255,0.85)",
        borderBottom: "1px solid #ECECEC",
      }}
    >
      <div className="mx-auto w-full max-w-[1180px] px-6 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin"
            className="text-[12px] text-muted-fg hover:text-dark shrink-0"
          >
            ← All
          </Link>
          <span className="font-medium truncate">
            {contact.display_name || contact.full_name}
          </span>
          <LifecyclePill compact />
        </div>
        <SaveIndicator />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Hero band
   ───────────────────────────────────────────────────────────────────── */

function LifecyclePill({ compact = false }: { compact?: boolean }) {
  const { contact, patch } = useContact();
  const styles: Record<Lifecycle, string> = {
    vip: "bg-dark text-white",
    roster: "bg-primary-light text-primary border border-primary/20",
    audience: "bg-offwhite text-muted-fg border border-border",
    archived: "bg-muted/10 text-muted line-through",
  };
  const size = compact ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1";

  return (
    <select
      value={contact.lifecycle}
      onChange={(e) => patch({ lifecycle: e.target.value as Lifecycle })}
      className={`${styles[contact.lifecycle]} ${size} rounded-[var(--radius-pill)] font-mono uppercase tracking-[0.15em] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#E11D48]/20`}
      style={{ appearance: "none" }}
    >
      {LIFECYCLES.map((lc) => (
        <option key={lc} value={lc} className="bg-white text-dark normal-case">
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

function Hero() {
  const { contact, patch } = useContact();

  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-[36px] leading-tight font-semibold tracking-tight">
            <InlineEdit
              value={contact.display_name || contact.full_name}
              placeholder="Name"
              onCommit={(v) => {
                if (!v) return;
                // Default the typed value into display_name so we don't
                // overwrite legal/shipping name.
                patch({ display_name: v });
              }}
            />
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-fg">
            <LifecyclePill />
            <OwnerChip />
            <span className="flex items-center gap-1.5">
              <span className="font-sans">Priority</span>
              <Meter
                value={contact.priority}
                onChange={(n) => patch({ priority: n === 0 ? null : n })}
              />
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-sans">Warmth</span>
              <Meter
                value={contact.warmth}
                onChange={(n) => patch({ warmth: n === 0 ? null : n })}
              />
            </span>
          </div>
        </div>
        <SocialsRow />
      </div>

      <p className="text-[13px] text-muted-fg flex flex-wrap gap-x-2 gap-y-0.5">
        {[
          contact.base_city,
          contact.timezone,
          contact.community,
          contact.introduced_by ? `intro: ${contact.introduced_by}` : null,
          contact.project,
        ]
          .filter(Boolean)
          .map((piece, i, arr) => (
            <span key={i}>
              {piece}
              {i < arr.length - 1 ? " ·" : ""}
            </span>
          ))}
        {!contact.base_city &&
        !contact.timezone &&
        !contact.community &&
        !contact.introduced_by &&
        !contact.project ? (
          <span className="italic text-muted">
            Add base city, timezone, community, intro source, or project below.
          </span>
        ) : null}
      </p>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Context panel — single block, absorbs notes + tags + the why-fields
   ───────────────────────────────────────────────────────────────────── */

function ContextPanel() {
  const { contact, patch } = useContact();

  return (
    <section className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-fg font-sans">
        Context
      </div>
      <textarea
        defaultValue={contact.notes ?? ""}
        placeholder={`Why VIP. Why roster. Who introduced them. What they care about. Recent conversations. Anything the team should know.`}
        rows={16}
        onBlur={(e) => patch({ notes: e.target.value || null })}
        className="w-full bg-transparent text-[15px] leading-relaxed placeholder:text-muted resize-none focus:outline-none font-sans"
        style={{ minHeight: 280 }}
      />
      <TagEditor />
      <ShippingPreview />
    </section>
  );
}

function TagEditor() {
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
    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#ECECEC]">
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
          } else if (e.key === "Backspace" && draft === "" && contact.tags.length) {
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

/* ─────────────────────────────────────────────────────────────────────
   Snapshot rail (right column)
   ───────────────────────────────────────────────────────────────────── */

function SnapshotRail() {
  return (
    <aside className="space-y-8 lg:border-l lg:border-[#ECECEC] lg:pl-10">
      <RosterTier />
      <Flags />
      <Sizing />
      <ShippingMini />
    </aside>
  );
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-fg font-sans mb-3">
      {children}
    </div>
  );
}

function RosterTier() {
  const { contact, patch } = useContact();
  const tiers = ["A", "B", "C"] as const;
  return (
    <div>
      <RailHeading>Roster tier</RailHeading>
      <div className="inline-flex rounded-md border border-[#ECECEC] overflow-hidden">
        {tiers.map((t) => {
          const active = contact.roster_tier === t;
          return (
            <button
              key={t}
              onClick={() =>
                patch({ roster_tier: active ? null : t })
              }
              className={`px-4 py-1.5 text-[13px] font-medium transition ${
                active
                  ? "bg-dark text-white"
                  : "bg-white text-muted-fg hover:text-dark"
              } ${t !== "A" ? "border-l border-[#ECECEC]" : ""}`}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Flags() {
  const { contact, patch } = useContact();
  const flags: Array<{ key: keyof Contact; label: string; danger?: boolean }> =
    [
      { key: "castable", label: "Castable" },
      { key: "permanent_vip", label: "Permanent VIP" },
      { key: "gifting_eligible", label: "Gifting eligible" },
      { key: "permanent_roster", label: "Permanent roster" },
      { key: "do_not_gift", label: "Do not gift", danger: true },
      { key: "do_not_engage", label: "Do not engage", danger: true },
    ];

  return (
    <div>
      <RailHeading>Flags</RailHeading>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {flags.map((f) => {
          const checked = Boolean(contact[f.key]);
          return (
            <label
              key={f.key}
              className="flex items-center gap-2 text-[13px] cursor-pointer select-none group"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) =>
                  patch({ [f.key]: e.target.checked } as Partial<Contact>)
                }
                className="size-4 accent-dark"
              />
              <span
                className={`${
                  f.danger && checked ? "text-error" : "text-dark"
                }`}
              >
                {f.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Sizing() {
  const { contact } = useContact();
  const items = [
    { label: "Shirt", v: contact.shirt_size },
    { label: "Pants", v: contact.pants_size },
    { label: "Shorts", v: contact.shorts_size },
    { label: "Sweat", v: contact.sweatshirt_size },
    { label: "Shoe", v: contact.shoe_size || "—" },
    { label: "Hat", v: contact.hat_size || "—" },
  ];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-fg font-sans">
          Sizing
        </div>
        <Link
          href="/"
          className="text-[11px] text-muted-fg hover:text-dark"
          title="Edit via the public form"
        >
          ✎
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-muted-fg text-[10px] font-sans">{it.label}</div>
            <div className="font-mono">{it.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShippingMini() {
  const { contact } = useContact();
  const lines = [
    contact.shipping_recipient || contact.full_name,
    [contact.address_line1, contact.address_line2].filter(Boolean).join(", "),
    `${contact.city_region}, ${contact.postal_code}`,
    contact.country,
  ].filter(Boolean);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-fg font-sans">
          Shipping
        </div>
        <VerifiedToggle />
      </div>
      <ShippingEditable lines={lines} />
    </div>
  );
}

function VerifiedToggle() {
  const { contact, patch } = useContact();
  return (
    <button
      onClick={() => patch({ address_verified: !contact.address_verified })}
      className={`text-[11px] inline-flex items-center gap-1 ${
        contact.address_verified ? "text-primary" : "text-muted-fg hover:text-dark"
      }`}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          contact.address_verified ? "bg-primary" : "bg-[#D4D4D4]"
        }`}
      />
      {contact.address_verified ? "verified" : "unverified"}
    </button>
  );
}

function ShippingEditable({ lines }: { lines: string[] }) {
  const { contact, patch } = useContact();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-left text-[13px] font-mono leading-relaxed text-muted-fg hover:text-dark"
      >
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </button>
    );
  }

  return (
    <div className="space-y-2 text-[13px]">
      <ShipInput
        v={contact.shipping_recipient ?? ""}
        ph="Recipient name"
        onCommit={(v) => patch({ shipping_recipient: v || null })}
      />
      <ShipInput
        v={contact.address_line1}
        ph="Street address"
        onCommit={(v) => patch({ address_line1: v })}
      />
      <ShipInput
        v={contact.address_line2 ?? ""}
        ph="Apt / suite"
        onCommit={(v) => patch({ address_line2: v || null })}
      />
      <ShipInput
        v={contact.city_region}
        ph="City, state, region"
        onCommit={(v) => patch({ city_region: v })}
      />
      <div className="grid grid-cols-2 gap-2">
        <ShipInput
          v={contact.postal_code}
          ph="Postal"
          onCommit={(v) => patch({ postal_code: v })}
        />
        <ShipInput
          v={contact.country}
          ph="Country"
          onCommit={(v) => patch({ country: v })}
        />
      </div>
      <button
        onClick={() => setOpen(false)}
        className="text-[11px] text-muted-fg hover:text-dark"
      >
        ↑ Collapse
      </button>
    </div>
  );
}

function ShipInput({
  v,
  ph,
  onCommit,
}: {
  v: string;
  ph: string;
  onCommit: (s: string) => void;
}) {
  return (
    <input
      defaultValue={v}
      placeholder={ph}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next !== v) onCommit(next);
      }}
      className="w-full bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1 placeholder:text-muted font-mono text-[12px]"
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Operational tabs (Gifts / Outreach / Activity)
   ───────────────────────────────────────────────────────────────────── */

type TabKey = "gifts" | "outreach" | "activity";

function Tabs({
  gifts,
  touchpoints,
}: {
  gifts: ContactGift[];
  touchpoints: ContactTouchpoint[];
}) {
  const [tab, setTab] = useState<TabKey>("gifts");

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "gifts", label: "Gifts", count: gifts.length },
    { key: "outreach", label: "Outreach", count: touchpoints.length },
    { key: "activity", label: "Activity", count: gifts.length + touchpoints.length + 1 },
  ];

  return (
    <section className="mt-12 pt-8 border-t border-[#ECECEC]">
      <div className="flex items-center gap-1 border-b border-[#ECECEC] mb-4">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 pb-2 -mb-px border-b-2 text-[13px] transition ${
                active
                  ? "border-dark text-dark"
                  : "border-transparent text-muted-fg hover:text-dark"
              }`}
            >
              {t.label}{" "}
              <span className="text-muted opacity-70">{t.count}</span>
            </button>
          );
        })}
      </div>

      {tab === "gifts" ? <GiftsTab gifts={gifts} /> : null}
      {tab === "outreach" ? <OutreachTab touches={touchpoints} /> : null}
      {tab === "activity" ? (
        <ActivityTab gifts={gifts} touches={touchpoints} />
      ) : null}
    </section>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function GiftsTab({ gifts }: { gifts: ContactGift[] }) {
  const { contact } = useContact();
  const [adding, setAdding] = useState(false);

  return (
    <div>
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="w-full text-left text-[13px] text-muted-fg hover:text-dark py-2 border-b border-[#ECECEC]"
        >
          + Log gift
        </button>
      ) : (
        <form
          action={async (fd) => {
            await addGift(fd);
            setAdding(false);
          }}
          className="grid grid-cols-[1fr_1fr_120px_120px_auto] gap-2 py-3 border-b border-[#ECECEC] text-[13px]"
        >
          <input type="hidden" name="contact_id" value={contact.id} />
          <input
            name="item"
            required
            placeholder="Item"
            className="bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1"
          />
          <input
            name="drop_name"
            placeholder="Drop"
            className="bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1"
          />
          <select
            name="status"
            defaultValue="queued"
            className="bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1"
          >
            {GIFT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            name="tracking"
            placeholder="Tracking"
            className="bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1 font-mono text-[12px]"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="text-[12px] font-medium hover:text-[#E11D48]"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-[12px] text-muted-fg"
            >
              cancel
            </button>
          </div>
        </form>
      )}

      {gifts.length === 0 ? (
        <p className="text-[13px] text-muted py-6 text-center">No gifts yet.</p>
      ) : (
        <ul className="divide-y divide-[#ECECEC]">
          {gifts.map((g) => (
            <li
              key={g.id}
              className="py-3 grid grid-cols-[1fr_120px_120px_auto] items-center gap-3 text-[13px]"
            >
              <div>
                <span className="font-medium">{g.item}</span>
                {g.drop_name ? (
                  <span className="text-muted-fg"> · {g.drop_name}</span>
                ) : null}
                {g.notes ? (
                  <p className="text-[12px] text-muted-fg italic">
                    {g.notes}
                  </p>
                ) : null}
              </div>
              <form action={updateGiftStatus}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="contact_id" value={contact.id} />
                <select
                  name="status"
                  defaultValue={g.status}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className="bg-transparent text-[12px] font-mono uppercase tracking-[0.1em] text-muted-fg hover:text-dark focus:outline-none cursor-pointer"
                >
                  {GIFT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </form>
              <span className="text-[12px] font-mono text-muted-fg">
                {g.sent_at
                  ? fmtDate(g.sent_at)
                  : fmtDate(g.created_at)}
              </span>
              <form action={deleteGift}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="contact_id" value={contact.id} />
                <button
                  type="submit"
                  className="text-[11px] text-muted-fg hover:text-error opacity-0 group-hover:opacity-100"
                >
                  delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OutreachTab({ touches }: { touches: ContactTouchpoint[] }) {
  const { contact } = useContact();
  const [adding, setAdding] = useState(false);

  return (
    <div>
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="w-full text-left text-[13px] text-muted-fg hover:text-dark py-2 border-b border-[#ECECEC]"
        >
          + Log touchpoint
        </button>
      ) : (
        <form
          action={async (fd) => {
            await addTouchpoint(fd);
            setAdding(false);
          }}
          className="space-y-2 py-3 border-b border-[#ECECEC] text-[13px]"
        >
          <input type="hidden" name="contact_id" value={contact.id} />
          <div className="grid grid-cols-[140px_140px_140px_1fr] gap-2">
            <select
              name="channel"
              defaultValue="dm_tg"
              className="bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1"
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
              className="bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1"
            >
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </select>
            <input
              name="follow_up_at"
              type="date"
              className="bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1"
            />
            <input
              name="logged_by"
              placeholder="logged by"
              className="bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1"
            />
          </div>
          <textarea
            name="summary"
            required
            placeholder="What was said / what's the ask"
            rows={2}
            className="w-full bg-transparent border-b border-[#ECECEC] focus:border-[#E11D48] focus:outline-none py-1 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="text-[12px] font-medium hover:text-[#E11D48]"
            >
              Log
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-[12px] text-muted-fg"
            >
              cancel
            </button>
          </div>
        </form>
      )}

      {touches.length === 0 ? (
        <p className="text-[13px] text-muted py-6 text-center">
          No outreach logged yet.
        </p>
      ) : (
        <ul className="divide-y divide-[#ECECEC]">
          {touches.map((t) => (
            <li
              key={t.id}
              className="py-3 grid grid-cols-[140px_1fr_auto] items-start gap-3 text-[13px]"
            >
              <div className="text-[12px] text-muted-fg">
                <div className="font-mono">{fmtDate(t.occurred_at)}</div>
                <div className="text-[11px]">
                  {CHANNEL_LABEL[t.channel]} ·{" "}
                  {t.direction === "outbound" ? "out" : "in"}
                </div>
                {t.follow_up_at ? (
                  <div className="text-[11px] text-primary mt-0.5">
                    f/u {fmtDate(t.follow_up_at)}
                  </div>
                ) : null}
              </div>
              <div>
                <p className="whitespace-pre-line">{t.summary}</p>
                {t.logged_by ? (
                  <p className="text-[11px] text-muted mt-0.5">
                    by {t.logged_by}
                  </p>
                ) : null}
              </div>
              <form action={deleteTouchpoint}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="contact_id" value={contact.id} />
                <button
                  type="submit"
                  className="text-[11px] text-muted-fg hover:text-error"
                >
                  delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityTab({
  gifts,
  touches,
}: {
  gifts: ContactGift[];
  touches: ContactTouchpoint[];
}) {
  const { contact } = useContact();
  const events = [
    ...gifts.map((g) => ({
      kind: "gift" as const,
      at: g.sent_at ?? g.created_at,
      gift: g,
    })),
    ...touches.map((t) => ({
      kind: "touch" as const,
      at: t.occurred_at,
      touch: t,
    })),
    { kind: "added" as const, at: contact.created_at },
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <ol className="space-y-1.5">
      {events.map((ev, i) => (
        <li
          key={i}
          className="grid grid-cols-[100px_1fr] gap-3 text-[13px]"
        >
          <span className="font-mono text-[12px] text-muted">
            {fmtDate(ev.at)}
          </span>
          {ev.kind === "gift" ? (
            <span>
              <span className="text-[11px] uppercase tracking-[0.15em] text-muted-fg mr-2">
                gift · {ev.gift.status}
              </span>
              {ev.gift.item}
              {ev.gift.drop_name ? ` · ${ev.gift.drop_name}` : ""}
            </span>
          ) : ev.kind === "touch" ? (
            <span>
              <span className="text-[11px] uppercase tracking-[0.15em] text-muted-fg mr-2">
                {CHANNEL_LABEL[ev.touch.channel]} ·{" "}
                {ev.touch.direction === "outbound" ? "out" : "in"}
              </span>
              {ev.touch.summary.slice(0, 120)}
              {ev.touch.summary.length > 120 ? "…" : ""}
            </span>
          ) : (
            <span>
              <span className="text-[11px] uppercase tracking-[0.15em] text-muted-fg mr-2">
                added · {contact.source}
              </span>
              Contact created
            </span>
          )}
        </li>
      ))}
    </ol>
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

/* ─────────────────────────────────────────────────────────────────────
   Shipping preview lives at the bottom of Context, also offered in
   the snapshot rail. Helper that doesn't appear elsewhere.
   ───────────────────────────────────────────────────────────────────── */

function ShippingPreview() {
  // Kept as a placeholder so the Context column scroll length matches
  // the rail. The rail already shows shipping; we don't repeat here.
  return null;
}

/* ─────────────────────────────────────────────────────────────────────
   Helper exports
   ───────────────────────────────────────────────────────────────────── */

export function ContactPageDeleteForm({ id }: { id: string }) {
  return (
    <form action={deleteContact}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-[11px] text-muted-fg hover:text-error"
      >
        Delete contact
      </button>
    </form>
  );
}
