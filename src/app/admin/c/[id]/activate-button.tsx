"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { activateVip } from "../../actions";

export function ActivateButton({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReason("");
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await activateVip(contactId, reason);
    if (res.ok) {
      setOpen(false);
      setReason("");
      setBusy(false);
      router.refresh();
    } else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-sans inline-flex items-center gap-1.5 rounded-full text-[12px] px-3 py-1.5 text-white transition hover:opacity-90"
        style={{ background: "var(--color-dsc-red)" }}
      >
        Activate
      </button>

      {open ? (
        <div
          className="font-sans fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
          style={{ background: "rgba(17,17,17,0.4)" }}
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-[#ECECEC] p-5 space-y-3"
          >
            <h3 className="text-[14px] font-semibold text-dark">
              Activate VIP — notify shipping
            </h3>
            <p className="text-[12px] text-muted-fg">
              Pings the team Telegram so Simmone can decide what to send. Add
              any context (PR ask, occasion, what to prioritize).
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              rows={4}
              placeholder="e.g. PR gift — big launch this week, send a hoodie + cap if we have her size."
              className="w-full px-3 py-2 border border-[#ECECEC] rounded text-[13px] focus:outline-none focus:border-[#E11D48] resize-y"
            />
            {error ? (
              <p className="text-[12px] text-[#E11D48]">{error}</p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="text-[12px] px-3 py-1.5 rounded-full border border-[#ECECEC] hover:border-[#D6D6D4] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="text-[12px] px-3 py-1.5 rounded-full text-white transition disabled:opacity-50"
                style={{ background: "var(--color-dsc-red)" }}
              >
                {busy ? "Activating…" : "Activate + notify"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
