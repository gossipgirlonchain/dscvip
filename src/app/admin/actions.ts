"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAdminAuthed, clearAdminCookie } from "@/lib/admin-auth";
import type {
  Contact,
  GiftStatus,
  Lifecycle,
  TouchChannel,
} from "@/types/db";
import {
  parsePasteDiff,
  isValidSizeBand,
  SIZE_FIELDS,
  ALLOWED_SETTABLE,
  type Diff,
  type DiffChange,
} from "@/lib/llm/paste-parser";
import { notifyTelegram } from "@/lib/telegram/notify";

async function requireAdmin() {
  if (!(await isAdminAuthed())) {
    redirect("/admin/login");
  }
}

/**
 * Generic field patcher for the contact detail page. Whitelist keeps the
 * call surface honest — anything not in ALLOWED_FIELDS is silently dropped.
 * Used by the autosave layer in /admin/c/[id].
 */
const ALLOWED_FIELDS = new Set<string>([
  "full_name",
  "display_name",
  "email",
  "project",
  "community",
  "base_city",
  "timezone",
  "x_handle",
  "instagram_handle",
  "telegram_handle",
  "wallet_address",
  "phone",
  "introduced_by",
  "shipping_recipient",
  "address_line1",
  "address_line2",
  "city_region",
  "country",
  "postal_code",
  "address_verified",
  "shirt_size",
  "pants_size",
  "shorts_size",
  "sweatshirt_size",
  "shoe_size",
  "hat_size",
  "lifecycle",
  "permanent_vip",
  "permanent_roster",
  "owner",
  "priority",
  "warmth",
  "castable",
  "gifting_eligible",
  "do_not_gift",
  "do_not_engage",
  "roster_tier",
  "notes",
  "tags",
  "heads_up",
]);

export async function patchContact(
  id: string,
  patch: Record<string, unknown>
): Promise<{ ok: true; updated_at: string } | { ok: false; error: string }> {
  if (!(await isAdminAuthed())) {
    return { ok: false, error: "Not authenticated." };
  }
  if (!id) return { ok: false, error: "Missing contact id." };

  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (ALLOWED_FIELDS.has(k)) safe[k] = v;
  }
  if (Object.keys(safe).length === 0) {
    return { ok: false, error: "Empty patch." };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contacts")
    .update(safe)
    .eq("id", id)
    .select("updated_at")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, updated_at: data?.updated_at ?? new Date().toISOString() };
}

export async function searchContacts(q: string): Promise<
  Array<{
    id: string;
    label: string;
    sub: string;
    lifecycle: string;
  }>
> {
  if (!(await isAdminAuthed())) return [];
  const term = q.trim();
  if (term.length < 1) return [];

  const supabase = createServiceRoleClient();
  const like = `%${term}%`;
  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, full_name, display_name, email, project, x_handle, telegram_handle, lifecycle"
    )
    .or(
      [
        `full_name.ilike.${like}`,
        `display_name.ilike.${like}`,
        `email.ilike.${like}`,
        `project.ilike.${like}`,
        `x_handle.ilike.${like}`,
        `telegram_handle.ilike.${like}`,
      ].join(",")
    )
    .order("updated_at", { ascending: false })
    .limit(12);

  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    label: r.display_name || r.full_name,
    sub:
      [r.project, r.x_handle ? `X ${r.x_handle}` : null, r.email]
        .filter(Boolean)
        .join(" · ") || "",
    lifecycle: r.lifecycle,
  }));
}

function s(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function nullable(v: FormDataEntryValue | null): string | null {
  const t = s(v);
  return t.length ? t : null;
}

function boolish(v: FormDataEntryValue | null): boolean {
  const t = s(v).toLowerCase();
  return t === "true" || t === "on" || t === "1";
}

function int(v: FormDataEntryValue | null): number | null {
  const t = s(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export async function logout() {
  await clearAdminCookie();
  redirect("/admin/login");
}

/* ───── invite links ───── */

export async function mintInvite(formData: FormData) {
  await requireAdmin();
  const label = nullable(formData.get("label"));
  const created_by = nullable(formData.get("created_by"));

  const token = randomBytes(9).toString("base64url");

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("gifting_invite_tokens").insert({
    token,
    label,
    created_by,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
}

export async function revokeInvite(formData: FormData) {
  await requireAdmin();
  const token = s(formData.get("token"));
  if (!token) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("gifting_invite_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token", token);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

/* ───── contacts ───── */

export async function deleteContact(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  if (!id) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function updateContactIdentity(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  if (!id) return;

  const patch = {
    display_name: nullable(formData.get("display_name")),
    full_name: s(formData.get("full_name")) || undefined,
    email: s(formData.get("email")) || undefined,
    project: nullable(formData.get("project")),
    community: nullable(formData.get("community")),
    base_city: nullable(formData.get("base_city")),
    timezone: nullable(formData.get("timezone")),
    x_handle: nullable(formData.get("x_handle")),
    instagram_handle: nullable(formData.get("instagram_handle")),
    telegram_handle: nullable(formData.get("telegram_handle")),
    wallet_address: nullable(formData.get("wallet_address")),
    phone: nullable(formData.get("phone")),
    introduced_by: nullable(formData.get("introduced_by")),
  };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contacts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${id}`);
}

export async function updateContactShipping(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  if (!id) return;

  const patch = {
    shipping_recipient: nullable(formData.get("shipping_recipient")),
    address_line1: s(formData.get("address_line1")),
    address_line2: nullable(formData.get("address_line2")),
    city_region: s(formData.get("city_region")),
    country: s(formData.get("country")),
    postal_code: s(formData.get("postal_code")),
    address_verified: boolish(formData.get("address_verified")),
  };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contacts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${id}`);
}

export async function updateContactStatus(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  if (!id) return;

  const lifecycle = s(formData.get("lifecycle")) as Lifecycle;
  const allowed: Lifecycle[] = ["audience", "roster", "vip", "archived"];
  if (!allowed.includes(lifecycle)) return;

  const patch = {
    lifecycle,
    permanent_vip: boolish(formData.get("permanent_vip")),
    permanent_roster: boolish(formData.get("permanent_roster")),
    owner: nullable(formData.get("owner")),
    priority: int(formData.get("priority")),
    warmth: int(formData.get("warmth")),
    castable: boolish(formData.get("castable")),
    gifting_eligible: boolish(formData.get("gifting_eligible")),
    do_not_gift: boolish(formData.get("do_not_gift")),
    do_not_engage: boolish(formData.get("do_not_engage")),
    roster_tier: nullable(formData.get("roster_tier")),
    roster_why: nullable(formData.get("roster_why")),
    vip_why: nullable(formData.get("vip_why")),
  };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contacts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${id}`);
  revalidatePath("/admin");
}

export async function updateContactNotes(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  if (!id) return;

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("contacts")
    .update({ notes: nullable(formData.get("notes")) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${id}`);
}

export async function updateContactTags(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  if (!id) return;

  // Tags submitted as comma-separated string. Normalize: trim, dedupe,
  // lowercase, slugify spaces to hyphens for stable filtering.
  const raw = s(formData.get("tags"));
  const tags = Array.from(
    new Set(
      raw
        .split(",")
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean)
    )
  );

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("contacts")
    .update({ tags })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${id}`);
  revalidatePath("/admin");
}

/* ───── gifts ───── */

export async function addGift(formData: FormData) {
  await requireAdmin();
  const contact_id = s(formData.get("contact_id"));
  const item = s(formData.get("item"));
  if (!contact_id || !item) return;

  const status = (s(formData.get("status")) || "queued") as GiftStatus;
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contact_gifts").insert({
    contact_id,
    item,
    drop_name: nullable(formData.get("drop_name")),
    status,
    sent_at: status === "shipped" ? new Date().toISOString() : null,
    tracking: nullable(formData.get("tracking")),
    notes: nullable(formData.get("notes")),
    logged_by: nullable(formData.get("logged_by")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${contact_id}`);
}

export async function updateGiftStatus(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  const contact_id = s(formData.get("contact_id"));
  const status = s(formData.get("status")) as GiftStatus;
  if (!id || !contact_id) return;
  const allowed: GiftStatus[] = [
    "queued",
    "packed",
    "shipped",
    "delivered",
    "posted",
    "returned",
  ];
  if (!allowed.includes(status)) return;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (status === "packed") patch.packed_at = now;
  if (status === "shipped") patch.sent_at = now;
  if (status === "delivered") patch.delivered_at = now;
  if (status === "posted") {
    patch.posted_at = now;
    const url = nullable(formData.get("posted_url"));
    if (url) patch.posted_url = url;
  }
  if (status === "returned") patch.returned_at = now;

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("contact_gifts")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${contact_id}`);
  revalidatePath("/admin");
}

/**
 * Highest-leverage interaction on the pipeline dashboard. Sets the gift
 * to POSTED, captures the post URL, and stamps posted_at. Surfaces in the
 * POSTED column + flips contact.has_ever_posted (derived).
 */
export async function markGiftPosted(
  giftId: string,
  postUrl: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isAdminAuthed())) {
    return { ok: false, error: "Not authenticated." };
  }
  if (!giftId) return { ok: false, error: "Missing gift id." };

  const supabase = createServiceRoleClient();
  const { data: gift, error: fetchErr } = await supabase
    .from("contact_gifts")
    .select("contact_id")
    .eq("id", giftId)
    .maybeSingle();
  if (fetchErr || !gift) {
    return { ok: false, error: "Gift not found." };
  }

  const { error } = await supabase
    .from("contact_gifts")
    .update({
      status: "posted",
      posted_at: new Date().toISOString(),
      posted_url: postUrl.trim() || null,
    })
    .eq("id", giftId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  revalidatePath(`/admin/c/${gift.contact_id}`);
  return { ok: true };
}

export async function deleteGift(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  const contact_id = s(formData.get("contact_id"));
  if (!id || !contact_id) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contact_gifts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${contact_id}`);
}

/* ───── touchpoints ───── */

export async function addTouchpoint(formData: FormData) {
  await requireAdmin();
  const contact_id = s(formData.get("contact_id"));
  const summary = s(formData.get("summary"));
  if (!contact_id || !summary) return;

  const channel = (s(formData.get("channel")) || "other") as TouchChannel;
  const direction =
    s(formData.get("direction")) === "inbound" ? "inbound" : "outbound";

  const follow_up_raw = nullable(formData.get("follow_up_at"));
  // <input type="date"> gives YYYY-MM-DD. Coerce to start-of-day UTC.
  const follow_up_at = follow_up_raw
    ? new Date(`${follow_up_raw}T00:00:00Z`).toISOString()
    : null;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contact_touchpoints").insert({
    contact_id,
    channel,
    direction,
    summary,
    occurred_at: new Date().toISOString(),
    follow_up_at,
    logged_by: nullable(formData.get("logged_by")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${contact_id}`);
}

export async function deleteTouchpoint(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  const contact_id = s(formData.get("contact_id"));
  if (!id || !contact_id) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("contact_touchpoints")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${contact_id}`);
}

/* ───── smart paste: propose + apply ───── */

/**
 * Run the paste through the LLM and return the proposed diff. The diff
 * has not been written anywhere — the client renders it for review.
 */
export async function proposePasteDiff(
  contactId: string,
  paste: string
): Promise<
  | { ok: true; diff: Diff }
  | { ok: false; error: string }
> {
  if (!(await isAdminAuthed())) {
    return { ok: false, error: "Not authenticated." };
  }
  const trimmed = paste.trim();
  if (!trimmed) return { ok: false, error: "Paste is empty." };
  if (trimmed.length > 20_000) {
    return { ok: false, error: "Paste is too long (max 20K chars)." };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: "Contact not found." };
  }

  try {
    const diff = await parsePasteDiff(data as Contact, trimmed);
    return { ok: true, diff };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown LLM error.";
    return { ok: false, error: msg };
  }
}

/**
 * Apply the subset of the diff the user approved. Provenance rules:
 *
 * - "set" writes the field directly. Sizing fields validate against the
 *   six-band enum; anything else is dropped.
 * - "append_context" prepends a timestamped header (`[YYYY-MM-DD · from paste]`)
 *   to a quoted block and appends to existing notes. Never overwrites.
 * - "heads_up" replaces the heads_up field — only the latest matters,
 *   the user dismisses it inline when handled.
 * - "suggest_tag" and "mention_person" are never auto-applied; the UI
 *   surfaces them but doesn't include them in the approved set.
 */
export async function applyPasteDiff(
  contactId: string,
  approved: DiffChange[]
): Promise<
  | { ok: true; applied: number; skipped: number }
  | { ok: false; error: string }
> {
  if (!(await isAdminAuthed())) {
    return { ok: false, error: "Not authenticated." };
  }
  if (!contactId) return { ok: false, error: "Missing contact id." };

  const supabase = createServiceRoleClient();
  const { data: current, error: fetchErr } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (fetchErr || !current) return { ok: false, error: "Contact not found." };
  const contact = current as Contact;

  const patch: Record<string, unknown> = {};
  const appended: string[] = [];
  let headsUp: string | null = null;
  let applied = 0;
  let skipped = 0;

  for (const change of approved) {
    switch (change.kind) {
      case "set": {
        if (!ALLOWED_SETTABLE.has(change.field)) {
          skipped += 1;
          break;
        }
        const value = change.value.trim();
        if (!value) {
          skipped += 1;
          break;
        }
        if (SIZE_FIELDS.has(change.field)) {
          const upper = value.toUpperCase();
          if (!isValidSizeBand(upper)) {
            skipped += 1;
            break;
          }
          patch[change.field] = upper;
        } else {
          patch[change.field] = value;
        }
        applied += 1;
        break;
      }
      case "append_context": {
        // Date + source are rendered as a row header in the Context feed,
        // so the body itself is just the text.
        appended.push(change.text.trim());
        applied += 1;
        break;
      }
      case "heads_up": {
        // Last writer wins. Includes source so the team sees where it came from.
        headsUp = `${change.text.trim()}\n— Source: ${change.source.trim()}`;
        applied += 1;
        break;
      }
      case "suggest_tag":
      case "mention_person":
        // Not auto-applied. Should not appear in `approved` from the UI.
        skipped += 1;
        break;
    }
  }

  if (headsUp !== null) {
    // If a heads_up already exists, append the new one so we don't lose context.
    const existing = (contact.heads_up ?? "").trim();
    patch.heads_up = existing ? `${existing}\n\n${headsUp}` : headsUp;
  }

  if (Object.keys(patch).length > 0) {
    const { error: updateErr } = await supabase
      .from("contacts")
      .update(patch)
      .eq("id", contactId);
    if (updateErr) return { ok: false, error: updateErr.message };
  }

  // Context appends become individual rows in the contact_notes feed
  // tagged with source='paste'. Each one is independently editable.
  if (appended.length > 0) {
    const rows = appended.map((body) => ({
      contact_id: contactId,
      body,
      source: "paste" as const,
    }));
    const { error: insertErr } = await supabase
      .from("contact_notes")
      .insert(rows);
    if (insertErr) return { ok: false, error: insertErr.message };
  }

  revalidatePath(`/admin/c/${contactId}`);
  revalidatePath("/admin");
  return { ok: true, applied, skipped };
}

/**
 * Create a brand-new VIP from freeform pasted context alone. Runs the paste
 * through the same LLM parser used for the contact detail page, but against
 * a blank contact so every extractable field becomes a fresh value. Anything
 * that doesn't map to a structured field (and the original paste itself) is
 * stored as context notes so nothing is lost. Returns the new contact id so
 * the client can navigate to it.
 */
export async function createContactFromPaste(
  paste: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await isAdminAuthed())) {
    return { ok: false, error: "Not authenticated." };
  }
  const trimmed = paste.trim();
  if (!trimmed) return { ok: false, error: "Paste is empty." };
  if (trimmed.length > 20_000) {
    return { ok: false, error: "Paste is too long (max 20K chars)." };
  }

  // Blank contact so the parser proposes a value for every field it can find.
  const blank = {
    email: null,
    full_name: null,
    display_name: null,
    project: null,
    community: null,
    base_city: null,
    timezone: null,
    x_handle: null,
    instagram_handle: null,
    telegram_handle: null,
    wallet_address: null,
    phone: null,
    introduced_by: null,
    shipping_recipient: null,
    address_line1: null,
    address_line2: null,
    city_region: null,
    country: null,
    postal_code: null,
    shirt_size: null,
    pants_size: null,
    shorts_size: null,
    sweatshirt_size: null,
    shoe_size: null,
    hat_size: null,
  } as unknown as Contact;

  let diff: Diff;
  try {
    diff = await parsePasteDiff(blank, trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown LLM error.";
    return { ok: false, error: msg };
  }

  const insert: Record<string, unknown> = {
    lifecycle: "vip",
    source: "admin",
  };
  const notes: string[] = [];
  const tags = new Set<string>();
  let headsUp: string | null = null;

  for (const change of diff.changes) {
    switch (change.kind) {
      case "set": {
        if (!ALLOWED_SETTABLE.has(change.field)) break;
        const value = change.value.trim();
        if (!value) break;
        if (SIZE_FIELDS.has(change.field)) {
          const upper = value.toUpperCase();
          if (isValidSizeBand(upper)) insert[change.field] = upper;
        } else {
          insert[change.field] = value;
        }
        break;
      }
      case "append_context":
        notes.push(change.text.trim());
        break;
      case "heads_up":
        headsUp = `${change.text.trim()}\n— Source: ${change.source.trim()}`;
        break;
      case "suggest_tag":
        // For a fresh contact built from this paste, auto-apply suggested
        // tags — they came straight from the text the team is entering.
        tags.add(change.tag.trim().toLowerCase().replace(/\s+/g, "-"));
        break;
      case "mention_person":
        break;
    }
  }

  if (headsUp) insert.heads_up = headsUp;
  if (tags.size > 0) insert.tags = Array.from(tags);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contacts")
    .insert(insert)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed." };
  }

  // Always keep the original paste as the first note, plus any qualitative
  // context the parser pulled out. Each becomes an independent feed row.
  const noteRows = [
    { contact_id: data.id, body: trimmed, source: "paste" as const },
    ...notes.map((body) => ({
      contact_id: data.id,
      body,
      source: "paste" as const,
    })),
  ];
  await supabase.from("contact_notes").insert(noteRows);

  await notifyTelegram({ kind: "new_vip", contact_id: data.id as string });

  revalidatePath("/admin");
  return { ok: true, id: data.id as string };
}

/**
 * "Activate" a VIP / log a PR gift request. Creates a gift in the 'requested'
 * state and pings Simmone in Telegram with the contact's decision context
 * (handles, sizes, shipping). She replies there with / commands to record
 * what she sends, which flows straight back into this gift row.
 */
export async function activateVip(
  contactId: string,
  reason: string | null
): Promise<{ ok: true; gift_id: string } | { ok: false; error: string }> {
  if (!(await isAdminAuthed())) {
    return { ok: false, error: "Not authenticated." };
  }
  if (!contactId) return { ok: false, error: "Missing contact id." };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contact_gifts")
    .insert({
      contact_id: contactId,
      status: "requested",
      requested_at: new Date().toISOString(),
      request_reason: reason?.trim() || null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed." };
  }

  await notifyTelegram({
    kind: "activation",
    contact_id: contactId,
    gift_id: data.id as string,
    request_reason: reason?.trim() || null,
  });

  revalidatePath(`/admin/c/${contactId}`);
  revalidatePath("/admin");
  return { ok: true, gift_id: data.id as string };
}

/* ───── context notes feed ───── */

export async function addContactNote(formData: FormData) {
  await requireAdmin();
  const contact_id = s(formData.get("contact_id"));
  const body = s(formData.get("body"));
  if (!contact_id || !body) return;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contact_notes").insert({
    contact_id,
    body,
    author: nullable(formData.get("author")),
    source: "manual",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${contact_id}`);
}

export async function deleteContactNote(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  const contact_id = s(formData.get("contact_id"));
  if (!id || !contact_id) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("contact_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${contact_id}`);
}

/* ───── product catalog: drops ───── */

export async function listDrops(): Promise<
  Array<{ id: string; name: string; date: string | null; status: string }>
> {
  if (!(await isAdminAuthed())) return [];
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("drops")
    .select("id, name, date, status")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data;
}

export async function createDrop(
  name: string,
  date?: string | null
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await isAdminAuthed()))
    return { ok: false, error: "Not authenticated." };
  const n = name.trim();
  if (!n) return { ok: false, error: "Drop name required." };
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("drops")
    .insert({ name: n, date: date || null })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed." };
  }
  revalidatePath("/admin/products");
  return { ok: true, id: data.id };
}

/* ───── product catalog: products ───── */

const PRODUCT_FIELDS = [
  "name",
  "drop_id",
  "category",
  "image_url",
  "sizes",
  "inventory",
  "cost",
  "status",
  "notes",
];

export async function createProduct(payload: {
  name: string;
  drop_id?: string | null;
  category: string;
  image_url?: string | null;
  sizes: string[];
  inventory: Record<string, number | null>;
  cost?: number | null;
  notes?: string | null;
}): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string }
> {
  if (!(await isAdminAuthed()))
    return { ok: false, error: "Not authenticated." };
  const name = payload.name.trim();
  if (!name) return { ok: false, error: "Name required." };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      name,
      drop_id: payload.drop_id || null,
      category: payload.category,
      image_url: payload.image_url?.trim() || null,
      sizes: payload.sizes,
      inventory: payload.inventory,
      cost: payload.cost ?? null,
      notes: payload.notes?.trim() || null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed." };
  }
  revalidatePath("/admin/products");
  return { ok: true, id: data.id };
}

export async function updateProduct(
  id: string,
  patch: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isAdminAuthed()))
    return { ok: false, error: "Not authenticated." };
  if (!id) return { ok: false, error: "Missing id." };

  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (PRODUCT_FIELDS.includes(k)) safe[k] = v;
  }
  if (Object.keys(safe).length === 0)
    return { ok: false, error: "Empty patch." };

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("products")
    .update(safe)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function archiveProduct(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  if (!id) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("products")
    .update({ status: "archived" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/products");
}

export async function unarchiveProduct(formData: FormData) {
  await requireAdmin();
  const id = s(formData.get("id"));
  if (!id) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("products")
    .update({ status: "active" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/products");
}

/**
 * Log a gift sourced from the product catalog. Decrements inventory for
 * (product_id, size) when inventory tracking is enabled for that size
 * (i.e. the size has a non-null integer count). Untracked sizes pass
 * through with no decrement. Insufficient stock returns an error.
 */
export async function logGiftFromProduct(payload: {
  contact_id: string;
  product_id: string;
  size: string | null;
  status?: string;
  tracking?: string | null;
  notes?: string | null;
  logged_by?: string | null;
}): Promise<{ ok: true; gift_id: string } | { ok: false; error: string }> {
  if (!(await isAdminAuthed()))
    return { ok: false, error: "Not authenticated." };
  const { contact_id, product_id, size } = payload;
  if (!contact_id || !product_id) {
    return { ok: false, error: "Missing contact or product." };
  }

  const supabase = createServiceRoleClient();
  const { data: product, error: prodErr } = await supabase
    .from("products")
    .select("id, name, sizes, inventory, drop_id, drops(name)")
    .eq("id", product_id)
    .maybeSingle();
  if (prodErr || !product) {
    return { ok: false, error: "Product not found." };
  }

  // Sized products require a valid size.
  const sizes = (product.sizes ?? []) as string[];
  if (sizes.length > 0) {
    if (!size) {
      return { ok: false, error: "Size required for this product." };
    }
    if (!sizes.includes(size)) {
      return { ok: false, error: `Size ${size} not offered.` };
    }
  }

  // Inventory check + decrement (only if the size has a tracked count).
  const inventory = (product.inventory ?? {}) as Record<string, number | null>;
  let nextInventory: Record<string, number | null> | null = null;
  if (size && typeof inventory[size] === "number") {
    const remaining = inventory[size] as number;
    if (remaining <= 0) {
      return { ok: false, error: `// out. size ${size} depleted.` };
    }
    nextInventory = { ...inventory, [size]: remaining - 1 };
  }

  // Resolve drop name for legacy drop_name backfill column.
  const dropName =
    (product as unknown as { drops?: { name?: string } | null }).drops?.name ??
    null;

  const { data: gift, error: insertErr } = await supabase
    .from("contact_gifts")
    .insert({
      contact_id,
      product_id,
      size,
      item: product.name,
      drop_name: dropName,
      status: payload.status ?? "queued",
      tracking: payload.tracking ?? null,
      notes: payload.notes ?? null,
      logged_by: payload.logged_by ?? null,
    })
    .select("id")
    .maybeSingle();
  if (insertErr || !gift) {
    return { ok: false, error: insertErr?.message ?? "Insert failed." };
  }

  if (nextInventory) {
    const { error: invErr } = await supabase
      .from("products")
      .update({ inventory: nextInventory })
      .eq("id", product_id);
    if (invErr) {
      // Inventory bookkeeping failure — the gift row is already written,
      // surface the error but don't unwind.
      return { ok: false, error: `Logged but inventory update failed: ${invErr.message}` };
    }
  }

  revalidatePath(`/admin/c/${contact_id}`);
  revalidatePath("/admin/products");
  return { ok: true, gift_id: gift.id };
}

export async function listProductsForPicker(): Promise<
  Array<{
    id: string;
    name: string;
    image_url: string | null;
    category: string;
    sizes: string[];
    inventory: Record<string, number | null>;
    drop_id: string | null;
    drop_name: string | null;
  }>
> {
  if (!(await isAdminAuthed())) return [];
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, image_url, category, sizes, inventory, drop_id, drops(name)"
    )
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return data.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    image_url: (p.image_url as string | null) ?? null,
    category: p.category as string,
    sizes: (p.sizes as string[]) ?? [],
    inventory: (p.inventory as Record<string, number | null>) ?? {},
    drop_id: (p.drop_id as string | null) ?? null,
    drop_name:
      (p as unknown as { drops?: { name?: string } | null }).drops?.name ??
      null,
  }));
}
