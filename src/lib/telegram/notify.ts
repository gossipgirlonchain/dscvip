import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Fire-and-forget Telegram notification. Runs server-side on Vercel.
 *
 * Talks directly to api.telegram.org — no relay edge function — using:
 *   - TELEGRAM_BOT_TOKEN
 *   - TELEGRAM_GIFTING_CHAT_ID
 *
 * The previous relay path (EDGE_NOTIFY_URL / INTERNAL_NOTIFY_SECRET) is
 * gone; you can delete those Vercel env vars.
 *
 * Best-effort: a failing notification must NEVER block the CRM write that
 * triggered it. Every failure mode is logged so it shows up in Vercel
 * runtime logs (look for `[tg-notify]` prefix).
 */
type NotifyPayload =
  | { kind: "new_vip"; contact_id: string }
  | {
      kind: "activation";
      contact_id: string;
      gift_id: string;
      request_reason?: string | null;
    };

const LOG_PREFIX = "[tg-notify]";

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
};

function buildNewVipMessage(c: ContactRow): string {
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

function buildActivationMessage(
  c: ContactRow,
  giftId: string,
  reason?: string | null
): string {
  const name = c.display_name ?? c.full_name;
  const lines: string[] = [];
  lines.push(`<b>⚡ ACTIVATION</b>`);
  lines.push(``);
  lines.push(`<b>${esc(name)}</b>`);
  if (reason) {
    lines.push(``);
    lines.push(esc(reason));
  }
  lines.push(``);
  lines.push(
    `<i>Gift record created (id ${esc(giftId.slice(0, 8))}…). Pick a product to ship.</i>`
  );
  return lines.join("\n");
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>
): Promise<{ ok: boolean; status?: number; body?: string }> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      body: `fetch threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const responseText = await res.text();
  return { ok: res.ok, status: res.status, body: responseText };
}

export async function notifyTelegram(payload: NotifyPayload): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GIFTING_CHAT_ID;

  // Loud, prefixed logs so failures jump out in Vercel runtime logs.
  if (!botToken) {
    console.error(`${LOG_PREFIX} TELEGRAM_BOT_TOKEN is not set`);
    return;
  }
  if (!chatId) {
    console.error(`${LOG_PREFIX} TELEGRAM_GIFTING_CHAT_ID is not set`);
    return;
  }

  console.log(
    `${LOG_PREFIX} sending kind=${payload.kind} contact=${payload.contact_id}`
  );

  try {
    const supabase = createServiceRoleClient();
    const { data: contact, error } = await supabase
      .from("contacts")
      .select(
        "id, full_name, display_name, email, shipping_recipient, address_line1, address_line2, city_region, country, postal_code, address_verified, shirt_size, pants_size, shorts_size, sweatshirt_size, shoe_size, hat_size, x_handle, instagram_handle, telegram_handle, community, base_city, heads_up, do_not_gift"
      )
      .eq("id", payload.contact_id)
      .maybeSingle();

    if (error) {
      console.error(`${LOG_PREFIX} supabase fetch failed:`, error.message);
      return;
    }
    if (!contact) {
      console.error(
        `${LOG_PREFIX} contact ${payload.contact_id} not found in DB`
      );
      return;
    }

    const c = contact as ContactRow;

    let text: string;
    let keyboard:
      | Array<Array<{ text: string; callback_data: string }>>
      | undefined;

    if (payload.kind === "new_vip") {
      text = buildNewVipMessage(c);
      keyboard = c.do_not_gift
        ? undefined
        : [
            [
              {
                text: "🎁 Start gift →",
                callback_data: `start_gift:${c.id}`,
              },
            ],
          ];
    } else {
      text = buildActivationMessage(c, payload.gift_id, payload.request_reason);
      keyboard = [
        [
          {
            text: "🎁 Pick product →",
            callback_data: `start_gift:${c.id}`,
          },
        ],
      ];
    }

    const result = await sendTelegramMessage(botToken, chatId, text, keyboard);

    if (!result.ok) {
      console.error(
        `${LOG_PREFIX} Telegram sendMessage failed: status=${result.status} body=${result.body}`
      );
      return;
    }

    console.log(
      `${LOG_PREFIX} delivered kind=${payload.kind} contact=${payload.contact_id}`
    );
  } catch (e) {
    console.error(`${LOG_PREFIX} unexpected error:`, e);
  }
}
