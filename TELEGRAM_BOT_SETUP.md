# DSC Gifting Telegram Bot — Setup

The bot is deployed as two Supabase Edge Functions on project
`juhlwmisnahmgyexmfhm`:

- `tg-bot` — receives all Telegram updates (commands + button taps + tracking replies)
- `tg-signup-ping` — receives Supabase DB webhooks on new VIP signups and posts the alert to the gifting group

This doc walks you through the four steps to bring it online.

---

## 1. Create the bot via @BotFather

In Telegram, open `@BotFather`:

1. `/newbot`
2. Give it a display name like **DSC Gifting**
3. Give it a username like `dsc_gifting_bot` (must end in `_bot`)
4. Copy the **bot token** that BotFather returns. Looks like
   `1234567890:AAH…`. Treat this like a password.

Then in the same chat, lock down the bot's privacy so it can see all messages in a group it's added to (it can't read messages by default in groups):

```
/setprivacy
choose the bot
Disable
```

This is required so the bot can see Simonne's `reply_to_message` tracking
numbers in the group.

---

## 2. Create the gifting group + add the bot

1. New Telegram **group** called **DSC Gifting** (not a channel)
2. Add the bot you just created as a member, make it an **admin** of the group
3. Send one message in the group, anything (`hi`)
4. Find the group's **chat ID**:

   ```sh
   curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
   ```

   Look for `"chat":{"id":-100…}` in the response. Group IDs are
   negative. Copy that whole negative number (e.g. `-1001234567890`).

Also get Simonne's **Telegram user ID** (and anyone else who should be
allowed to control the bot — you, Anthony):

- Open Telegram → send a message to `@userinfobot`
- It replies with your numeric user ID
- Each operator needs to do this once and send you the number

---

## 3. Set Supabase secrets

In the Supabase dashboard for project `juhlwmisnahmgyexmfhm`:

**Settings → Edge Functions → Secrets**, add:

| Secret name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from @BotFather |
| `TELEGRAM_GIFTING_CHAT_ID` | the negative group chat ID |
| `TELEGRAM_OPERATOR_IDS` | comma-separated user IDs: `123,456,789` |
| `TELEGRAM_WEBHOOK_SECRET` | generate one: `openssl rand -hex 32` |
| `SUPABASE_WEBHOOK_SECRET` | generate another: `openssl rand -hex 32` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-set by Supabase
on edge functions — you don't need to add them.

---

## 4. Register the Telegram webhook

Point Telegram at the `tg-bot` function. Replace both secrets in this command:

```sh
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://juhlwmisnahmgyexmfhm.supabase.co/functions/v1/tg-bot",
    "secret_token": "<YOUR_TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Telegram should respond `{"ok":true,"result":true,"description":"Webhook was set"}`.

Verify with:

```sh
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

Look for `"url":"https://juhlwmisnahmgyexmfhm.supabase.co/functions/v1/tg-bot"`
and `"pending_update_count":0`.

---

## 5. Wire the Supabase DB webhook on `contacts.INSERT`

In the Supabase dashboard:

**Database → Webhooks → Create a new hook**

| Field | Value |
|---|---|
| Name | `tg-signup-ping` |
| Table | `contacts` |
| Events | `Insert` (only) |
| Type | HTTP Request |
| Method | POST |
| URL | `https://juhlwmisnahmgyexmfhm.supabase.co/functions/v1/tg-signup-ping` |
| HTTP Headers | add `Content-type: application/json` AND `X-Webhook-Secret: <YOUR_SUPABASE_WEBHOOK_SECRET>` |
| HTTP params | (none) |
| Timeout | 5000ms |

The function ignores anything that doesn't match `source='public' AND token IS NOT NULL`, so admin-added contacts won't trigger pings.

---

## 6. Smoke test

In Telegram, send `/start` to the bot. It will ignore you silently (we
don't handle `/start` — the bot is only callbacks + reply-tracking).

To trigger a real signup ping:

1. Mint a fresh invite link via `/admin` → Invite links → Mint
2. Open the link in an incognito window
3. Fill out the VIP form
4. Submit

Within ~5 seconds the gifting group should get a message that looks like:

```
🛎 NEW VIP SIGNUP

Sarah Chen
Solana · Tokyo

Ship to
Sarah Chen
123 Main St
Apt 4B
Tokyo 105-0001
Japan

Sizes
Shirt M · Pants M · Shorts M · Sweat M · Shoe 9 US

TG @sarahchen · X @sarah · sarah@example.com

[🎁 Start gift →]
```

Tap the button → product picker. Tap a product → size picker (with ★
on the size that matches her profile). Tap a size → confirmation
message saying "Reply to this message with the tracking number once it
ships." Reply with `1Z999AA10123456784` → status flips to `shipped`,
the bot confirms in-thread, and the gift shows up in `/admin` pipeline.

---

## Operator commands (for Simonne)

There are no slash commands. The bot is driven entirely by:

- Tapping inline buttons (Start gift, product, size)
- Replying to the "Gift created" message with a tracking number

Anyone NOT on `TELEGRAM_OPERATOR_IDS` gets `Not authorized.` on any
button tap. Their replies are silently ignored.

---

## What's NOT in v1 (yet)

- **Auto-detect carrier + auto-delivered**. The brief calls for AfterShip
  (or similar) wiring. For v1 the tracking number is just stored raw and
  the gift sits at `shipped` until someone marks it `delivered` in the
  admin pipeline. Wiring AfterShip is ~50 lines in a `tracking-webhook`
  function — happy to add once we want it.
- **Bulk send from the bot**. Use `/admin/products` slide-over → BULK
  ASSIGN (also not built yet — that's its own thing).
- **Correction flow on tracking** (re-reply to fix a typo). Works
  best-effort right now: replying again writes a second
  `telegram_messages.kind='tracking_reply'` row but the gift only gets
  the latest tracking number. If you typo a tracking number, fix it in
  `/admin/c/<id>` manually for now.
- **Delivered-notice posts in the group**. Once AfterShip is wired this
  comes for free.

---

## Debugging

Edge function logs: Supabase dashboard → **Edge Functions → tg-bot or
tg-signup-ping → Logs**. Telegram errors come through as
`Telegram <method> failed: ...` lines. Supabase query errors show as
`{ message: "...", code: "..." }` objects.

Webhook delivery status: **Database → Webhooks → tg-signup-ping →
Recent calls**.

To re-register the Telegram webhook after a change:

```sh
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
# then re-run the setWebhook command from step 4
```
