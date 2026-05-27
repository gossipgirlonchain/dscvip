-- Rename the flat signups table into a proper contacts spine, then add
-- the CRM columns (lifecycle, permanent flags, owner, warmth, tags, etc).
-- Create gifts + touchpoints children. Existing rows backfill to vip
-- since they came through the invite-only form.

alter table gifting_signups rename to contacts;

alter index if exists gifting_signups_created_at_idx rename to contacts_created_at_idx;
alter index if exists gifting_signups_token_idx rename to contacts_token_idx;
alter index if exists gifting_signups_email_idx rename to contacts_email_idx;

alter table contacts
  add column if not exists lifecycle text not null default 'audience'
    check (lifecycle in ('audience', 'roster', 'vip', 'archived')),
  add column if not exists permanent_vip boolean not null default false,
  add column if not exists permanent_roster boolean not null default false,
  add column if not exists owner text,
  add column if not exists priority int check (priority between 1 and 5),
  add column if not exists warmth int check (warmth between 1 and 5),
  add column if not exists castable boolean not null default false,
  add column if not exists gifting_eligible boolean not null default true,
  add column if not exists roster_tier text,
  add column if not exists roster_why text,
  add column if not exists vip_why text,
  add column if not exists display_name text,
  add column if not exists wallet_address text,
  add column if not exists phone text,
  add column if not exists timezone text,
  add column if not exists base_city text,
  add column if not exists community text,
  add column if not exists introduced_by text,
  add column if not exists do_not_gift boolean not null default false,
  add column if not exists do_not_engage boolean not null default false,
  add column if not exists address_verified boolean not null default false,
  add column if not exists shipping_recipient text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

update contacts
   set lifecycle = 'vip'
 where lifecycle = 'audience' and source = 'public';

create index if not exists contacts_lifecycle_idx on contacts (lifecycle);
create index if not exists contacts_owner_idx on contacts (owner);
create index if not exists contacts_tags_idx on contacts using gin (tags);

create table if not exists contact_gifts (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references contacts(id) on delete cascade,
  item         text not null,
  drop_name    text,
  status       text not null default 'queued'
                 check (status in ('queued', 'shipped', 'delivered', 'posted')),
  sent_at      timestamptz,
  delivered_at timestamptz,
  posted_at    timestamptz,
  posted_url   text,
  tracking     text,
  notes        text,
  logged_by    text,
  created_at   timestamptz not null default now()
);
create index if not exists contact_gifts_contact_idx
  on contact_gifts (contact_id, created_at desc);

create table if not exists contact_touchpoints (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  channel       text not null
                  check (channel in ('dm_x', 'dm_tg', 'reply', 'email',
                                     'call', 'irl', 'other')),
  direction     text not null default 'outbound'
                  check (direction in ('outbound', 'inbound')),
  summary       text not null,
  occurred_at   timestamptz not null default now(),
  follow_up_at  timestamptz,
  logged_by     text,
  created_at    timestamptz not null default now()
);
create index if not exists contact_touchpoints_contact_idx
  on contact_touchpoints (contact_id, occurred_at desc);
create index if not exists contact_touchpoints_followup_idx
  on contact_touchpoints (follow_up_at)
  where follow_up_at is not null;

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contacts_touch on contacts;
create trigger contacts_touch
  before update on contacts
  for each row execute function touch_updated_at();

alter table contact_gifts       enable row level security;
alter table contact_touchpoints enable row level security;
