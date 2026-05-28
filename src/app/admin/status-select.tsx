"use client";

import { GIFT_STATUSES, type GiftStatus } from "@/types/db";
import { updateGiftStatus } from "./actions";

/**
 * Auto-submit status select for pipeline cards. Lives as a client
 * component because the onChange handler can't be passed from the
 * server-rendered page.tsx.
 */
export function StatusSelect({
  giftId,
  contactId,
  value,
}: {
  giftId: string;
  contactId: string;
  value: GiftStatus;
}) {
  return (
    <form action={updateGiftStatus} className="w-full">
      <input type="hidden" name="id" value={giftId} />
      <input type="hidden" name="contact_id" value={contactId} />
      <select
        name="status"
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-full font-mono text-[10px] uppercase tracking-[0.15em] px-1 py-0.5 bg-transparent cursor-pointer focus:outline-none"
        style={{
          border: "1px solid rgba(14,14,14,0.2)",
          borderRadius: 6,
          color: "var(--color-ink)",
          appearance: "none",
        }}
      >
        {GIFT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </form>
  );
}
