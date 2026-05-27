-- At Consensus, "what's your project?" is the second question after
-- "what's your name?" — useful context for the team when gifts ship.

alter table gifting_signups add column if not exists project text;
