-- Spenders Club VIP gifting list — initial schema.
--
-- Lives in the shared DSC Supabase project alongside other tables, so all
-- objects are namespaced with `gifting_` to avoid collisions.

create extension if not exists "pgcrypto";

create table if not exists gifting_invite_tokens (
  token         text primary key,
  label         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  max_uses      int,
  use_count     int not null default 0
);

-- Sizing enum mirrors the Google Form dropdown.
do $$ begin
  create type gifting_size_band as enum ('S', 'M', 'L', 'XL', 'XXL', 'XXXL');
exception
  when duplicate_object then null;
end $$;

create table if not exists gifting_signups (
  id                 uuid primary key default gen_random_uuid(),
  token              text references gifting_invite_tokens(token) on delete set null,

  -- Identity
  email              text not null,
  full_name          text not null,

  -- Address
  address_line1      text not null,
  address_line2      text,
  city_region        text not null,
  country            text not null,
  postal_code        text not null,

  -- Socials
  x_handle           text,
  instagram_handle   text,

  -- Sizing
  shirt_size         gifting_size_band not null,
  pants_size         gifting_size_band not null,
  shorts_size        gifting_size_band not null,
  sweatshirt_size    gifting_size_band not null,
  shoe_size          text,
  hat_size           gifting_size_band,

  -- Provenance
  notes              text,
  added_by           text,
  source             text not null default 'public' check (source in ('public', 'admin')),

  created_at         timestamptz not null default now()
);

create index if not exists gifting_signups_created_at_idx on gifting_signups (created_at desc);
create index if not exists gifting_signups_token_idx on gifting_signups (token);
create index if not exists gifting_signups_email_idx on gifting_signups (lower(email));

-- RLS: deny anon entirely. Public submits and admin reads both go through the
-- service role on the server.
alter table gifting_invite_tokens enable row level security;
alter table gifting_signups       enable row level security;
