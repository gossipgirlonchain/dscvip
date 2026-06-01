// DSC Telegram bot — gifting ops for Simmone.
//
// Two responsibilities, routed by URL suffix:
//   POST .../telegram-bot/notify   ← the Next app, on new VIP / activation.
//                                     Sends a Telegram message into the team
//                                     group and records message_id ↔ gift so
//                                     a later reply can resolve its target.
//   POST .../telegram-bot          ← Telegram webhook. Simmone replies to a
//                                     notification with a / command; we apply
//                                     the change to the CRM and confirm.
//
// Deploy with verify_jwt = false (Telegram and the internal caller don't send
// a Supabase JWT — they authenticate via their own secrets, checked below).

import { createClient } from "jsr:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const NOTIFY_SECRET = Deno.env.get("INTERNAL_NOTIFY_SECRET")!;
// Comma-separated Telegram user IDs allowed to run commands. Empty = anyone
// in the configured group.
const ALLOWED_USER_IDS = (Deno.env.get("TELEGRAM_ALLOWED_USER_IDS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

/* ── Telegram helpers ─────────────────────────────────────────────────── */

async function tgSend(
  text: string,
  opts: { reply_to_message_id?: number } = {},
): Promise<{ message_id: number } | null> {
  const res = await fetch(`${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...opts,
    }),
  });
  const json = await res.json();
  return json.ok ? { message_id: json.result.message_id } : null;
}

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function code4(): string {
  return Array.from({ length: 4 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]
  ).join("");
}

/* ── Message formatting ───────────────────────────────────────────────── */

// deno-lint-ignore no-explicit-any
function name(c: any): string {
  return c.display_name || c.full_name || "Unnamed VIP";
}

// deno-lint-ignore no-explicit-any
function handles(c: any): string {
  const parts: string[] = [];
  if (c.x_handle) parts.push(`X ${esc(c.x_handle)}`);
  if (c.instagram_handle) parts.push(`IG ${esc(c.instagram_handle)}`);
  if (c.telegram_handle) parts.push(`TG ${esc(c.telegram_handle)}`);
  return parts.join(" · ");
}

// deno-lint-ignore no-explicit-any
function sizes(c: any): string {
  const s = [
    c.shirt_size && `shirt ${c.shirt_size}`,
    c.pants_size && `pants ${c.pants_size}`,
    c.shorts_size && `shorts ${c.shorts_size}`,
    c.sweatshirt_size && `sweat ${c.sweatshirt_size}`,
    c.hat_size && `hat ${c.hat_size}`,
    c.shoe_size && `shoe ${esc(c.shoe_size)}`,
  ].filter(Boolean);
  return s.length ? s.join(" · ") : "no sizes on file";
}

// deno-lint-ignore no-explicit-any
function location(c: any): string {
  return [c.base_city, c.country].filter(Boolean).map(esc).join(", ");
}

// deno-lint-ignore no-explicit-any
function shipTo(c: any): string {
  const lines = [
    c.shipping_recipient || c.full_name,
    c.address_line1,
    c.address_line2,
    [c.city_region, c.postal_code].filter(Boolean).join(" "),
    c.country,
  ].filter(Boolean).map(esc);
  return lines.length ? lines.join("\n") : "⚠️ no address on file";
}

// deno-lint-ignore no-explicit-any
function tags(c: any): string {
  return c.tags?.length ? c.tags.map(esc).join(", ") : "none";
}

/* ── /notify (from the Next app) ──────────────────────────────────────── */

async function handleNotify(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${NOTIFY_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.kind || !body?.contact_id) {
    return new Response("Bad request", { status: 400 });
  }

  const { data: c } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", body.contact_id)
    .maybeSingle();
  if (!c) return new Response("Contact not found", { status: 404 });

  let text: string;
  const code = body.gift_id ? code4() : null;

  if (body.kind === "new_vip") {
    text =
      `🆕 <b>New VIP — ${esc(name(c))}</b>\n` +
      `${handles(c)}${location(c) ? `  ·  ${location(c)}` : ""}\n` +
      `tags: ${tags(c)}\n` +
      `sizes: ${sizes(c)}`;
  } else if (body.kind === "activation") {
    text =
      `🎁 <b>Gift request — ${esc(name(c))}</b>  <code>#${code}</code>\n` +
      (body.request_reason ? `${esc(body.request_reason)}\n` : "") +
      `${handles(c)}\n` +
      `${[esc(c.project), location(c)].filter(Boolean).join(" · ")}\n` +
      `tags: ${tags(c)}\n` +
      `sizes: ${sizes(c)}\n\n` +
      `📦 <b>ship to:</b>\n${shipTo(c)}\n\n` +
      `reply: /sent &lt;items&gt; · /ship &lt;tracking&gt; · /skip &lt;reason&gt;`;
  } else {
    return new Response("Unknown kind", { status: 400 });
  }

  const sent = await tgSend(text);
  if (!sent) return new Response("Telegram send failed", { status: 502 });

  await supabase.from("telegram_messages").insert({
    message_id: sent.message_id,
    chat_id: Number(CHAT_ID),
    gift_id: body.gift_id ?? null,
    contact_id: body.contact_id,
    kind: body.kind,
    code,
  });

  return Response.json({ ok: true, message_id: sent.message_id, code });
}

/* ── webhook (Simmone's commands) ─────────────────────────────────────── */

const HELP =
  "DSC bot commands (reply to a gift request):\n" +
  "/sent <items> — record what you sent\n" +
  "/ship <tracking> — mark shipped + tracking\n" +
  "/delivered — mark delivered\n" +
  "/posted <url> — mark posted\n" +
  "/skip <reason> — decline (out of stock, bad address…)";

// deno-lint-ignore no-explicit-any
async function resolveGiftId(msg: any, args: string): Promise<string | null> {
  // 1. Reply to a notification we sent.
  if (msg.reply_to_message) {
    const { data } = await supabase
      .from("telegram_messages")
      .select("gift_id")
      .eq("chat_id", msg.chat.id)
      .eq("message_id", msg.reply_to_message.message_id)
      .maybeSingle();
    if (data?.gift_id) return data.gift_id;
  }
  // 2. Leading #CODE / CODE token in the args.
  const m = args.match(/^#?([A-Z0-9]{4})\b/i);
  if (m) {
    const { data } = await supabase
      .from("telegram_messages")
      .select("gift_id")
      .eq("code", m[1].toUpperCase())
      .order("created_at", { ascending: false })
      .maybeSingle();
    if (data?.gift_id) return data.gift_id;
  }
  return null;
}

function stripCode(args: string): string {
  return args.replace(/^#?[A-Z0-9]{4}\b\s*/i, "").trim();
}

async function handleWebhook(req: Request): Promise<Response> {
  if (
    req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  // We only act on text commands in the configured group.
  if (!msg?.text || String(msg.chat?.id) !== String(CHAT_ID)) {
    return Response.json({ ok: true });
  }
  if (
    ALLOWED_USER_IDS.length > 0 &&
    !ALLOWED_USER_IDS.includes(String(msg.from?.id))
  ) {
    return Response.json({ ok: true });
  }

  const text = msg.text.trim();
  if (!text.startsWith("/")) return Response.json({ ok: true });

  // /cmd@BotName args…
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.slice(1).split("@")[0].toLowerCase();
  const argStr = rest.join(" ").trim();

  const reply = (t: string) =>
    tgSend(t, { reply_to_message_id: msg.message_id });

  if (cmd === "help" || cmd === "start") {
    await reply(HELP);
    return Response.json({ ok: true });
  }

  const giftId = await resolveGiftId(msg, argStr);
  if (!giftId) {
    await reply(
      "⚠️ Couldn't tell which gift. Reply to its request message, or include the #CODE.",
    );
    return Response.json({ ok: true });
  }
  const args = stripCode(argStr);
  const now = new Date().toISOString();
  const by = msg.from?.username
    ? `@${msg.from.username}`
    : msg.from?.first_name ?? "telegram";

  // deno-lint-ignore no-explicit-any
  let patch: Record<string, any> | null = null;
  let confirm = "";

  switch (cmd) {
    case "sent":
      if (!args) {
        await reply("Usage: /sent <items> — e.g. /sent black hoodie M + cap");
        return Response.json({ ok: true });
      }
      patch = { item: args, status: "queued", logged_by: by };
      confirm = `✅ Recorded: ${args}`;
      break;
    case "ship":
      if (!args) {
        await reply("Usage: /ship <tracking>");
        return Response.json({ ok: true });
      }
      patch = { tracking: args, status: "shipped", sent_at: now, logged_by: by };
      confirm = `🚚 Shipped — tracking ${args}`;
      break;
    case "delivered":
      patch = { status: "delivered", delivered_at: now };
      confirm = "📬 Marked delivered";
      break;
    case "posted":
      patch = { status: "posted", posted_at: now, posted_url: args || null };
      confirm = args ? `⭐ Posted — ${args}` : "⭐ Marked posted";
      break;
    case "skip":
    case "blocked":
      patch = { status: "skipped", skipped_at: now, skip_reason: args || null };
      confirm = args ? `⏭️ Skipped — ${args}` : "⏭️ Skipped";
      break;
    default:
      await reply(`Unknown command /${cmd}.\n\n${HELP}`);
      return Response.json({ ok: true });
  }

  const { error } = await supabase
    .from("contact_gifts")
    .update(patch)
    .eq("id", giftId);
  if (error) {
    await reply(`❌ Couldn't save: ${error.message}`);
    return Response.json({ ok: true });
  }
  await reply(confirm);
  return Response.json({ ok: true });
}

/* ── entrypoint ───────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("OK");
  const url = new URL(req.url);
  if (url.pathname.endsWith("/notify")) return handleNotify(req);
  return handleWebhook(req);
});
