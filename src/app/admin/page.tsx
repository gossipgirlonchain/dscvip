import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Contact, InviteToken, Lifecycle } from "@/types/db";
import { LIFECYCLES, LIFECYCLE_LABEL } from "@/types/db";
import { mintInvite, revokeInvite } from "./actions";
import { CopyLink } from "./copy-link";
import { AdminNav } from "@/components/admin/nav";

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

const LIFECYCLE_PILL: Record<Lifecycle, React.CSSProperties> = {
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
    "px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em] transition";
  const chipActiveStyle: React.CSSProperties = {
    border: "1px solid var(--color-dsc-red)",
    background: "var(--color-dsc-red)",
    color: "var(--color-bone)",
    borderRadius: 2,
  };
  const chipIdleStyle: React.CSSProperties = {
    border: "1px solid var(--color-dsc-red)",
    background: "transparent",
    color: "var(--color-dsc-red)",
    borderRadius: 2,
  };
  const inputStyle: React.CSSProperties = {
    borderBottom: "1px solid rgba(14,14,14,0.2)",
    color: "var(--color-ink)",
    background: "transparent",
  };

  return (
    <main className="dsc-bone relative flex-1 px-12 py-8 max-w-[1180px] w-full mx-auto space-y-6">
      <AdminNav active="contacts" />

      {/* Lifecycle chips */}
      <section className="flex flex-wrap items-center gap-1.5">
        <Link
          href={urlWith({ lifecycle: undefined })}
          className={chipBase}
          style={!lifecycleFilter ? chipActiveStyle : chipIdleStyle}
        >
          all <span className="opacity-70 ml-1">[{totals.all}]</span>
        </Link>
        {LIFECYCLES.map((lc) => (
          <Link
            key={lc}
            href={urlWith({ lifecycle: lc })}
            className={chipBase}
            style={
              lifecycleFilter === lc ? chipActiveStyle : chipIdleStyle
            }
          >
            {LIFECYCLE_LABEL[lc].toLowerCase()}{" "}
            <span className="opacity-70 ml-1">[{totals[lc]}]</span>
          </Link>
        ))}
      </section>

      {/* Search + filters — bottom-hairline-only inputs */}
      <form
        action="/admin"
        method="get"
        className="flex flex-wrap items-end gap-4"
      >
        {lifecycleFilter ? (
          <input type="hidden" name="lifecycle" value={lifecycleFilter} />
        ) : null}
        <div className="flex-1 min-w-[220px]">
          <label
            className="font-mono text-[9px] uppercase tracking-[0.22em] block mb-1"
            style={{ color: "var(--color-dsc-red)" }}
          >
            search
          </label>
          <input
            name="q"
            defaultValue={q}
            placeholder="name, email, project, handle"
            className="w-full px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)]"
            style={inputStyle}
          />
        </div>
        <div className="w-[160px]">
          <label
            className="font-mono text-[9px] uppercase tracking-[0.22em] block mb-1"
            style={{ color: "var(--color-dsc-red)" }}
          >
            owner
          </label>
          <select
            name="owner"
            defaultValue={ownerFilter}
            className="w-full px-1 py-1.5 text-[13px] focus:outline-none cursor-pointer"
            style={{ ...inputStyle, appearance: "none" }}
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
          <label
            className="font-mono text-[9px] uppercase tracking-[0.22em] block mb-1"
            style={{ color: "var(--color-dsc-red)" }}
          >
            tag
          </label>
          <select
            name="tag"
            defaultValue={tagFilter}
            className="w-full px-1 py-1.5 text-[13px] focus:outline-none cursor-pointer"
            style={{ ...inputStyle, appearance: "none" }}
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
          className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 transition"
          style={{
            border: "1px solid var(--color-dsc-red)",
            background: "transparent",
            color: "var(--color-dsc-red)",
            borderRadius: 2,
          }}
        >
          filter
        </button>
        {q || tagFilter || ownerFilter ? (
          <Link
            href={urlWith({ q: undefined, tag: undefined, owner: undefined })}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-dsc-red)]"
          >
            clear
          </Link>
        ) : null}
      </form>

      {/* Contacts table */}
      <section className="relative">
        {contacts.length === 0 ? (
          <p
            className="py-12 font-mono text-[11px] uppercase tracking-[0.18em]"
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
                <th className="py-2 pr-3 font-normal">name</th>
                <th className="py-2 pr-3 font-normal">project</th>
                <th className="py-2 pr-3 font-normal">stage</th>
                <th className="py-2 pr-3 font-normal">owner</th>
                <th className="py-2 pr-3 font-normal">tags</th>
                <th className="py-2 pr-3 font-normal">updated</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-[var(--color-bone-deep)] transition"
                  style={{ borderBottom: "1px solid rgba(14,14,14,0.08)" }}
                >
                  <td className="py-2.5 pr-3 align-top">
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
                  <td className="py-2.5 pr-3 align-top text-[13px]">
                    {c.project ?? (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <span
                      className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em]"
                      style={{ ...LIFECYCLE_PILL[c.lifecycle], borderRadius: 2 }}
                    >
                      {LIFECYCLE_LABEL[c.lifecycle].toLowerCase()}
                    </span>
                    {c.permanent_vip ? (
                      <span
                        className="ml-1 text-[10px] font-mono uppercase tracking-[0.18em]"
                        style={{ color: "var(--color-dsc-red)" }}
                      >
                        ★ perma
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 align-top text-[13px]">
                    {c.owner ?? (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 align-top text-[11px] font-mono text-[var(--color-muted-deep)]">
                    {c.tags.length === 0
                      ? "—"
                      : c.tags.slice(0, 3).join(" · ") +
                        (c.tags.length > 3 ? ` +${c.tags.length - 3}` : "")}
                  </td>
                  <td className="py-2.5 pr-3 align-top text-[11px] font-mono text-[var(--color-muted)]">
                    {fmtRelative(c.updated_at)}
                  </td>
                  <td className="py-2.5 align-top text-right">
                    <Link
                      href={`/admin/c/${c.id}`}
                      className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-dsc-red)]"
                    >
                      open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Invite links — compressed below the fold */}
      <section
        className="space-y-3 pt-4"
        style={{ borderTop: "1px solid rgba(14,14,14,0.12)" }}
      >
        <div
          className="flex items-baseline justify-between pb-1"
          style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
        >
          <h2
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
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
            className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 transition"
            style={{
              border: "1px solid var(--color-dsc-red)",
              background: "transparent",
              color: "var(--color-dsc-red)",
              borderRadius: 2,
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
