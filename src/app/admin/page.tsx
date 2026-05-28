import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type {
  Contact,
  ContactGift,
  GiftStatus,
  InviteToken,
  Lifecycle,
} from "@/types/db";
import { LIFECYCLES, LIFECYCLE_LABEL, GIFT_STATUSES } from "@/types/db";
import { mintInvite, revokeInvite, updateGiftStatus } from "./actions";
import { CopyLink } from "./copy-link";
import { AdminNav } from "@/components/admin/nav";
import { MarkPosted } from "./mark-posted";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  lifecycle?: string;
  tag?: string;
  owner?: string;
  attention?: string; // ship-today | followup | blocked | posted
};

/* ─────────────────────────────────────────────────────────────────────
   Derived types — joined gift rows for the pipeline board
   ───────────────────────────────────────────────────────────────────── */

type PipelineGift = ContactGift & {
  contact_name: string;
  contact_address_line1: string | null;
  contact_lifecycle: Lifecycle;
  product_name: string | null;
  product_image: string | null;
  drop_name: string | null;
};

type ContactStat = {
  contact_id: string;
  last_gift_at: string | null;
  last_touch_at: string | null;
  last_note_at: string | null;
  has_ever_posted: boolean;
};

/* ─────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const SEVEN_DAYS = 7 * DAY;
const TEN_DAYS = 10 * DAY;
const THIRTY_DAYS = 30 * DAY;
const SIXTY_DAYS = 60 * DAY;

async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "spenders.vip";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

function daysAgo(iso: string | null | undefined, ref: number = Date.now()): number | null {
  if (!iso) return null;
  return Math.floor((ref - new Date(iso).getTime()) / DAY);
}

function fmtAge(iso: string | null | undefined): string {
  const d = daysAgo(iso);
  if (d == null) return "—";
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

function stageStartedAt(g: ContactGift): string {
  switch (g.status) {
    case "queued":
      return g.created_at;
    case "packed":
      return g.packed_at ?? g.created_at;
    case "shipped":
      return g.sent_at ?? g.updated_at;
    case "delivered":
      return g.delivered_at ?? g.updated_at;
    case "posted":
      return g.posted_at ?? g.updated_at;
    case "returned":
      return g.returned_at ?? g.updated_at;
  }
}

function daysInStage(g: ContactGift): number {
  return Math.max(0, daysAgo(stageStartedAt(g)) ?? 0);
}

/** Color edge per the aging-traffic-light rules in the brief.
 *  on-track → no edge; aging → red-30%; stuck → red-100%. */
function ageEdge(g: ContactGift): "ok" | "aging" | "stuck" {
  const d = daysInStage(g);
  if (g.status === "queued") {
    if (d > 7) return "stuck";
    if (d > 3) return "aging";
  }
  if (g.status === "packed") {
    if (d > 4) return "stuck";
    if (d > 2) return "aging";
  }
  if (g.status === "shipped") {
    if (d > 10) return "stuck";
    if (d > 5) return "aging";
  }
  if (g.status === "delivered") {
    if (g.posted_at) return "ok";
    if (d > 7) return "stuck";
    if (d > 3) return "aging";
  }
  return "ok";
}

const PIPELINE_COLUMNS: Array<{
  key: "queued" | "packed" | "shipped" | "delivered" | "posted";
  label: string;
  isWin?: boolean;
}> = [
  { key: "queued", label: "queued" },
  { key: "packed", label: "packed" },
  { key: "shipped", label: "in transit" },
  { key: "delivered", label: "delivered" },
  { key: "posted", label: "posted", isWin: true },
];

/* ─────────────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────────────── */

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  if (!(await isAdminAuthed())) redirect("/admin/login");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const lifecycleFilter = LIFECYCLES.includes(sp.lifecycle as Lifecycle)
    ? (sp.lifecycle as Lifecycle)
    : null;
  const tagFilter = (sp.tag ?? "").trim().toLowerCase();
  const ownerFilter = (sp.owner ?? "").trim();

  const supabase = createServiceRoleClient();
  const now = Date.now();
  const sevenDaysAgoIso = new Date(now - SEVEN_DAYS).toISOString();

  // ─── Pipeline gifts ──────────────────────────────────────────────────
  // Split into two queries because PostgREST's .or() with nested and(...)
  // doesn't play well with colons in the ISO timestamp.
  const inFlightQuery = supabase
    .from("contact_gifts")
    .select(
      "*, contacts(id, full_name, display_name, address_line1, lifecycle), products(name, image_url, drops(name))"
    )
    .in("status", ["queued", "packed", "shipped", "delivered"])
    .order("created_at", { ascending: true })
    .limit(500);

  const postedRecentQuery = supabase
    .from("contact_gifts")
    .select(
      "*, contacts(id, full_name, display_name, address_line1, lifecycle), products(name, image_url, drops(name))"
    )
    .eq("status", "posted")
    .gte("posted_at", sevenDaysAgoIso)
    .order("posted_at", { ascending: false })
    .limit(200);

  // ─── Counts ──────────────────────────────────────────────────────────
  const stageCountsQuery = supabase
    .from("contact_gifts")
    .select("status, posted_at, delivered_at, created_at, packed_at, sent_at");

  // ─── Contacts (for blocked + recently activated + cold + main list) ─
  const contactsQuery = supabase
    .from("contacts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (lifecycleFilter) contactsQuery.eq("lifecycle", lifecycleFilter);
  if (ownerFilter) contactsQuery.eq("owner", ownerFilter);
  if (tagFilter) contactsQuery.contains("tags", [tagFilter]);
  if (q) {
    const like = `%${q}%`;
    contactsQuery.or(
      [
        `full_name.ilike.${like}`,
        `display_name.ilike.${like}`,
        `email.ilike.${like}`,
        `project.ilike.${like}`,
        `x_handle.ilike.${like}`,
        `telegram_handle.ilike.${like}`,
        `instagram_handle.ilike.${like}`,
      ].join(",")
    );
  }

  // Lightweight rows for last-touch aggregation across all contacts.
  const giftTouchesQuery = supabase
    .from("contact_gifts")
    .select("contact_id, created_at, posted_at");
  const touchesQuery = supabase
    .from("contact_touchpoints")
    .select("contact_id, occurred_at");
  const notesQuery = supabase
    .from("contact_notes")
    .select("contact_id, created_at");

  const tokensQuery = supabase
    .from("gifting_invite_tokens")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  const allMetaQuery = supabase.from("contacts").select("owner, tags");

  const [
    inFlightRes,
    postedRecentRes,
    stageCountsRes,
    contactsRes,
    giftTouchesRes,
    touchesRes,
    notesRes,
    tokensRes,
    metaRes,
  ] = await Promise.all([
    inFlightQuery,
    postedRecentQuery,
    stageCountsQuery,
    contactsQuery,
    giftTouchesQuery,
    touchesQuery,
    notesQuery,
    tokensQuery,
    allMetaQuery,
  ]);

  type RawPipelineRow = ContactGift & {
    contacts: {
      id: string;
      full_name: string;
      display_name: string | null;
      address_line1: string | null;
      lifecycle: Lifecycle;
    } | null;
    products: {
      name: string;
      image_url: string | null;
      drops: { name: string } | null;
    } | null;
  };

  const pipelineGifts: PipelineGift[] = [
    ...((inFlightRes.data ?? []) as RawPipelineRow[]),
    ...((postedRecentRes.data ?? []) as RawPipelineRow[]),
  ].map((g) => ({
    ...g,
    contact_name:
      g.contacts?.display_name ?? g.contacts?.full_name ?? "—",
    contact_address_line1: g.contacts?.address_line1 ?? null,
    contact_lifecycle: g.contacts?.lifecycle ?? "audience",
    product_name: g.products?.name ?? null,
    product_image: g.products?.image_url ?? null,
    drop_name: g.products?.drops?.name ?? g.drop_name ?? null,
  }));

  const contacts = (contactsRes.data ?? []) as Contact[];
  const tokens = (tokensRes.data ?? []) as InviteToken[];
  const origin = await getOrigin();

  // ─── Per-contact stats ───────────────────────────────────────────────
  const statsMap = new Map<string, ContactStat>();
  function ensure(id: string): ContactStat {
    let s = statsMap.get(id);
    if (!s) {
      s = {
        contact_id: id,
        last_gift_at: null,
        last_touch_at: null,
        last_note_at: null,
        has_ever_posted: false,
      };
      statsMap.set(id, s);
    }
    return s;
  }

  for (const g of (giftTouchesRes.data ?? []) as Array<{
    contact_id: string;
    created_at: string;
    posted_at: string | null;
  }>) {
    const s = ensure(g.contact_id);
    if (!s.last_gift_at || g.created_at > s.last_gift_at) {
      s.last_gift_at = g.created_at;
    }
    if (g.posted_at) s.has_ever_posted = true;
  }
  for (const t of (touchesRes.data ?? []) as Array<{
    contact_id: string;
    occurred_at: string;
  }>) {
    const s = ensure(t.contact_id);
    if (!s.last_touch_at || t.occurred_at > s.last_touch_at) {
      s.last_touch_at = t.occurred_at;
    }
  }
  for (const n of (notesRes.data ?? []) as Array<{
    contact_id: string;
    created_at: string;
  }>) {
    const s = ensure(n.contact_id);
    if (!s.last_note_at || n.created_at > s.last_note_at) {
      s.last_note_at = n.created_at;
    }
  }

  function lastTouchOf(c: Contact): string | null {
    const s = statsMap.get(c.id);
    if (!s) return null;
    const candidates = [s.last_gift_at, s.last_touch_at, s.last_note_at]
      .filter((x): x is string => !!x)
      .sort()
      .reverse();
    return candidates[0] ?? null;
  }

  // ─── KPI counts ──────────────────────────────────────────────────────
  type RawCount = {
    status: GiftStatus;
    posted_at: string | null;
    delivered_at: string | null;
    created_at: string;
    packed_at: string | null;
    sent_at: string | null;
  };
  const allGiftRows = (stageCountsRes.data ?? []) as RawCount[];

  // SHIP TODAY = queued + packed (the ship queue, until we add scheduled dates)
  const shipTodayCount = allGiftRows.filter(
    (r) => r.status === "queued" || r.status === "packed"
  ).length;

  // AWAITING FOLLOW-UP = delivered ≥7d ago, no post on this same gift
  const awaitingFollowupCount = allGiftRows.filter(
    (r) =>
      r.status === "delivered" &&
      r.delivered_at &&
      now - new Date(r.delivered_at).getTime() >= SEVEN_DAYS
  ).length;

  // POSTED THIS WEEK = posted_at within last 7d
  const postedThisWeekCount = allGiftRows.filter(
    (r) =>
      r.status === "posted" &&
      r.posted_at &&
      now - new Date(r.posted_at).getTime() <= SEVEN_DAYS
  ).length;

  // BLOCKED = gifting eligible AND no shippable address
  const blockedContacts = contacts.filter(
    (c) =>
      c.gifting_eligible &&
      !c.do_not_gift &&
      (!c.address_line1 || c.address_line1.trim().length === 0)
  );
  const blockedCount = blockedContacts.length;

  // Stage counts for pipeline column headers
  const stageCounts: Record<string, number> = {
    queued: 0,
    packed: 0,
    shipped: 0,
    delivered: 0,
    posted: 0,
  };
  for (const r of allGiftRows) {
    if (r.status === "queued") stageCounts.queued += 1;
    else if (r.status === "packed") stageCounts.packed += 1;
    else if (r.status === "shipped") stageCounts.shipped += 1;
    else if (r.status === "delivered") stageCounts.delivered += 1;
    else if (
      r.status === "posted" &&
      r.posted_at &&
      now - new Date(r.posted_at).getTime() <= SEVEN_DAYS
    )
      stageCounts.posted += 1;
  }

  // ─── Attention rail data ─────────────────────────────────────────────
  const shipNextGifts = pipelineGifts
    .filter((g) => g.status === "queued" || g.status === "packed")
    .sort(
      (a, b) =>
        new Date(stageStartedAt(a)).getTime() -
        new Date(stageStartedAt(b)).getTime()
    )
    .slice(0, 10);

  const followUpGifts = pipelineGifts
    .filter(
      (g) =>
        g.status === "delivered" &&
        g.delivered_at &&
        now - new Date(g.delivered_at).getTime() >= SEVEN_DAYS &&
        !g.posted_at
    )
    .sort(
      (a, b) =>
        new Date(a.delivered_at!).getTime() -
        new Date(b.delivered_at!).getTime()
    )
    .slice(0, 10);

  // ─── Activation panels ───────────────────────────────────────────────
  const recentlyActivated = contacts
    .filter((c) => {
      const age = now - new Date(c.created_at).getTime();
      if (age > THIRTY_DAYS) return false;
      const s = statsMap.get(c.id);
      return !s || !s.last_gift_at;
    })
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 8);

  const goingCold = contacts
    .filter((c) => {
      if (c.lifecycle !== "vip") return false;
      if (c.do_not_engage) return false;
      const lastTouch = lastTouchOf(c);
      if (!lastTouch) return true; // never touched VIP is cold by definition
      return now - new Date(lastTouch).getTime() >= SIXTY_DAYS;
    })
    .sort((a, b) => {
      const la = lastTouchOf(a) ?? a.created_at;
      const lb = lastTouchOf(b) ?? b.created_at;
      return new Date(la).getTime() - new Date(lb).getTime();
    })
    .slice(0, 8);

  // ─── Filter chips / contact-list nav helpers ─────────────────────────
  const allRows = (metaRes.data ?? []) as Array<{
    owner: string | null;
    tags: string[] | null;
  }>;
  const owners = Array.from(
    new Set(allRows.map((r) => r.owner).filter((o): o is string => !!o))
  ).sort();
  const tagSet = new Set<string>();
  for (const r of allRows) for (const t of r.tags ?? []) tagSet.add(t);
  const allTags = Array.from(tagSet).sort();

  const totals: Record<Lifecycle | "all", number> = {
    all: contacts.length,
    audience: 0,
    roster: 0,
    vip: 0,
    archived: 0,
  };
  for (const c of contacts) totals[c.lifecycle] += 1;

  function urlWith(over: Partial<Search>): string {
    const next = new URLSearchParams();
    const merged: Search = {
      q,
      lifecycle: lifecycleFilter ?? undefined,
      tag: tagFilter || undefined,
      owner: ownerFilter || undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) next.set(k, String(v));
    }
    const qs = next.toString();
    return qs ? `/admin?${qs}` : "/admin";
  }

  return (
    <main className="dsc-bone relative flex-1 px-12 py-8 max-w-[1280px] w-full mx-auto space-y-8">
      <AdminNav active="pipeline" />

      {/* ─── KPI strip ─── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="ship today" count={shipTodayCount} />
        <Kpi label="awaiting follow-up" count={awaitingFollowupCount} />
        <Kpi label="blocked" count={blockedCount} />
        <Kpi label="posted this week" count={postedThisWeekCount} red />
      </section>

      {/* ─── Pipeline board ─── */}
      <section>
        <div
          className="grid grid-cols-2 md:grid-cols-5 overflow-hidden"
          style={{
            border: "1px solid rgba(14,14,14,0.12)",
            background: "var(--color-bone-surface)",
            borderRadius: 8,
          }}
        >
          {PIPELINE_COLUMNS.map((col) => {
            const colGifts = pipelineGifts.filter((g) => g.status === col.key);
            colGifts.sort((a, b) => {
              const ka = col.key === "posted" ? -1 : 1;
              return (
                ka *
                (new Date(stageStartedAt(a)).getTime() -
                  new Date(stageStartedAt(b)).getTime())
              );
            });
            return (
              <PipelineColumn
                key={col.key}
                label={col.label}
                count={stageCounts[col.key] ?? 0}
                gifts={colGifts}
                isWin={!!col.isWin}
              />
            );
          })}
        </div>
      </section>

      {/* ─── Attention rail ─── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AttentionPanel
          title="ship next"
          empty="// nothing queued."
          items={shipNextGifts.map((g) => ({
            id: g.id,
            line1: g.contact_name,
            line2: [g.product_name, g.size, g.drop_name]
              .filter(Boolean)
              .join(" · "),
            line3: g.contact_address_line1
              ? truncate(g.contact_address_line1, 36)
              : "// no address",
            contact_id: g.contact_id,
            badge: `${daysInStage(g)}d`,
            edge: ageEdge(g),
          }))}
        />
        <AttentionPanel
          title="follow up"
          empty="// no posts overdue."
          items={followUpGifts.map((g) => ({
            id: g.id,
            line1: g.contact_name,
            line2: [g.product_name, g.size].filter(Boolean).join(" · "),
            line3: `delivered ${daysAgo(g.delivered_at)}d ago · no post`,
            contact_id: g.contact_id,
            badge: `${daysAgo(g.delivered_at)}d`,
            edge: "stuck" as const,
          }))}
        />
        <AttentionPanel
          title="blocked"
          empty="// nothing blocked."
          items={blockedContacts.slice(0, 10).map((c) => ({
            id: c.id,
            line1: c.display_name || c.full_name,
            line2: "missing shipping address",
            line3: c.lifecycle,
            contact_id: c.id,
            badge: "fix",
            edge: "aging" as const,
          }))}
        />
      </section>

      {/* ─── Activation health ─── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ActivationPanel
          title="recently activated"
          subtitle="last 30 days · no gift yet"
          empty="// no warm leads waiting."
          items={recentlyActivated.map((c) => ({
            id: c.id,
            line1: c.display_name || c.full_name,
            line2: c.project ?? c.lifecycle,
            badge: fmtAge(c.created_at),
          }))}
        />
        <ActivationPanel
          title="going cold"
          subtitle="VIP · no touch in 60+ days"
          empty="// all VIPs warm."
          items={goingCold.map((c) => {
            const last = lastTouchOf(c);
            return {
              id: c.id,
              line1: c.display_name || c.full_name,
              line2: c.owner ? `owner: ${c.owner}` : "no owner",
              badge: last ? `${daysAgo(last)}d` : "never",
            };
          })}
        />
      </section>

      {/* ─── Demoted contact list ─── */}
      <section className="space-y-4">
        <div
          className="flex items-baseline justify-between pb-1"
          style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
        >
          <h2
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: "var(--color-dsc-red)" }}
          >
            contacts
          </h2>
          <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
            [{totals.all}]
          </span>
        </div>

        {/* Lifecycle chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipLink
            href={urlWith({ lifecycle: undefined })}
            active={!lifecycleFilter}
          >
            all <span className="opacity-70 ml-1">[{totals.all}]</span>
          </ChipLink>
          {LIFECYCLES.map((lc) => (
            <ChipLink
              key={lc}
              href={urlWith({ lifecycle: lc })}
              active={lifecycleFilter === lc}
            >
              {LIFECYCLE_LABEL[lc].toLowerCase()}{" "}
              <span className="opacity-70 ml-1">[{totals[lc]}]</span>
            </ChipLink>
          ))}
        </div>

        {/* Search + filters */}
        <form
          action="/admin"
          method="get"
          className="flex flex-wrap items-end gap-4"
        >
          {lifecycleFilter ? (
            <input type="hidden" name="lifecycle" value={lifecycleFilter} />
          ) : null}
          <div className="flex-1 min-w-[220px]">
            <FieldLabel>search</FieldLabel>
            <input
              name="q"
              defaultValue={q}
              placeholder="name, email, project, handle"
              className="w-full px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent"
              style={{ borderBottom: "1px solid rgba(14,14,14,0.2)" }}
            />
          </div>
          <div className="w-[160px]">
            <FieldLabel>owner</FieldLabel>
            <select
              name="owner"
              defaultValue={ownerFilter}
              className="w-full px-1 py-1.5 text-[13px] focus:outline-none cursor-pointer bg-transparent"
              style={{
                borderBottom: "1px solid rgba(14,14,14,0.2)",
                appearance: "none",
              }}
            >
              <option value="">any</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="w-[160px]">
            <FieldLabel>tag</FieldLabel>
            <select
              name="tag"
              defaultValue={tagFilter}
              className="w-full px-1 py-1.5 text-[13px] focus:outline-none cursor-pointer bg-transparent"
              style={{
                borderBottom: "1px solid rgba(14,14,14,0.2)",
                appearance: "none",
              }}
            >
              <option value="">any</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5"
            style={{
              border: "1px solid var(--color-dsc-red)",
              background: "transparent",
              color: "var(--color-dsc-red)",
              borderRadius: 6,
            }}
          >
            filter
          </button>
        </form>

        {/* Contacts table — demoted */}
        <div
          className="overflow-hidden"
          style={{
            background: "var(--color-bone-surface)",
            border: "1px solid rgba(14,14,14,0.12)",
            borderRadius: 8,
          }}
        >
          {contacts.length === 0 ? (
            <p
              className="px-4 py-12 font-mono text-[11px] uppercase tracking-[0.18em]"
              style={{ color: "var(--color-dsc-red)" }}
            >
              // no contacts match these filters.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left font-mono text-[10px] uppercase tracking-[0.18em]"
                  style={{
                    color: "var(--color-dsc-red)",
                    borderBottom: "1px solid var(--color-dsc-red)",
                  }}
                >
                  <th className="px-3 py-2 font-normal">name</th>
                  <th className="px-2 py-2 font-normal">project</th>
                  <th className="px-2 py-2 font-normal">stage</th>
                  <th className="px-2 py-2 font-normal">owner</th>
                  <th className="px-2 py-2 font-normal">activated</th>
                  <th className="px-2 py-2 font-normal">last touch</th>
                  <th className="px-2 py-2 font-normal w-[60px]">posted?</th>
                  <th className="px-3 py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => {
                  const last = lastTouchOf(c);
                  const lastDays = daysAgo(last);
                  const cold = lastDays != null && lastDays >= 60;
                  const stat = statsMap.get(c.id);
                  const everPosted = stat?.has_ever_posted ?? false;
                  const everGifted = !!stat?.last_gift_at;
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-[var(--color-bone-deep)] transition"
                      style={{
                        borderBottom: "1px solid rgba(14,14,14,0.08)",
                      }}
                    >
                      <td className="px-3 py-2.5 align-top">
                        <Link
                          href={`/admin/c/${c.id}`}
                          className="font-medium hover:text-[var(--color-dsc-red)]"
                          style={{ fontFamily: "var(--font-display)" }}
                        >
                          {c.display_name || c.full_name}
                        </Link>
                        <div className="text-[11px] text-[var(--color-muted)] font-mono">
                          {[
                            c.x_handle ? `X ${c.x_handle}` : null,
                            c.telegram_handle ? `TG ${c.telegram_handle}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || c.email}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 align-top text-[13px]">
                        {c.project ?? (
                          <span className="text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <LifecyclePill lifecycle={c.lifecycle} />
                      </td>
                      <td className="px-2 py-2.5 align-top text-[13px]">
                        {c.owner ?? (
                          <span className="text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 align-top font-mono text-[11px] text-[var(--color-muted)]">
                        {fmtAge(c.created_at)}
                      </td>
                      <td
                        className="px-2 py-2.5 align-top font-mono text-[11px]"
                        style={{
                          color: cold
                            ? "var(--color-dsc-red)"
                            : "var(--color-muted)",
                        }}
                      >
                        {last ? fmtAge(last) : "never"}
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <PostedDot
                          posted={everPosted}
                          gifted={everGifted}
                        />
                      </td>
                      <td className="px-3 py-2.5 align-top text-right">
                        <Link
                          href={`/admin/c/${c.id}`}
                          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-dsc-red)]"
                        >
                          open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ─── Invite links ─── */}
      <section
        className="space-y-3 pt-4"
        style={{ borderTop: "1px solid rgba(14,14,14,0.12)" }}
      >
        <div
          className="flex items-baseline justify-between pb-1"
          style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
        >
          <h2
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: "var(--color-dsc-red)" }}
          >
            invite links
          </h2>
          <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
            [{tokens.filter((t) => !t.revoked_at).length} active]
          </span>
        </div>

        <form
          action={mintInvite}
          className="flex flex-wrap gap-3 items-end p-3"
          style={{
            border: "1px solid var(--color-dsc-red)",
            background: "var(--color-dsc-red-mist)",
            borderRadius: 8,
          }}
        >
          <input
            name="label"
            placeholder="label (e.g. anthony @ consensus)"
            className="flex-1 min-w-[180px] px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent"
            style={{ borderBottom: "1px solid rgba(14,14,14,0.2)" }}
          />
          <input
            name="created_by"
            placeholder="by"
            className="w-[120px] px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent"
            style={{ borderBottom: "1px solid rgba(14,14,14,0.2)" }}
          />
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5"
            style={{
              border: "1px solid var(--color-dsc-red)",
              background: "transparent",
              color: "var(--color-dsc-red)",
              borderRadius: 6,
            }}
          >
            mint
          </button>
        </form>

        {tokens.length > 0 ? (
          <ul>
            {tokens.map((t) => {
              const url = `${origin}/s/${t.token}`;
              const revoked = !!t.revoked_at;
              return (
                <li
                  key={t.token}
                  className="py-2.5 flex flex-wrap items-center gap-3"
                  style={{ borderBottom: "1px solid rgba(14,14,14,0.08)" }}
                >
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-[13px]">
                      {t.label ?? (
                        <span className="text-[var(--color-muted)] italic">
                          unlabeled
                        </span>
                      )}
                      {revoked ? (
                        <span
                          className="ml-2 text-[10px] font-mono uppercase tracking-[0.18em]"
                          style={{ color: "var(--color-dsc-red)" }}
                        >
                          revoked
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted-deep)] font-mono break-all">
                      {url}
                    </p>
                    <p className="text-[10px] font-mono text-[var(--color-muted)]">
                      {t.use_count} signups
                      {t.created_by ? ` · by ${t.created_by}` : ""}
                    </p>
                  </div>
                  <CopyLink url={url} disabled={revoked} />
                  {!revoked ? (
                    <form action={revokeInvite}>
                      <input type="hidden" name="token" value={t.token} />
                      <button
                        type="submit"
                        className="font-mono text-[10px] uppercase tracking-[0.18em] hover:underline"
                        style={{ color: "var(--color-dsc-red)" }}
                      >
                        revoke
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Components
   ───────────────────────────────────────────────────────────────────── */

function Kpi({
  label,
  count,
  red = false,
}: {
  label: string;
  count: number;
  red?: boolean;
}) {
  return (
    <div
      className="px-4 py-3"
      style={{
        background: red
          ? "var(--color-dsc-red)"
          : "var(--color-bone-surface)",
        border: red
          ? "1px solid var(--color-dsc-red)"
          : "1px solid rgba(14,14,14,0.12)",
        color: red ? "var(--color-bone)" : "var(--color-ink)",
        borderRadius: 8,
      }}
    >
      <div
        className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-80"
        style={{ color: red ? "var(--color-bone)" : "var(--color-dsc-red)" }}
      >
        {label}
      </div>
      <div
        className="text-[34px] leading-none font-bold tabular-nums mt-1"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {count}
      </div>
    </div>
  );
}

function PipelineColumn({
  label,
  count,
  gifts,
  isWin,
}: {
  label: string;
  count: number;
  gifts: PipelineGift[];
  isWin: boolean;
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        background: isWin ? "var(--color-dsc-red-mist)" : "transparent",
        borderRight: "1px solid rgba(14,14,14,0.08)",
      }}
    >
      <div
        className="px-3 py-2 flex items-baseline justify-between"
        style={{
          borderBottom: "1px solid var(--color-dsc-red)",
        }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: "var(--color-dsc-red)" }}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
          [{count}]
        </span>
      </div>
      <div
        className="p-2 space-y-2 overflow-y-auto"
        style={{ maxHeight: 480, minHeight: 220 }}
      >
        {gifts.length === 0 ? (
          <p
            className="px-1 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]"
          >
            // empty
          </p>
        ) : (
          gifts.map((g) => <PipelineCard key={g.id} gift={g} />)
        )}
      </div>
    </div>
  );
}

function PipelineCard({ gift }: { gift: PipelineGift }) {
  const days = daysInStage(gift);
  const edge = ageEdge(gift);
  const edgeStyle: React.CSSProperties =
    edge === "stuck"
      ? { borderLeft: "2px solid var(--color-dsc-red)" }
      : edge === "aging"
        ? { borderLeft: "2px solid var(--color-dsc-red-soft)" }
        : {};

  const isPosted = gift.status === "posted";

  return (
    <div
      className="px-2.5 py-2 text-[12px]"
      style={{
        background: isPosted
          ? "var(--color-dsc-red)"
          : "var(--color-bone-surface)",
        color: isPosted ? "var(--color-bone)" : "var(--color-ink)",
        border: "1px solid rgba(14,14,14,0.12)",
        borderRadius: 6,
        ...edgeStyle,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/admin/c/${gift.contact_id}`}
          className="font-mono font-semibold leading-tight hover:underline truncate"
          style={{ color: isPosted ? "var(--color-bone)" : "var(--color-ink)" }}
        >
          {gift.contact_name}
        </Link>
        <span
          className="font-mono text-[10px] tabular-nums shrink-0"
          style={{
            color: isPosted
              ? "var(--color-bone)"
              : edge === "stuck"
                ? "var(--color-dsc-red)"
                : "var(--color-muted)",
          }}
        >
          {days}d
        </span>
      </div>
      <div
        className="font-mono text-[10px] mt-1 truncate"
        style={{
          color: isPosted
            ? "rgba(250,247,242,0.85)"
            : "var(--color-muted-deep)",
        }}
      >
        {[gift.product_name ?? gift.item, gift.size, gift.drop_name]
          .filter(Boolean)
          .join(" · ") || "—"}
      </div>
      {/* Inline status change + mark-posted */}
      <div className="mt-2 flex items-center gap-1.5">
        {!isPosted ? (
          <>
            <form
              action={updateGiftStatus}
              className="flex-1"
            >
              <input type="hidden" name="id" value={gift.id} />
              <input type="hidden" name="contact_id" value={gift.contact_id} />
              <select
                name="status"
                defaultValue={gift.status}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="w-full font-mono text-[10px] uppercase tracking-[0.15em] px-1 py-0.5 bg-transparent cursor-pointer focus:outline-none"
                style={{
                  border: "1px solid rgba(14,14,14,0.2)",
                  borderRadius: 6,
                  color: "var(--color-ink)",
                  appearance: "none",
                }}
              >
                {GIFT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </form>
            {gift.status === "delivered" || gift.status === "shipped" ? (
              <div className="flex-1">
                <MarkPosted giftId={gift.id} />
              </div>
            ) : null}
          </>
        ) : (
          <a
            href={gift.posted_url ?? "#"}
            target={gift.posted_url ? "_blank" : undefined}
            rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.18em] truncate"
            style={{
              color: "var(--color-bone)",
              opacity: 0.85,
            }}
          >
            {gift.posted_url ? "view post ↗" : "no link"}
          </a>
        )}
      </div>
    </div>
  );
}

type AttentionItem = {
  id: string;
  contact_id: string;
  line1: string;
  line2: string;
  line3: string;
  badge: string;
  edge: "ok" | "aging" | "stuck";
};

function AttentionPanel({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: AttentionItem[];
}) {
  return (
    <div className="space-y-2">
      <div
        className="flex items-baseline justify-between pb-1"
        style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
      >
        <h3
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: "var(--color-dsc-red)" }}
        >
          {title}
        </h3>
        <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
          [{items.length}]
        </span>
      </div>
      {items.length === 0 ? (
        <p
          className="py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: "var(--color-muted-deep)" }}
        >
          {empty}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => {
            const edgeStyle: React.CSSProperties =
              it.edge === "stuck"
                ? { borderLeft: "2px solid var(--color-dsc-red)" }
                : it.edge === "aging"
                  ? { borderLeft: "2px solid var(--color-dsc-red-soft)" }
                  : {};
            return (
              <li
                key={it.id}
                className="px-2.5 py-2 text-[12px]"
                style={{
                  background: "var(--color-bone-surface)",
                  border: "1px solid rgba(14,14,14,0.08)",
                  borderRadius: 6,
                  ...edgeStyle,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/admin/c/${it.contact_id}`}
                    className="font-mono font-semibold leading-tight hover:underline truncate"
                  >
                    {it.line1}
                  </Link>
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.15em] shrink-0"
                    style={{ color: "var(--color-dsc-red)" }}
                  >
                    {it.badge}
                  </span>
                </div>
                <div className="font-mono text-[10px] mt-1 truncate text-[var(--color-muted-deep)]">
                  {it.line2}
                </div>
                <div className="font-mono text-[10px] truncate text-[var(--color-muted)]">
                  {it.line3}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ActivationPanel({
  title,
  subtitle,
  empty,
  items,
}: {
  title: string;
  subtitle: string;
  empty: string;
  items: Array<{
    id: string;
    line1: string;
    line2: string;
    badge: string;
  }>;
}) {
  return (
    <div className="space-y-2">
      <div
        className="flex items-baseline justify-between pb-1"
        style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
      >
        <div>
          <h3
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: "var(--color-dsc-red)" }}
          >
            {title}
          </h3>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted)] mt-0.5">
            {subtitle}
          </p>
        </div>
        <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
          [{items.length}]
        </span>
      </div>
      {items.length === 0 ? (
        <p
          className="py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: "var(--color-muted-deep)" }}
        >
          {empty}
        </p>
      ) : (
        <ul>
          {items.map((it) => (
            <li
              key={it.id}
              className="py-2 flex items-center justify-between gap-3"
              style={{ borderBottom: "1px solid rgba(14,14,14,0.08)" }}
            >
              <Link
                href={`/admin/c/${it.id}`}
                className="flex-1 min-w-0 hover:text-[var(--color-dsc-red)]"
              >
                <div
                  className="text-[13px] font-medium truncate"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {it.line1}
                </div>
                <div className="font-mono text-[10px] text-[var(--color-muted)] truncate">
                  {it.line2}
                </div>
              </Link>
              <span
                className="font-mono text-[10px] uppercase tracking-[0.15em] shrink-0"
                style={{ color: "var(--color-dsc-red)" }}
              >
                {it.badge}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LifecyclePill({ lifecycle }: { lifecycle: Lifecycle }) {
  const styles: Record<Lifecycle, React.CSSProperties> = {
    vip: {
      border: "1px solid var(--color-dsc-red)",
      background: "var(--color-dsc-red)",
      color: "var(--color-bone)",
    },
    roster: {
      border: "1px solid var(--color-dsc-red)",
      background: "transparent",
      color: "var(--color-dsc-red)",
    },
    audience: {
      border: "1px solid var(--color-muted)",
      background: "transparent",
      color: "var(--color-muted-deep)",
    },
    archived: {
      border: "1px dashed var(--color-muted)",
      background: "transparent",
      color: "var(--color-muted)",
      textDecoration: "line-through",
    },
  };
  return (
    <span
      className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em]"
      style={{ ...styles[lifecycle], borderRadius: 6 }}
    >
      {LIFECYCLE_LABEL[lifecycle].toLowerCase()}
    </span>
  );
}

function PostedDot({
  posted,
  gifted,
}: {
  posted: boolean;
  gifted: boolean;
}) {
  if (!gifted) {
    return <span className="text-[var(--color-muted)] font-mono">—</span>;
  }
  return (
    <span
      title={posted ? "ever posted" : "no post detected"}
      className="inline-block"
      style={{
        width: 9,
        height: 9,
        borderRadius: 9,
        background: posted ? "var(--color-dsc-red)" : "transparent",
        border: "1px solid var(--color-dsc-red)",
      }}
    />
  );
}

function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="font-mono text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 transition"
      style={{
        border: "1px solid var(--color-dsc-red)",
        background: active ? "var(--color-dsc-red)" : "transparent",
        color: active ? "var(--color-bone)" : "var(--color-dsc-red)",
        borderRadius: 6,
      }}
    >
      {children}
    </Link>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="font-mono text-[9px] uppercase tracking-[0.22em] block mb-1"
      style={{ color: "var(--color-dsc-red)" }}
    >
      {children}
    </label>
  );
}

function truncate(s: string, len: number): string {
  if (s.length <= len) return s;
  return s.slice(0, len - 1) + "…";
}
