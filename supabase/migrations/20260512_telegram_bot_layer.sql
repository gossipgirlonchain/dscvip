-- Telegram bot integration layer. Same content as applied via MCP.

create table if not exists telegram_messages (
  id          uuid primary key default gen_random_uuid(),
  message_id  bigint not null,
  chat_id     bigint not null,
  gift_id     uuid references contact_gifts(id) on delete set null,
  contact_id  uuid references contacts(id) on delete set null,
  kind        text not null
                check (kind in ('signup_ping', 'gift_started',
                                'tracking_reply', 'status_update')),
  code        text,
  created_at  timestamptz not null default now()
);

create index if not exists telegram_messages_message_idx
  on telegram_messages (chat_id, message_id);
create index if not exists telegram_messages_gift_idx
  on telegram_messages (gift_id);
create index if not exists telegram_messages_contact_idx
  on telegram_messages (contact_id, kind);

alter table telegram_messages enable row level security;

alter table contact_gifts
  add column if not exists courier              text,
  add column if not exists tracking_url         text,
  add column if not exists tracking_provider_id text,
  add column if not exists drop_id              uuid
    references drops(id) on delete set null;

create index if not exists contact_gifts_tracking_provider_idx
  on contact_gifts (tracking_provider_id)
  where tracking_provider_id is not null;
create index if not exists contact_gifts_drop_idx
  on contact_gifts (drop_id, created_at desc);

update contact_gifts cg
   set drop_id = p.drop_id
  from products p
 where cg.product_id = p.id
   and cg.drop_id is null
   and p.drop_id is not null;

alter table contact_gifts drop constraint if exists contact_gifts_status_check;
alter table contact_gifts
  add constraint contact_gifts_status_check
  check (status in ('requested', 'queued', 'packed', 'shipped',
                    'delivered', 'posted', 'returned', 'skipped'));
