-- Drops: lightweight pickable label (not its own page yet).
create table if not exists drops (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  date       date,
  status     text not null default 'active'
               check (status in ('active', 'archived')),
  notes      text,
  created_at timestamptz not null default now()
);

create index if not exists drops_status_idx on drops (status);
create index if not exists drops_created_at_idx on drops (created_at desc);

-- Products: the catalog. inventory is { "S": 12, "M": null, "L": 5 }.
-- Untracked sizes are absent or null; tracked sizes have an integer.
create table if not exists products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  drop_id    uuid references drops(id) on delete set null,
  category   text not null
               check (category in ('apparel', 'accessory', 'print',
                                   'hardware', 'consumable')),
  image_url  text,
  sizes      text[] not null default '{}',
  inventory  jsonb not null default '{}'::jsonb,
  cost       numeric(10,2),
  status     text not null default 'active'
               check (status in ('active', 'archived')),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_status_idx on products (status);
create index if not exists products_drop_idx on products (drop_id);
create index if not exists products_updated_at_idx
  on products (updated_at desc);

drop trigger if exists products_touch on products;
create trigger products_touch
  before update on products
  for each row execute function touch_updated_at();

alter table contact_gifts
  add column if not exists product_id uuid
    references products(id) on delete set null,
  add column if not exists size text;

create index if not exists contact_gifts_product_idx
  on contact_gifts (product_id, created_at desc);

alter table drops    enable row level security;
alter table products enable row level security;
