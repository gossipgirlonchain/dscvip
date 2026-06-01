-- Telegram-driven gifting ops. The team "activates" a VIP (or logs a PR gift
-- request) from the dashboard, which creates a gift in the new 'requested'
-- state and notifies Simmone in Telegram. She replies with / commands to
-- record what she sent, add tracking, advance the pipeline, or skip — all of
-- which write straight back here. No Shopify in the loop.

-- 1. item is unknown at request time — Simmone fills it via /sent.
alter table contact_gifts
  alter column item drop not null;

-- 2. New lifecycle states: 'requested' (activated, awaiting Simmone) and
--    'skipped' (she declined — out of stock, bad address, etc).
alter table contact_gifts
  drop constraint if exists contact_gifts_status_check;
alter table contact_gifts
  add constraint contact_gifts_status_check
  check (status in (
    'requested', 'queued', 'packed', 'shipped',
    'delivered', 'posted', 'returned', 'skipped'
  ));

-- 3. Request + skip provenance.
alter table contact_gifts
  add column if not exists requested_at   timestamptz,
  add column if not exists requested_by   text,
  add column if not exists request_reason text,
  add column if not exists skipped_at     timestamptz,
  add column if not exists skip_reason    text;

-- 4. Map a posted Telegram notification back to the gift it's about, so a
--    reply (reply_to_message) can resolve the target record. `code` is the
--    short human-facing handle shown in the message (#G7QK) for the typo-proof
--    `/ship G7QK <tracking>` fallback.
create table if not exists telegram_messages (
  id          uuid primary key default gen_random_uuid(),
  message_id  bigint not null,
  chat_id     bigint not null,
  gift_id     uuid references contact_gifts(id) on delete cascade,
  contact_id  uuid references contacts(id) on delete cascade,
  kind        text not null,
  code        text,
  created_at  timestamptz not null default now()
);
create unique index if not exists telegram_messages_chat_msg_idx
  on telegram_messages (chat_id, message_id);
create index if not exists telegram_messages_code_idx
  on telegram_messages (code);
create index if not exists telegram_messages_gift_idx
  on telegram_messages (gift_id);

alter table telegram_messages enable row level security;
