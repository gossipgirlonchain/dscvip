/**
 * tg-signup-ping — Supabase DB-webhook target. Fires on contacts INSERT
 * (and on UPDATE if you wire it that way) and posts a message to the
 * gifting Telegram group telling Simonne a new VIP just signed up.
 *
 * Wiring: Database → Webhooks → on contacts INSERT → POST to
 *   https://<project>.supabase.co/functions/v1/tg-signup-ping
 * with header: X-Webhook-Secret: <SUPABASE_WEBHOOK_SECRET>
 *
 * Filters:
 *   - source must be 'public' (came via the invite link)
 *   - token must NOT be null (rules out manually-added)
 *   - do_not_gift must be false
 *
 * Dedupe: only one signup_ping per contact, ever.
 *
 * Body shape (Supabase database webhook):
 * {
 *   "type": "INSERT",
 *   "table": "contacts",
 *   "schema": "public",
 *   "record": { ...the full row... },
 *   "old_record": null
 * }
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const GIFTING_CHAT_ID = Deno.env.get("TELEGRAM_GIFTING_CHAT_ID") ?? "";
const SUPABASE_WEBHOOK_SECRET =
  Deno.env.get("SUPABASE_WEBHOOK_SECRET") ?? "";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function sb() {
  return createClient(SB_URL, SB_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg<T>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  }
  return json.result as T;
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type ContactRow = {
  id: string;
  full_name: string;
  display_name: string | null;
  email: string;
  shipping_recipient: string | null;
  address_line1: string;
  address_line2: string | null;
  city_region: string;
  country: string;
  postal_code: string;
  address_verified: boolean;
  shirt_size: string;
  pants_size: string;
  shorts_size: string;
  sweatshirt_size: string;
  shoe_size: string | null;
  hat_size: string | null;
  x_handle: string | null;
  instagram_handle: string | null;
  telegram_handle: string | null;
  community: string | null;
  base_city: string | null;
  heads_up: string | null;
  do_not_gift: boolean;
  source: string;
  token: string | null;
  lifecycle: string;
};

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: ContactRow | null;
  old_record: ContactRow | null;
};

function buildSignupMessage(c: ContactRow): string {
  const name = c.display_name ?? c.full_name;
  const shipName = c.shipping_recipient ?? c.full_name;
  const lines: string[] = [];

  lines.push(`<b>🛎 NEW VIP SIGNUP</b>`);
  lines.push(``);
  lines.push(`<b>${esc(name)}</b>`);

  const sub: string[] = [];
  if (c.community) sub.push(c.community);
  if (c.base_city) sub.push(c.base_city);
  if (sub.length) lines.push(`<i>${esc(sub.join(" · "))}</i>`);

  // Shipping block — single copy-pasteable chunk
  lines.push(``);
  lines.push(`<b>Ship to</b>`);
  lines.push(esc(shipName));
  lines.push(esc(c.address_line1));
  if (c.address_line2) lines.push(esc(c.address_line2));
  lines.push(esc(`${c.city_region} ${c.postal_code}`));
  lines.push(esc(c.country));

  if (!c.address_verified) {
    lines.push(`<i>⚠ address not verified</i>`);
  }

  // Sizes
  const sizes: string[] = [];
  sizes.push(`Shirt ${c.shirt_size}`);
  sizes.push(`Pants ${c.pants_size}`);
  sizes.push(`Shorts ${c.shorts_size}`);
  sizes.push(`Sweat ${c.sweatshirt_size}`);
  if (c.shoe_size) sizes.push(`Shoe ${c.shoe_size}`);
  if (c.hat_size) sizes.push(`Hat ${c.hat_size}`);
  lines.push(``);
  lines.push(`<b>Sizes</b>`);
  lines.push(esc(sizes.join(" · ")));

  // Handles + email
  const handles: string[] = [];
  if (c.telegram_handle) handles.push(`TG ${c.telegram_handle}`);
  if (c.x_handle) handles.push(`X ${c.x_handle}`);
  if (c.instagram_handle) handles.push(`IG ${c.instagram_handle}`);
  handles.push(c.email);
  lines.push(``);
  lines.push(esc(handles.join(" · ")));

  if (c.heads_up) {
    lines.push(``);
    lines.push(`<b>⚠ Heads up</b>`);
    lines.push(esc(c.heads_up));
  }

  if (c.do_not_gift) {
    lines.push(``);
    lines.push(`<i>🚫 Flagged do_not_gift — gift creation blocked.</i>`);
  }

  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  // Verify shared secret. We accept either the standard Supabase header
  // or a custom X-Webhook-Secret so the user can configure either.
  const secretHeader =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer /, "") ??
    "";
  if (SUPABASE_WEBHOOK_SECRET && secretHeader !== SUPABASE_WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  if (payload.type !== "INSERT" || payload.table !== "contacts") {
    return new Response("ignored", { status: 200 });
  }

  const c = payload.record;
  if (!c) return new Response("no record", { status: 200 });

  // Filter: only ping for public invite-link signups.
  if (c.source !== "public" || !c.token) {
    return new Response("not a public signup", { status: 200 });
  }

  if (c.do_not_gift) {
    return new Response("do_not_gift; skipping ping", { status: 200 });
  }

  if (!GIFTING_CHAT_ID || !BOT_TOKEN) {
    console.error("Missing TELEGRAM_GIFTING_CHAT_ID or TELEGRAM_BOT_TOKEN");
    return new Response("misconfigured", { status: 500 });
  }

  // Dedupe — one signup_ping per contact ever.
  const supa = sb();
  const { data: existing } = await supa
    .from("telegram_messages")
    .select("id")
    .eq("contact_id", c.id)
    .eq("kind", "signup_ping")
    .maybeSingle();

  if (existing) {
    return new Response("already pinged", { status: 200 });
  }

  const text = buildSignupMessage(c);

  type SentMessage = { message_id: number; chat: { id: number } };
  const sent = await tg<SentMessage>("sendMessage", {
    chat_id: GIFTING_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🎁 Start gift →",
            callback_data: `start_gift:${c.id}`,
          },
        ],
      ],
    },
  });

  await supa.from("telegram_messages").insert({
    message_id: sent.message_id,
    chat_id: sent.chat.id,
    contact_id: c.id,
    kind: "signup_ping",
  });

  return new Response("pinged", { status: 200 });
});
