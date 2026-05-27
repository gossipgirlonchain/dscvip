import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { InviteToken, Signup } from "@/types/db";
import { Logo } from "@/components/layout/logo";
import {
  logout,
  mintInvite,
  revokeInvite,
  deleteSignup,
} from "./actions";
import { CopyLink } from "./copy-link";

export const dynamic = "force-dynamic";

async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "spenders.club";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export default async function AdminPage() {
  if (!(await isAdminAuthed())) redirect("/admin/login");

  const supabase = createServiceRoleClient();
  const [signupsRes, tokensRes] = await Promise.all([
    supabase
      .from("gifting_signups")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("gifting_invite_tokens")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  const signups = (signupsRes.data ?? []) as Signup[];
  const tokens = (tokensRes.data ?? []) as InviteToken[];
  const origin = await getOrigin();

  return (
    <main className="flex-1 px-6 py-10 max-w-5xl w-full mx-auto space-y-10">
      <header className="flex items-center justify-between">
        <Logo size="md" variant="mark" />
        <form action={logout}>
          <button
            type="submit"
            className="text-[13px] text-muted-fg hover:text-dark transition"
          >
            Sign out
          </button>
        </form>
      </header>

      {/* Invite links */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Invite links</h2>
          <span className="text-[12px] text-muted">
            {tokens.filter((t) => !t.revoked_at).length} active
          </span>
        </div>

        <form
          action={mintInvite}
          className="flex flex-wrap gap-2 items-end rounded-[var(--radius-card)] border border-border bg-surface p-4"
        >
          <div className="flex-1 min-w-[180px]">
            <label className="text-[12px] text-muted-fg block mb-1">
              Label (where will this be shared?)
            </label>
            <input
              name="label"
              placeholder="anthony @ consensus booth"
              className="w-full px-3 py-2 bg-offwhite border border-border rounded-[var(--radius-input)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40"
            />
          </div>
          <div className="w-[160px]">
            <label className="text-[12px] text-muted-fg block mb-1">By</label>
            <input
              name="created_by"
              placeholder="anthony"
              className="w-full px-3 py-2 bg-offwhite border border-border rounded-[var(--radius-input)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40"
            />
          </div>
          <button
            type="submit"
            className="rounded-[var(--radius-button)] bg-dark text-white px-4 py-2 text-sm font-medium hover:bg-dark/85 transition"
          >
            Mint link
          </button>
        </form>

        <div className="rounded-[var(--radius-card)] border border-border bg-surface overflow-hidden">
          {tokens.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">
              No invite links yet. Mint one above.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {tokens.map((t) => {
                const url = `${origin}/s/${t.token}`;
                const revoked = !!t.revoked_at;
                return (
                  <li
                    key={t.token}
                    className="px-4 py-3 flex flex-wrap items-center gap-3"
                  >
                    <div className="flex-1 min-w-[200px]">
                      <p className="text-sm font-medium">
                        {t.label ?? <span className="text-muted">Unlabeled</span>}
                        {revoked ? (
                          <span className="ml-2 text-[11px] text-error">revoked</span>
                        ) : null}
                      </p>
                      <p className="text-[12px] text-muted-fg font-mono break-all">
                        {url}
                      </p>
                      <p className="text-[11px] text-muted">
                        {t.use_count} signup{t.use_count === 1 ? "" : "s"}
                        {t.created_by ? ` · by ${t.created_by}` : ""}
                      </p>
                    </div>
                    <CopyLink url={url} disabled={revoked} />
                    {!revoked ? (
                      <form action={revokeInvite}>
                        <input type="hidden" name="token" value={t.token} />
                        <button
                          type="submit"
                          className="text-[12px] text-error hover:underline"
                        >
                          Revoke
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>


      {/* Gifting list */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Gifting list</h2>
          <div className="flex items-center gap-3 text-[12px] text-muted">
            <span>{signups.length} total</span>
            <a
              href="/admin/export.csv"
              className="underline hover:text-dark"
            >
              CSV
            </a>
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-border bg-surface overflow-hidden">
          {signups.length === 0 ? (
            <p className="px-4 py-12 text-center text-[13px] text-muted">
              No signups yet. Share an invite link.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {signups.map((s) => {
                const handles = [
                  s.telegram_handle ? `TG ${s.telegram_handle}` : null,
                  s.x_handle ? `X ${s.x_handle}` : null,
                  s.instagram_handle ? `IG ${s.instagram_handle}` : null,
                ].filter(Boolean);
                const sizes = [
                  `Shirt ${s.shirt_size}`,
                  `Pants ${s.pants_size}`,
                  `Shorts ${s.shorts_size}`,
                  `Sweat ${s.sweatshirt_size}`,
                  s.shoe_size ? `Shoe ${s.shoe_size}` : null,
                  s.hat_size ? `Hat ${s.hat_size}` : null,
                ].filter(Boolean);

                return (
                  <li key={s.id} className="px-4 py-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{s.full_name}</p>
                        <span className="text-[12px] text-muted-fg">{s.email}</span>
                      </div>

                      <p className="text-[13px] text-muted-fg whitespace-pre-line">
                        {s.address_line1}
                        {s.address_line2 ? `, ${s.address_line2}` : ""}
                        {"\n"}
                        {s.city_region}, {s.postal_code}
                        {"\n"}
                        {s.country}
                      </p>

                      {handles.length > 0 ? (
                        <p className="text-[12px] text-muted-fg">{handles.join(" · ")}</p>
                      ) : null}

                      <p className="text-[12px] font-mono text-muted">
                        {sizes.join(" · ")}
                      </p>

                      <p className="text-[11px] text-muted">
                        {new Date(s.created_at).toLocaleString()}
                        {" · "}
                        via{" "}
                        {s.token ? (
                          <span className="font-mono">{s.token.slice(0, 8)}…</span>
                        ) : (
                          "manual"
                        )}
                      </p>
                    </div>

                    <form action={deleteSignup} className="self-start">
                      <input type="hidden" name="id" value={s.id} />
                      <button
                        type="submit"
                        className="text-[12px] text-error hover:underline"
                      >
                        Delete
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
