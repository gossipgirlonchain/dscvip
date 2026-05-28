-- Pipeline dashboard needs per-stage timestamps so days_in_stage is cheap.
-- Adds packed_at + returned_at + an updated_at trigger.

alter table contact_gifts
  add column if not exists packed_at   timestamptz,
  add column if not exists returned_at timestamptz,
  add column if not exists updated_at  timestamptz not null default now();

update contact_gifts
   set packed_at = created_at
 where status = 'packed' and packed_at is null;

update contact_gifts
   set returned_at = created_at
 where status = 'returned' and returned_at is null;

drop trigger if exists contact_gifts_touch on contact_gifts;
create trigger contact_gifts_touch
  before update on contact_gifts
  for each row execute function touch_updated_at();

create index if not exists contact_gifts_status_idx
  on contact_gifts (status, updated_at desc);
create index if not exists contact_gifts_posted_at_idx
  on contact_gifts (posted_at desc) where posted_at is not null;
create index if not exists contact_gifts_delivered_at_idx
  on contact_gifts (delivered_at desc) where delivered_at is not null;
