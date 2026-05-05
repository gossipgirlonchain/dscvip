"use server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { SIZE_BANDS, type SizeBand } from "@/types/db";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string };

function asSize(v: FormDataEntryValue | null): SizeBand | null {
  const s = String(v ?? "").trim().toUpperCase();
  return (SIZE_BANDS as readonly string[]).includes(s) ? (s as SizeBand) : null;
}

function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

/**
 * Submit a signup. `token` is optional — when null, the signup is recorded
 * untagged (used by the public root URL where the URL itself is the secret).
 * When set, the token is validated and its use_count is incremented.
 */
export async function submitSignup(
  token: string | null,
  formData: FormData
): Promise<SubmitResult> {
  const email = str(formData.get("email"));
  const full_name = str(formData.get("full_name"));
  const address_line1 = str(formData.get("address_line1"));
  const address_line2 = str(formData.get("address_line2")) || null;
  const city_region = str(formData.get("city_region"));
  const country = str(formData.get("country"));
  const postal_code = str(formData.get("postal_code"));

  const x_handle = str(formData.get("x_handle")) || null;
  const instagram_handle = str(formData.get("instagram_handle")) || null;

  const shirt_size = asSize(formData.get("shirt_size"));
  const pants_size = asSize(formData.get("pants_size"));
  const shorts_size = asSize(formData.get("shorts_size"));
  const sweatshirt_size = asSize(formData.get("sweatshirt_size"));
  const shoe_size = str(formData.get("shoe_size")) || null;
  const hat_size = asSize(formData.get("hat_size"));

  const required = {
    email,
    full_name,
    address_line1,
    city_region,
    country,
    postal_code,
  };
  for (const [k, v] of Object.entries(required)) {
    if (!v) return { ok: false, error: `Missing ${k.replace("_", " ")}.` };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email looks invalid." };
  }
  if (!shirt_size || !pants_size || !shorts_size || !sweatshirt_size) {
    return { ok: false, error: "Pick a size for shirts, pants, shorts, and sweatshirts." };
  }

  const supabase = createServiceRoleClient();

  // Optional token validation. When token is null we skip — the URL itself
  // is the secret on the public root path.
  if (token) {
    const { data: invite, error: tokenErr } = await supabase
      .from("gifting_invite_tokens")
      .select("token, revoked_at, expires_at, max_uses, use_count")
      .eq("token", token)
      .maybeSingle();

    if (tokenErr || !invite) {
      return { ok: false, error: "This link is no longer valid." };
    }
    if (invite.revoked_at) {
      return { ok: false, error: "This link has been revoked." };
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return { ok: false, error: "This link has expired." };
    }
    if (invite.max_uses != null && invite.use_count >= invite.max_uses) {
      return { ok: false, error: "This link has reached its limit." };
    }
  }

  const { error: insertErr } = await supabase.from("gifting_signups").insert({
    token,
    email,
    full_name,
    address_line1,
    address_line2,
    city_region,
    country,
    postal_code,
    x_handle,
    instagram_handle,
    shirt_size,
    pants_size,
    shorts_size,
    sweatshirt_size,
    shoe_size,
    hat_size,
    source: "public",
  });

  if (insertErr) {
    return { ok: false, error: "Couldn’t save — try again in a moment." };
  }

  if (token) {
    // Best-effort use-count bump; not fatal if it fails.
    const { data: invite } = await supabase
      .from("gifting_invite_tokens")
      .select("use_count")
      .eq("token", token)
      .maybeSingle();
    if (invite) {
      await supabase
        .from("gifting_invite_tokens")
        .update({ use_count: (invite.use_count ?? 0) + 1 })
        .eq("token", token);
    }
  }

  return { ok: true };
}
