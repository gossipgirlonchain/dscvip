"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAdminAuthed, clearAdminCookie } from "@/lib/admin-auth";
import type {
  GiftStatus,
  Lifecycle,
  TouchChannel,
} from "@/types/db";

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
  const allowed: GiftStatus[] = ["queued", "shipped", "delivered", "posted"];
  if (!allowed.includes(status)) return;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (status === "shipped") patch.sent_at = now;
  if (status === "delivered") patch.delivered_at = now;
  if (status === "posted") {
    patch.posted_at = now;
    const url = nullable(formData.get("posted_url"));
    if (url) patch.posted_url = url;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("contact_gifts")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/c/${contact_id}`);
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
