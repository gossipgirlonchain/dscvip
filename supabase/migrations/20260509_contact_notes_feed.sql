-- Context becomes a feed of entries instead of one big textarea.
-- Each entry knows where it came from (manual typing vs Smart Paste).

create table if not exists contact_notes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  body        text not null,
  author      text,
  source      text not null default 'manual'
                check (source in ('manual', 'paste', 'outreach')),
  created_at  timestamptz not null default now()
);

create index if not exists contact_notes_contact_idx
  on contact_notes (contact_id, created_at desc);

alter table contact_notes enable row level security;

-- Backfill existing notes as a single 'manual' entry per contact.
insert into contact_notes (contact_id, body, source, created_at)
select id, notes, 'manual', updated_at
  from contacts
 where notes is not null and trim(notes) <> ''
   and not exists (
     select 1 from contact_notes n where n.contact_id = contacts.id
   );

-- Gift status flow: queued → packed → shipped → delivered → posted.
-- Returned is a side branch from any prior status.
alter table contact_gifts drop constraint if exists contact_gifts_status_check;
alter table contact_gifts
  add constraint contact_gifts_status_check
  check (status in ('queued', 'packed', 'shipped', 'delivered', 'posted', 'returned'));
