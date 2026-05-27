-- Collect Telegram alongside X / Instagram. People at Consensus pass
-- around Telegram handles more than anything else.

alter table gifting_signups add column if not exists telegram_handle text;
