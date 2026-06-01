-- Relax the NOT NULL constraints inherited from the public signup form so
-- the team can create a partial VIP from freeform context alone (admin
-- "Add VIP" flow). A contact can now exist with just a name, or even just
-- a note — the missing fields get filled in later from pastes / the form.

alter table contacts
  alter column email           drop not null,
  alter column full_name       drop not null,
  alter column address_line1   drop not null,
  alter column city_region     drop not null,
  alter column country         drop not null,
  alter column postal_code     drop not null,
  alter column shirt_size      drop not null,
  alter column pants_size      drop not null,
  alter column shorts_size     drop not null,
  alter column sweatshirt_size drop not null;
