# spenders.club — DSC gifting list

Tiny invite-only signup site forked off the gossip platform. Anthony or anyone
on the team mints a secret link, shares it on Telegram with people they meet
at Consensus, those people fill in their details, and the team ships gifts
when they get back.

## Routes

- `/` — minimal landing page (no public signup).
- `/s/[token]` — secret signup form. Only valid invite tokens render the form.
- `/admin/login` — shared-password gate for the team.
- `/admin` — mint/revoke invite links, see the gifting list, add people manually.
- `/radar` - reply guy for twitter and creator outreach

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase + admin password
psql <SUPABASE_DB_URL> -f supabase/migrations/20260504_init.sql
npm run dev
```

Then go to `/admin/login`, enter `ADMIN_PASSWORD`, mint your first invite link,
and share it.

## Stack

- Next.js 16 (App Router, server actions)
- Supabase (Postgres + service-role writes; no anon access)
- Tailwind v4 + the gossip UI primitives

## Notes

- Privy / wallets / dashboards from the gossip fork have been stripped — this
  app does not need them.
- The admin gate is a single shared password. Rotate `ADMIN_PASSWORD` whenever
  someone leaves the trip. Sessions live 12h.
- Service role key is only used server-side. RLS denies all anon access.
