import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type {
  Contact,
  ContactGift,
  ContactTouchpoint,
  Lifecycle,
} from "@/types/db";
import {
  LIFECYCLES,
  LIFECYCLE_LABEL,
  GIFT_STATUSES,
  TOUCH_CHANNELS,
  CHANNEL_LABEL,
  SIZE_BANDS,
} from "@/types/db";
import {
  updateContactIdentity,
  updateContactShipping,
  updateContactStatus,
  updateContactNotes,
  updateContactTags,
  deleteContact,
  addGift,
  updateGiftStatus,
  deleteGift,
  addTouchpoint,
  deleteTouchpoint,
} from "../../actions";

export const dynamic = "force-dynamic";

const LIFECYCLE_PILL: Record<Lifecycle, string> = {
  vip: "bg-dark text-white",
  roster: "bg-primary-light text-primary border border-primary/20",
  audience: "bg-offwhite text-muted-fg border border-border",
  archived: "bg-muted/10 text-muted line-through",
};

function inputClass(extra = "") {
  return `w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius-input)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 ${extra}`;
}

function labelClass() {
  return "text-[11px] font-mono uppercase tracking-[0.2em] text-muted-fg block mb-1";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelClass()}>{label}</label>
      {children}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-4">
      <h2 className="text-[11px] font-mono uppercase tracking-[0.25em] text-muted-fg">
        {eyebrow}
      </h2>
      {title ? <span className="text-[12px] text-muted">{title}</span> : null}
    </div>
  );
}

function SaveButton({ children = "Save" }: { children?: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="rounded-[var(--radius-button)] bg-dark text-white px-4 py-2 text-[12px] font-mono uppercase tracking-[0.15em] hover:bg-dark/85 transition"
    >
      {children}
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-[var(--radius-card)] p-5 md:p-6">
      {children}
    </section>
  );
}

function Toggle({
  name,
  defaultChecked,
  label,
}: {
  name: string;
  defaultChecked: boolean;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-dark"
      />
      <span>{label}</span>
    </label>
  );
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}

type TimelineEvent =
  | { kind: "gift"; at: string; gift: ContactGift }
  | { kind: "touch"; at: string; touch: ContactTouchpoint }
  | { kind: "added"; at: string };

export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminAuthed())) redirect("/admin/login");
  const { id } = await params;

  const supabase = createServiceRoleClient();
  const [contactRes, giftsRes, touchesRes] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("contact_gifts")
      .select("*")
      .eq("contact_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("contact_touchpoints")
      .select("*")
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false }),
  ]);

  if (!contactRes.data) notFound();
  const c = contactRes.data as Contact;
  const gifts = (giftsRes.data ?? []) as ContactGift[];
  const touches = (touchesRes.data ?? []) as ContactTouchpoint[];

  // Build derived timeline: gifts + touches + the "added" event.
  const timeline: TimelineEvent[] = [
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
    { kind: "added" as const, at: c.created_at },
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <main className="flex-1 px-6 py-8 max-w-5xl w-full mx-auto space-y-6">
      {/* Breadcrumbs + header */}
      <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.2em] text-muted-fg">
        <Link href="/admin" className="hover:text-dark">
          ← All contacts
        </Link>
        <form action={deleteContact}>
          <input type="hidden" name="id" value={c.id} />
          <button type="submit" className="text-error hover:underline">
            Delete
          </button>
        </form>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {c.display_name || c.full_name}
          </h1>
          <p className="text-[12px] text-muted-fg mt-1">
            {[
              c.telegram_handle ? `TG ${c.telegram_handle}` : null,
              c.x_handle ? `X ${c.x_handle}` : null,
              c.instagram_handle ? `IG ${c.instagram_handle}` : null,
              c.email,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`inline-block px-2.5 py-1 rounded-[var(--radius-pill)] text-[10px] font-mono uppercase tracking-[0.2em] ${LIFECYCLE_PILL[c.lifecycle]}`}
          >
            {LIFECYCLE_LABEL[c.lifecycle]}
          </span>
          {c.permanent_vip ? (
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary">
              ★ permanent VIP
            </span>
          ) : null}
          {c.permanent_roster ? (
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary">
              ★ permanent roster
            </span>
          ) : null}
          {c.owner ? (
            <span className="text-[11px] text-muted-fg">owner: {c.owner}</span>
          ) : null}
        </div>
      </header>

      {/* Two-column grid on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Status — wide column on the right, this is the highest-leverage section */}
        <div className="md:col-span-3">
          <Card>
            <SectionHeader eyebrow="Status" />
            <form action={updateContactStatus} className="space-y-5">
              <input type="hidden" name="id" value={c.id} />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Lifecycle">
                  <select
                    name="lifecycle"
                    defaultValue={c.lifecycle}
                    className={inputClass()}
                  >
                    {LIFECYCLES.map((lc) => (
                      <option key={lc} value={lc}>
                        {LIFECYCLE_LABEL[lc]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Owner">
                  <input
                    name="owner"
                    defaultValue={c.owner ?? ""}
                    placeholder="anthony"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Priority (1-5)">
                  <input
                    name="priority"
                    type="number"
                    min={1}
                    max={5}
                    defaultValue={c.priority ?? ""}
                    className={inputClass()}
                  />
                </Field>
                <Field label="Warmth (1-5)">
                  <input
                    name="warmth"
                    type="number"
                    min={1}
                    max={5}
                    defaultValue={c.warmth ?? ""}
                    className={inputClass()}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Toggle
                  name="permanent_vip"
                  defaultChecked={c.permanent_vip}
                  label="Permanent VIP"
                />
                <Toggle
                  name="permanent_roster"
                  defaultChecked={c.permanent_roster}
                  label="Permanent roster"
                />
                <Toggle
                  name="castable"
                  defaultChecked={c.castable}
                  label="Castable"
                />
                <Toggle
                  name="gifting_eligible"
                  defaultChecked={c.gifting_eligible}
                  label="Gifting eligible"
                />
                <Toggle
                  name="do_not_gift"
                  defaultChecked={c.do_not_gift}
                  label="Do not gift"
                />
                <Toggle
                  name="do_not_engage"
                  defaultChecked={c.do_not_engage}
                  label="Do not engage"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Roster tier">
                  <input
                    name="roster_tier"
                    defaultValue={c.roster_tier ?? ""}
                    placeholder="A / B / C"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Why roster">
                  <input
                    name="roster_why"
                    defaultValue={c.roster_why ?? ""}
                    placeholder="Followed by 3 of our top VIPs"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Why VIP">
                  <input
                    name="vip_why"
                    defaultValue={c.vip_why ?? ""}
                    placeholder="Anchor relationship since 2024"
                    className={inputClass()}
                  />
                </Field>
              </div>

              <div className="flex justify-end">
                <SaveButton>Save status</SaveButton>
              </div>
            </form>
          </Card>
        </div>

        {/* Identity */}
        <div className="md:col-span-2">
          <Card>
            <SectionHeader eyebrow="Identity" />
            <form action={updateContactIdentity} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Full name">
                  <input
                    name="full_name"
                    defaultValue={c.full_name}
                    className={inputClass()}
                    required
                  />
                </Field>
                <Field label="Display name">
                  <input
                    name="display_name"
                    defaultValue={c.display_name ?? ""}
                    placeholder="What we call them"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    defaultValue={c.email}
                    className={inputClass()}
                    required
                  />
                </Field>
                <Field label="Project / company">
                  <input
                    name="project"
                    defaultValue={c.project ?? ""}
                    className={inputClass()}
                  />
                </Field>
                <Field label="Community / ecosystem">
                  <input
                    name="community"
                    defaultValue={c.community ?? ""}
                    placeholder="Solana / Base / EVM / ..."
                    className={inputClass()}
                  />
                </Field>
                <Field label="Base city">
                  <input
                    name="base_city"
                    defaultValue={c.base_city ?? ""}
                    className={inputClass()}
                  />
                </Field>
                <Field label="Timezone">
                  <input
                    name="timezone"
                    defaultValue={c.timezone ?? ""}
                    placeholder="America/Los_Angeles"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Introduced by">
                  <input
                    name="introduced_by"
                    defaultValue={c.introduced_by ?? ""}
                    className={inputClass()}
                  />
                </Field>
                <Field label="Telegram">
                  <input
                    name="telegram_handle"
                    defaultValue={c.telegram_handle ?? ""}
                    placeholder="@you"
                    className={inputClass()}
                  />
                </Field>
                <Field label="X handle">
                  <input
                    name="x_handle"
                    defaultValue={c.x_handle ?? ""}
                    placeholder="@you"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Instagram">
                  <input
                    name="instagram_handle"
                    defaultValue={c.instagram_handle ?? ""}
                    placeholder="@you"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    name="phone"
                    defaultValue={c.phone ?? ""}
                    className={inputClass()}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Wallet address">
                    <input
                      name="wallet_address"
                      defaultValue={c.wallet_address ?? ""}
                      placeholder="0x... or a sol address"
                      className={inputClass("font-mono text-[12px]")}
                    />
                  </Field>
                </div>
              </div>
              <div className="flex justify-end">
                <SaveButton>Save identity</SaveButton>
              </div>
            </form>
          </Card>
        </div>

        {/* Tags + Sizing snapshot */}
        <div className="space-y-5">
          <Card>
            <SectionHeader eyebrow="Tags" />
            <form action={updateContactTags} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <Field label="Comma-separated">
                <input
                  name="tags"
                  defaultValue={c.tags.join(", ")}
                  placeholder="trader, founder, recurring-gift"
                  className={inputClass("font-mono text-[12px]")}
                />
              </Field>
              <div className="flex justify-end">
                <SaveButton>Save tags</SaveButton>
              </div>
            </form>
            {c.tags.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-offwhite border border-border text-[10px] font-mono uppercase tracking-[0.15em] text-muted-fg"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>

          <Card>
            <SectionHeader eyebrow="Sizing" />
            <ul className="text-[12px] font-mono space-y-1 text-muted-fg">
              <li>Shirt: {c.shirt_size}</li>
              <li>Pants: {c.pants_size}</li>
              <li>Shorts: {c.shorts_size}</li>
              <li>Sweat: {c.sweatshirt_size}</li>
              {c.shoe_size ? <li>Shoe: {c.shoe_size}</li> : null}
              {c.hat_size ? <li>Hat: {c.hat_size}</li> : null}
            </ul>
            <p className="text-[10px] text-muted mt-2">
              Edit via the public form for now.
            </p>
            <p className="text-[10px] font-mono text-muted mt-1">
              {SIZE_BANDS.join(" / ")}
            </p>
          </Card>
        </div>

        {/* Shipping */}
        <div className="md:col-span-2">
          <Card>
            <SectionHeader eyebrow="Shipping" />
            <form action={updateContactShipping} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Recipient name">
                  <input
                    name="shipping_recipient"
                    defaultValue={c.shipping_recipient ?? c.full_name}
                    className={inputClass()}
                  />
                </Field>
                <Field label="Address line 1">
                  <input
                    name="address_line1"
                    defaultValue={c.address_line1}
                    className={inputClass()}
                    required
                  />
                </Field>
                <Field label="Address line 2">
                  <input
                    name="address_line2"
                    defaultValue={c.address_line2 ?? ""}
                    className={inputClass()}
                  />
                </Field>
                <Field label="City, state, region">
                  <input
                    name="city_region"
                    defaultValue={c.city_region}
                    className={inputClass()}
                    required
                  />
                </Field>
                <Field label="Country">
                  <input
                    name="country"
                    defaultValue={c.country}
                    className={inputClass()}
                    required
                  />
                </Field>
                <Field label="Postal / zip">
                  <input
                    name="postal_code"
                    defaultValue={c.postal_code}
                    className={inputClass()}
                    required
                  />
                </Field>
              </div>
              <Toggle
                name="address_verified"
                defaultChecked={c.address_verified}
                label="Address verified"
              />
              <div className="flex justify-end">
                <SaveButton>Save shipping</SaveButton>
              </div>
            </form>
          </Card>
        </div>

        {/* Notes */}
        <div>
          <Card>
            <SectionHeader eyebrow="Notes" />
            <form action={updateContactNotes} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <textarea
                name="notes"
                rows={8}
                defaultValue={c.notes ?? ""}
                placeholder="Why they matter, who introduced them, project context, do-not flags rationale..."
                className={inputClass("resize-none")}
              />
              <div className="flex justify-end">
                <SaveButton>Save notes</SaveButton>
              </div>
            </form>
          </Card>
        </div>

        {/* Gifts */}
        <div className="md:col-span-2">
          <Card>
            <SectionHeader
              eyebrow="Gifts"
              title={`${gifts.length} total`}
            />
            <form
              action={addGift}
              className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5"
            >
              <input type="hidden" name="contact_id" value={c.id} />
              <Field label="Item">
                <input
                  name="item"
                  required
                  placeholder="DSC hoodie"
                  className={inputClass()}
                />
              </Field>
              <Field label="Drop name">
                <input
                  name="drop_name"
                  placeholder="Consensus 2026"
                  className={inputClass()}
                />
              </Field>
              <Field label="Status">
                <select
                  name="status"
                  defaultValue="queued"
                  className={inputClass()}
                >
                  {GIFT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tracking">
                <input
                  name="tracking"
                  placeholder="USPS / DHL number"
                  className={inputClass()}
                />
              </Field>
              <Field label="Logged by">
                <input
                  name="logged_by"
                  placeholder="anthony"
                  className={inputClass()}
                />
              </Field>
              <div className="flex items-end">
                <SaveButton>Log gift</SaveButton>
              </div>
              <div className="md:col-span-2">
                <Field label="Notes">
                  <input name="notes" className={inputClass()} />
                </Field>
              </div>
            </form>

            {gifts.length === 0 ? (
              <p className="text-[12px] text-muted">No gifts logged yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {gifts.map((g) => (
                  <li
                    key={g.id}
                    className="py-3 flex flex-wrap items-start justify-between gap-3"
                  >
                    <div className="flex-1 min-w-[200px]">
                      <p className="text-sm">
                        <span className="font-medium">{g.item}</span>
                        {g.drop_name ? (
                          <span className="text-muted-fg"> · {g.drop_name}</span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-muted-fg font-mono">
                        {[
                          g.sent_at ? `shipped ${fmtDate(g.sent_at)}` : null,
                          g.delivered_at
                            ? `delivered ${fmtDate(g.delivered_at)}`
                            : null,
                          g.posted_at ? `posted ${fmtDate(g.posted_at)}` : null,
                          g.tracking ? `track ${g.tracking}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") ||
                          `created ${fmtDate(g.created_at)}`}
                      </p>
                      {g.notes ? (
                        <p className="text-[12px] text-muted-fg italic mt-0.5">
                          {g.notes}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <form action={updateGiftStatus}>
                        <input type="hidden" name="id" value={g.id} />
                        <input type="hidden" name="contact_id" value={c.id} />
                        <select
                          name="status"
                          defaultValue={g.status}
                          className="px-2 py-1 text-[11px] font-mono uppercase tracking-[0.1em] bg-offwhite border border-border rounded-[var(--radius-input)]"
                        >
                          {GIFT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="ml-1 text-[11px] font-mono uppercase tracking-[0.15em] text-muted-fg hover:text-dark"
                        >
                          set
                        </button>
                      </form>
                      <form action={deleteGift}>
                        <input type="hidden" name="id" value={g.id} />
                        <input type="hidden" name="contact_id" value={c.id} />
                        <button
                          type="submit"
                          className="text-[11px] text-error hover:underline"
                        >
                          delete
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Outreach */}
        <div>
          <Card>
            <SectionHeader
              eyebrow="Outreach"
              title={`${touches.length} total`}
            />
            <form action={addTouchpoint} className="space-y-3 mb-5">
              <input type="hidden" name="contact_id" value={c.id} />
              <Field label="Channel">
                <select
                  name="channel"
                  defaultValue="dm_tg"
                  className={inputClass()}
                >
                  {TOUCH_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {CHANNEL_LABEL[ch]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Direction">
                <select
                  name="direction"
                  defaultValue="outbound"
                  className={inputClass()}
                >
                  <option value="outbound">Outbound (we sent)</option>
                  <option value="inbound">Inbound (they replied)</option>
                </select>
              </Field>
              <Field label="Summary">
                <textarea
                  name="summary"
                  rows={3}
                  required
                  placeholder="Pinged about collab on the OP launch"
                  className={inputClass("resize-none")}
                />
              </Field>
              <Field label="Follow up on">
                <input
                  name="follow_up_at"
                  type="date"
                  className={inputClass()}
                />
              </Field>
              <Field label="Logged by">
                <input
                  name="logged_by"
                  placeholder="anthony"
                  className={inputClass()}
                />
              </Field>
              <div className="flex justify-end">
                <SaveButton>Log touchpoint</SaveButton>
              </div>
            </form>

            {touches.length === 0 ? (
              <p className="text-[12px] text-muted">No outreach yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {touches.map((t) => (
                  <li
                    key={t.id}
                    className="py-3 flex flex-wrap items-start justify-between gap-3"
                  >
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-fg">
                        {CHANNEL_LABEL[t.channel]} ·{" "}
                        {t.direction === "outbound" ? "out" : "in"} ·{" "}
                        {fmtDate(t.occurred_at)}
                      </p>
                      <p className="text-sm whitespace-pre-line mt-0.5">
                        {t.summary}
                      </p>
                      {t.follow_up_at ? (
                        <p className="text-[11px] text-primary font-mono mt-0.5">
                          follow up {fmtDate(t.follow_up_at)}
                        </p>
                      ) : null}
                      {t.logged_by ? (
                        <p className="text-[10px] text-muted mt-0.5">
                          by {t.logged_by}
                        </p>
                      ) : null}
                    </div>
                    <form action={deleteTouchpoint}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="contact_id" value={c.id} />
                      <button
                        type="submit"
                        className="text-[11px] text-error hover:underline"
                      >
                        delete
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Activity timeline (computed) */}
        <div className="md:col-span-3">
          <Card>
            <SectionHeader
              eyebrow="Activity"
              title={`${timeline.length} events`}
            />
            <ol className="space-y-2">
              {timeline.map((ev, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-3 text-[12px]"
                >
                  <span className="w-[110px] shrink-0 font-mono text-muted">
                    {fmtDate(ev.at)}
                  </span>
                  {ev.kind === "gift" ? (
                    <span>
                      <span className="font-mono uppercase tracking-[0.15em] text-[10px] text-muted-fg mr-2">
                        gift / {ev.gift.status}
                      </span>
                      {ev.gift.item}
                      {ev.gift.drop_name ? ` · ${ev.gift.drop_name}` : ""}
                    </span>
                  ) : ev.kind === "touch" ? (
                    <span>
                      <span className="font-mono uppercase tracking-[0.15em] text-[10px] text-muted-fg mr-2">
                        {CHANNEL_LABEL[ev.touch.channel]} ·{" "}
                        {ev.touch.direction === "outbound" ? "out" : "in"}
                      </span>
                      {ev.touch.summary.slice(0, 120)}
                      {ev.touch.summary.length > 120 ? "…" : ""}
                    </span>
                  ) : (
                    <span>
                      <span className="font-mono uppercase tracking-[0.15em] text-[10px] text-muted-fg mr-2">
                        added · {c.source}
                      </span>
                      Contact created
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted text-center">
        Created {fmt(c.created_at)} · Updated {fmt(c.updated_at)}
      </p>
    </main>
  );
}
