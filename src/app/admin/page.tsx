import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Contact, InviteToken, Lifecycle } from "@/types/db";
import { LIFECYCLES, LIFECYCLE_LABEL } from "@/types/db";
import { Logo } from "@/components/layout/logo";
import { logout, mintInvite, revokeInvite } from "./actions";
import { CopyLink } from "./copy-link";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  lifecycle?: string;
  tag?: string;
  owner?: string;
};

async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "spenders.vip";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const LIFECYCLE_PILL: Record<Lifecycle, string> = {
  vip: "bg-dark text-white",
  roster: "bg-primary-light text-primary border border-primary/20",
  audience: "bg-offwhite text-muted-fg border border-border",
  archived: "bg-muted/10 text-muted line-through",
};

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

  // Run all queries in parallel: contact list (with filters), counts per
  // lifecycle for chips, tokens, distinct owners, all tag values.
  const filteredQuery = supabase
    .from("contacts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (lifecycleFilter) filteredQuery.eq("lifecycle", lifecycleFilter);
  if (ownerFilter) filteredQuery.eq("owner", ownerFilter);
  if (tagFilter) filteredQuery.contains("tags", [tagFilter]);
  if (q) {
    const like = `%${q}%`;
    filteredQuery.or(
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

  const countsQuery = supabase
    .from("contacts")
    .select("lifecycle", { count: "exact", head: false });

  const tokensQuery = supabase
    .from("gifting_invite_tokens")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  const allMetaQuery = supabase
    .from("contacts")
    .select("owner, tags");

  const [contactsRes, countsRes, tokensRes, metaRes] = await Promise.all([
    filteredQuery,
    countsQuery,
    tokensQuery,
    allMetaQuery,
  ]);

  const contacts = (contactsRes.data ?? []) as Contact[];
  const tokens = (tokensRes.data ?? []) as InviteToken[];
  const origin = await getOrigin();

  // Compute counts per lifecycle from the lightweight rows we pulled.
  const allRows = (countsRes.data ?? []) as Array<{ lifecycle: Lifecycle }>;
  const totals: Record<Lifecycle | "all", number> = {
    all: allRows.length,
    audience: 0,
    roster: 0,
    vip: 0,
    archived: 0,
  };
  for (const r of allRows) totals[r.lifecycle] += 1;

  // Build owner + tag option lists from the meta query.
  const owners = Array.from(
    new Set(
      ((metaRes.data ?? []) as Array<{ owner: string | null }>)
        .map((r) => r.owner)
        .filter((o): o is string => !!o)
    )
  ).sort();

  const tagSet = new Set<string>();
  for (const r of (metaRes.data ?? []) as Array<{ tags: string[] | null }>) {
    for (const t of r.tags ?? []) tagSet.add(t);
  }
  const allTags = Array.from(tagSet).sort();

  // Helper to build URLs that preserve other filters.
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

  const chipBase =
    "px-3 py-1.5 rounded-[var(--radius-pill)] text-[11px] font-mono uppercase tracking-[0.15em] transition";
  const chipActive = "bg-dark text-white";
  const chipIdle = "bg-surface border border-border hover:border-border-hover";

  return (
    <main className="flex-1 px-6 py-8 max-w-7xl w-full mx-auto space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo size="md" variant="mark" />
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-fg">
            CRM
          </span>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-muted-fg">
          <Link href="/admin/export.csv" className="hover:text-dark">
            CSV
          </Link>
          <form action={logout}>
            <button type="submit" className="hover:text-dark">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Lifecycle chips */}
      <section className="flex flex-wrap items-center gap-2">
        <Link
          href={urlWith({ lifecycle: undefined })}
          className={`${chipBase} ${!lifecycleFilter ? chipActive : chipIdle}`}
        >
          All <span className="opacity-60 ml-1">{totals.all}</span>
        </Link>
        {LIFECYCLES.map((lc) => (
          <Link
            key={lc}
            href={urlWith({ lifecycle: lc })}
            className={`${chipBase} ${
              lifecycleFilter === lc ? chipActive : chipIdle
            }`}
          >
            {LIFECYCLE_LABEL[lc]}{" "}
            <span className="opacity-60 ml-1">{totals[lc]}</span>
          </Link>
        ))}
      </section>

      {/* Search + filters */}
      <form
        action="/admin"
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        {lifecycleFilter ? (
          <input type="hidden" name="lifecycle" value={lifecycleFilter} />
        ) : null}
        <div className="flex-1 min-w-[220px]">
          <label className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-fg block mb-1">
            Search
          </label>
          <input
            name="q"
            defaultValue={q}
            placeholder="name, email, project, handle"
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius-input)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40"
          />
        </div>
        <div className="w-[160px]">
          <label className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-fg block mb-1">
            Owner
          </label>
          <select
            name="owner"
            defaultValue={ownerFilter}
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius-input)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40"
          >
            <option value="">Any</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="w-[160px]">
          <label className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-fg block mb-1">
            Tag
          </label>
          <select
            name="tag"
            defaultValue={tagFilter}
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius-input)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40"
          >
            <option value="">Any</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-[var(--radius-button)] bg-dark text-white px-4 py-2 text-sm font-mono uppercase tracking-[0.15em] hover:bg-dark/85 transition"
        >
          Filter
        </button>
        {q || tagFilter || ownerFilter ? (
          <Link
            href={urlWith({ q: undefined, tag: undefined, owner: undefined })}
            className="text-[12px] text-muted-fg hover:text-dark"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {/* Contacts table */}
      <section className="rounded-[var(--radius-card)] border border-border bg-surface overflow-hidden">
        {contacts.length === 0 ? (
          <p className="px-4 py-16 text-center text-[13px] text-muted">
            No contacts match these filters.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-offwhite border-b border-border">
              <tr className="text-left text-[11px] font-mono uppercase tracking-[0.15em] text-muted-fg">
                <th className="px-4 py-2.5 font-normal">Name</th>
                <th className="px-2 py-2.5 font-normal">Project</th>
                <th className="px-2 py-2.5 font-normal">Stage</th>
                <th className="px-2 py-2.5 font-normal">Owner</th>
                <th className="px-2 py-2.5 font-normal">Tags</th>
                <th className="px-2 py-2.5 font-normal">Updated</th>
                <th className="px-4 py-2.5 font-normal">{""}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-offwhite/60 transition">
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/admin/c/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.display_name || c.full_name}
                    </Link>
                    <div className="text-[11px] text-muted-fg">
                      {[
                        c.x_handle ? `X ${c.x_handle}` : null,
                        c.telegram_handle ? `TG ${c.telegram_handle}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || c.email}
                    </div>
                  </td>
                  <td className="px-2 py-3 align-top text-[13px]">
                    {c.project ?? <span className="text-muted">—</span>}
                  </td>
                  <td className="px-2 py-3 align-top">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-[var(--radius-pill)] text-[10px] font-mono uppercase tracking-[0.15em] ${LIFECYCLE_PILL[c.lifecycle]}`}
                    >
                      {LIFECYCLE_LABEL[c.lifecycle]}
                    </span>
                    {c.permanent_vip ? (
                      <span className="ml-1 text-[10px] font-mono uppercase tracking-[0.15em] text-primary">
                        ★ perma
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-3 align-top text-[13px]">
                    {c.owner ?? <span className="text-muted">—</span>}
                  </td>
                  <td className="px-2 py-3 align-top text-[11px] font-mono text-muted-fg">
                    {c.tags.length === 0
                      ? "—"
                      : c.tags.slice(0, 3).join(" · ") +
                        (c.tags.length > 3 ? ` +${c.tags.length - 3}` : "")}
                  </td>
                  <td className="px-2 py-3 align-top text-[11px] text-muted-fg">
                    {fmtRelative(c.updated_at)}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <Link
                      href={`/admin/c/${c.id}`}
                      className="text-[12px] font-mono uppercase tracking-[0.15em] text-muted-fg hover:text-dark"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Invite links — compressed below the fold since they're rarely touched */}
      <section className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-fg">
            Invite links
          </h2>
          <span className="text-[11px] text-muted">
            {tokens.filter((t) => !t.revoked_at).length} active
          </span>
        </div>

        <form
          action={mintInvite}
          className="flex flex-wrap gap-2 items-end rounded-[var(--radius-card)] border border-border bg-surface p-3"
        >
          <input
            name="label"
            placeholder="Label (e.g. anthony @ consensus)"
            className="flex-1 min-w-[180px] px-3 py-2 bg-offwhite border border-border rounded-[var(--radius-input)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40"
          />
          <input
            name="created_by"
            placeholder="By"
            className="w-[120px] px-3 py-2 bg-offwhite border border-border rounded-[var(--radius-input)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40"
          />
          <button
            type="submit"
            className="rounded-[var(--radius-button)] bg-dark text-white px-3 py-2 text-[12px] font-mono uppercase tracking-[0.15em] hover:bg-dark/85 transition"
          >
            Mint
          </button>
        </form>

        {tokens.length > 0 ? (
          <ul className="rounded-[var(--radius-card)] border border-border bg-surface divide-y divide-border">
            {tokens.map((t) => {
              const url = `${origin}/s/${t.token}`;
              const revoked = !!t.revoked_at;
              return (
                <li
                  key={t.token}
                  className="px-3 py-2.5 flex flex-wrap items-center gap-3"
                >
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-[13px]">
                      {t.label ?? <span className="text-muted">Unlabeled</span>}
                      {revoked ? (
                        <span className="ml-2 text-[10px] font-mono uppercase tracking-[0.15em] text-error">
                          revoked
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-muted-fg font-mono break-all">
                      {url}
                    </p>
                    <p className="text-[10px] text-muted">
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
                        className="text-[11px] font-mono uppercase tracking-[0.15em] text-error hover:underline"
                      >
                        Revoke
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
