-- Heads-up callout shown above the Shipping panel on the contact card.
-- Set by Smart Paste when a paste mentions future-conditional info
-- ("we're moving next month"), dismissed by the user.

alter table contacts add column if not exists heads_up text;
