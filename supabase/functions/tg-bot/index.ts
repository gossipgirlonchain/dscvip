/**
 * tg-bot — single webhook endpoint for the DSC gifting bot.
 *
 * Telegram fires every inbound update at /functions/v1/tg-bot. We:
 *   1. Verify the X-Telegram-Bot-Api-Secret-Token header.
 *   2. Reject anything not from the operator allowlist.
 *   3. Dispatch:
 *      - callback_query with `start_gift:<contact_id>`    → product picker
 *      - callback_query with `pick_product:<c>:<p>`        → size picker
 *      - callback_query with `pick_size:<c>:<p>:<s>`       → create gift
 *      - text message that's a reply_to_message            → tracking flow
 *
 * Every successful interaction writes a telegram_messages row so we can
 * follow the thread between Telegram and the gift ledger.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* ─────────────────────────────────────────────────────────────────────
   Types — minimal subset of the Telegram Bot API objects we touch.
   Full schema: https://core.telegram.org/bots/api
   ───────────────────────────────────────────────────────────────────── */

type TgUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

type TgChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
};

type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  reply_to_message?: TgMessage;
};

type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};

type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
};

type Contact = {
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
};

type Product = {
  id: string;
  name: string;
  category: string;
  sizes: string[];
  inventory: Record<string, number | null>;
  drop_id: string | null;
};

/* ─────────────────────────────────────────────────────────────────────
   Bootstrap
   ───────────────────────────────────────────────────────────────────── */

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const GIFTING_CHAT_ID = Deno.env.get("TELEGRAM_GIFTING_CHAT_ID") ?? "";
const OPERATOR_IDS = new Set(
  (Deno.env.get("TELEGRAM_OPERATOR_IDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function sb() {
  return createClient(SB_URL, SB_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

/* ─────────────────────────────────────────────────────────────────────
   Telegram API helpers
   ───────────────────────────────────────────────────────────────────── */

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

async function sendMessage(
  chatId: number | string,
  text: string,
  opts?: {
    reply_to_message_id?: number;
    reply_markup?: unknown;
    parse_mode?: "HTML" | "MarkdownV2";
  }
): Promise<TgMessage> {
  return tg<TgMessage>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: opts?.parse_mode ?? "HTML",
    reply_to_message_id: opts?.reply_to_message_id,
    reply_markup: opts?.reply_markup,
    disable_web_page_preview: true,
  });
}

async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  opts?: { reply_markup?: unknown; parse_mode?: "HTML" | "MarkdownV2" }
): Promise<void> {
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: opts?.parse_mode ?? "HTML",
    reply_markup: opts?.reply_markup,
    disable_web_page_preview: true,
  });
}

async function answerCallback(
  callbackId: string,
  text?: string
): Promise<void> {
  await tg("answerCallbackQuery", {
    callback_query_id: callbackId,
    text,
  });
}

/* ─────────────────────────────────────────────────────────────────────
   Auth + verification
   ───────────────────────────────────────────────────────────────────── */

function verifyTelegramSecret(req: Request): boolean {
  if (!WEBHOOK_SECRET) return true; // dev / unset
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  return got === WEBHOOK_SECRET;
}

function isOperator(userId: number | string | undefined): boolean {
  if (userId == null) return false;
  return OPERATOR_IDS.has(String(userId));
}

/* ─────────────────────────────────────────────────────────────────────
   HTML escape — Telegram's HTML parse_mode is conservative
   ───────────────────────────────────────────────────────────────────── */

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ─────────────────────────────────────────────────────────────────────
   Callback flows
   ───────────────────────────────────────────────────────────────────── */

async function handleStartGift(
  cq: TgCallbackQuery,
  contactId: string
): Promise<void> {
  const msg = cq.message;
  if (!msg) return;

  const supa = sb();
  const { data: contact, error: cErr } = await supa
    .from("contacts")
    .select("id, full_name, display_name, do_not_gift, address_line1")
    .eq("id", contactId)
    .maybeSingle();

  if (cErr || !contact) {
    await answerCallback(cq.id, "Contact not found.");
    return;
  }

  if (contact.do_not_gift) {
    await answerCallback(cq.id);
    await sendMessage(
      msg.chat.id,
      `⚠ <b>${esc(contact.display_name ?? contact.full_name)}</b> is flagged <code>do_not_gift</code>. Aborting.`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  if (!contact.address_line1 || contact.address_line1.trim() === "") {
    await answerCallback(cq.id);
    await sendMessage(
      msg.chat.id,
      `⚠ No shipping address on file for <b>${esc(contact.display_name ?? contact.full_name)}</b>. Add one in the admin first.`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  // Fetch active products, newest drop first.
  const { data: productsData } = await supa
    .from("products")
    .select("id, name, category, drop_id, drops(name, date, created_at)")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(20);

  type ProductRow = {
    id: string;
    name: string;
    category: string;
    drop_id: string | null;
    drops: { name: string } | null;
  };
  const products = (productsData ?? []) as ProductRow[];

  if (products.length === 0) {
    await answerCallback(cq.id);
    await sendMessage(
      msg.chat.id,
      `No active products in stock. Add one in /admin/products first.`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  const keyboard = {
    inline_keyboard: products.map((p) => [
      {
        text: `${p.name}${p.drops?.name ? ` · ${p.drops.name}` : ""}`,
        callback_data: `pick_product:${contactId}:${p.id}`,
      },
    ]),
  };

  await answerCallback(cq.id);
  await editMessageText(
    msg.chat.id,
    msg.message_id,
    `${msg.text ?? ""}\n\n— Pick a product for <b>${esc(contact.display_name ?? contact.full_name)}</b>:`,
    { reply_markup: keyboard }
  );
}

async function handlePickProduct(
  cq: TgCallbackQuery,
  contactId: string,
  productId: string
): Promise<void> {
  const msg = cq.message;
  if (!msg) return;

  const supa = sb();
  const [contactRes, productRes] = await Promise.all([
    supa
      .from("contacts")
      .select(
        "id, full_name, display_name, shirt_size, pants_size, shorts_size, sweatshirt_size, shoe_size, hat_size"
      )
      .eq("id", contactId)
      .maybeSingle(),
    supa
      .from("products")
      .select("id, name, category, sizes, inventory")
      .eq("id", productId)
      .maybeSingle(),
  ]);

  const contact = contactRes.data as Contact | null;
  const product = productRes.data as Product | null;
  if (!contact || !product) {
    await answerCallback(cq.id, "Lookup failed.");
    return;
  }

  // Smart preselect: highlight the size matching the contact's profile.
  const categoryToSizeField: Record<string, keyof Contact | null> = {
    apparel: "shirt_size",
    accessory: "hat_size",
    print: null,
    hardware: null,
    consumable: null,
  };
  const preferredField = categoryToSizeField[product.category];
  const preferred =
    preferredField && contact[preferredField]
      ? String(contact[preferredField])
      : null;

  const sizes =
    product.sizes.length > 0 ? product.sizes : ["OS"]; // one-size fallback

  const keyboard = {
    inline_keyboard: sizes.map((s) => {
      const stock = product.inventory?.[s];
      const outOfStock = stock === 0;
      const isPreferred = preferred === s;
      const star = isPreferred ? "★ " : "";
      const stockNote =
        stock == null
          ? ""
          : outOfStock
            ? " · out"
            : ` · ${stock} left`;
      return [
        {
          text: `${star}${s}${stockNote}`,
          callback_data: outOfStock
            ? "noop"
            : `pick_size:${contactId}:${productId}:${s}`,
        },
      ];
    }),
  };

  await answerCallback(cq.id);
  await editMessageText(
    msg.chat.id,
    msg.message_id,
    `${msg.text ?? ""}\n\n— Pick a size for <b>${esc(product.name)}</b>${
      preferred ? ` (★ matches ${esc(contact.display_name ?? contact.full_name)}'s ${preferredField})` : ""
    }:`,
    { reply_markup: keyboard }
  );
}

async function handlePickSize(
  cq: TgCallbackQuery,
  contactId: string,
  productId: string,
  size: string
): Promise<void> {
  const msg = cq.message;
  if (!msg) return;

  const supa = sb();
  const [contactRes, productRes] = await Promise.all([
    supa
      .from("contacts")
      .select("id, full_name, display_name")
      .eq("id", contactId)
      .maybeSingle(),
    supa
      .from("products")
      .select("id, name, drop_id, drops(name)")
      .eq("id", productId)
      .maybeSingle(),
  ]);
  type ProductWithDrop = {
    id: string;
    name: string;
    drop_id: string | null;
    drops: { name: string } | null;
  };
  const contact = contactRes.data as Pick<
    Contact,
    "id" | "full_name" | "display_name"
  > | null;
  const product = productRes.data as ProductWithDrop | null;
  if (!contact || !product) {
    await answerCallback(cq.id, "Lookup failed.");
    return;
  }

  const operator = cq.from.username ?? cq.from.first_name ?? "simonne";

  // Create the gift row. Status starts at 'packed' — by the time Simonne
  // is picking, the gift is about to ship.
  const { data: gift, error: insErr } = await supa
    .from("contact_gifts")
    .insert({
      contact_id: contactId,
      product_id: productId,
      drop_id: product.drop_id,
      size,
      status: "packed",
      packed_at: new Date().toISOString(),
      logged_by: operator,
    })
    .select("id")
    .single();

  if (insErr || !gift) {
    await answerCallback(cq.id, "Couldn't create gift.");
    return;
  }

  await answerCallback(cq.id, "Gift created.");

  const giftMsg = await sendMessage(
    msg.chat.id,
    `<b>Gift created</b> for <b>${esc(contact.display_name ?? contact.full_name)}</b>\n` +
      `· Product: ${esc(product.name)}\n` +
      `· Size: <code>${esc(size)}</code>\n` +
      `· Drop: ${esc(product.drops?.name ?? "—")}\n` +
      `· Logged by: ${esc(operator)}\n\n` +
      `<i>Reply to this message with the tracking number once it ships.</i>`,
    { reply_to_message_id: msg.message_id }
  );

  // Strip the keyboard from the original ping.
  try {
    await editMessageText(
      msg.chat.id,
      msg.message_id,
      `${msg.text ?? ""}\n\n✓ Gift created — ${esc(product.name)} / ${esc(size)}`,
      {}
    );
  } catch {
    /* not fatal — bot might not own the message anymore */
  }

  await supa.from("telegram_messages").insert({
    message_id: giftMsg.message_id,
    chat_id: msg.chat.id,
    gift_id: gift.id,
    contact_id: contactId,
    kind: "gift_started",
  });
}

/* ─────────────────────────────────────────────────────────────────────
   Tracking reply
   ───────────────────────────────────────────────────────────────────── */

async function handleTrackingReply(message: TgMessage): Promise<void> {
  const replyTo = message.reply_to_message;
  if (!replyTo) return;
  if (!message.text) return;
  // Sanity: strip whitespace; tracking numbers can include spaces, but the
  // raw text without surrounding whitespace is what we store.
  const trackingRaw = message.text.trim();
  if (trackingRaw.length < 6 || trackingRaw.length > 60) return;

  const supa = sb();

  // Find the gift this reply maps to.
  const { data: link } = await supa
    .from("telegram_messages")
    .select("gift_id")
    .eq("chat_id", message.chat.id)
    .eq("message_id", replyTo.message_id)
    .eq("kind", "gift_started")
    .maybeSingle();

  if (!link?.gift_id) {
    await sendMessage(
      message.chat.id,
      `Reply to the gift confirmation message specifically — I can't tell which gift this tracking number is for.`,
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  // Save the tracking number on the gift, flip to shipped.
  const { error: updErr } = await supa
    .from("contact_gifts")
    .update({
      tracking: trackingRaw,
      status: "shipped",
      sent_at: new Date().toISOString(),
    })
    .eq("id", link.gift_id);

  if (updErr) {
    await sendMessage(
      message.chat.id,
      `Couldn't save tracking: ${esc(updErr.message)}`,
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  // Log the reply.
  await supa.from("telegram_messages").insert({
    message_id: message.message_id,
    chat_id: message.chat.id,
    gift_id: link.gift_id,
    kind: "tracking_reply",
    code: trackingRaw,
  });

  await sendMessage(
    message.chat.id,
    `Tracking saved — <code>${esc(trackingRaw)}</code>. Status flipped to <b>shipped</b>. Mark delivered manually in /admin for now.`,
    { reply_to_message_id: message.message_id }
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Update dispatcher
   ───────────────────────────────────────────────────────────────────── */

async function handleUpdate(update: TgUpdate): Promise<void> {
  // Callback query (button taps on the inline keyboards)
  if (update.callback_query) {
    const cq = update.callback_query;
    if (!isOperator(cq.from.id)) {
      await answerCallback(cq.id, "Not authorized.");
      return;
    }

    const data = cq.data ?? "";
    if (data === "noop") {
      await answerCallback(cq.id, "Out of stock.");
      return;
    }

    const parts = data.split(":");
    const verb = parts[0];

    if (verb === "start_gift" && parts.length === 2) {
      await handleStartGift(cq, parts[1]);
    } else if (verb === "pick_product" && parts.length === 3) {
      await handlePickProduct(cq, parts[1], parts[2]);
    } else if (verb === "pick_size" && parts.length === 4) {
      await handlePickSize(cq, parts[1], parts[2], parts[3]);
    } else {
      await answerCallback(cq.id, "Unknown action.");
    }
    return;
  }

  // Text message — only matters if it's a reply (tracking flow).
  if (update.message) {
    const msg = update.message;
    if (!isOperator(msg.from?.id)) return;
    if (msg.reply_to_message && msg.text) {
      await handleTrackingReply(msg);
    }
    return;
  }
}

/* ─────────────────────────────────────────────────────────────────────
   Entrypoint
   ───────────────────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  if (!verifyTelegramSecret(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  // Process inside a try so transient errors don't poison Telegram's
  // delivery retry — we always 200 once we've accepted the update.
  try {
    await handleUpdate(update);
  } catch (e) {
    console.error("handleUpdate error", e);
  }

  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
});
