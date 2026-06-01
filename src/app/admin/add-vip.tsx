"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { createContactFromPaste } from "./actions";

export function AddVip() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPaste("");
    setError(null);
    setBusy(false);
  };

  const submit = async () => {
    if (!paste.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createContactFromPaste(paste);
    if (res.ok) {
      setOpen(false);
      reset();
      router.push(`/admin/c/${res.id}`);
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
        className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5"
        style={{
          border: "1px solid var(--color-dsc-red)",
          background: "var(--color-dsc-red)",
          color: "var(--color-bone-surface)",
          borderRadius: 6,
        }}
      >
        + add vip
      </button>

      <Modal
        isOpen={open}
        onClose={() => {
          if (!busy) {
            setOpen(false);
            reset();
          }
        }}
        title="Add VIP from context"
      >
        <div className="space-y-3">
          <p className="text-[12px] text-muted-fg">
            Paste anything — a DM, an intro, notes. We&apos;ll pull out whatever
            fields we can and create a new VIP. The raw text is kept as a note.
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            autoFocus
            rows={8}
            placeholder="e.g. Met Dana at Consensus — @dana_eth on X, based in Lisbon, wants the recurring drops. Ships to 12 Rua Augusta, Lisbon 1100-053 Portugal. Shirt M."
            className="w-full px-3 py-2 border border-border rounded text-[13px] focus:outline-none focus:border-[#E11D48] resize-y"
          />
          {error ? (
            <p className="text-[12px] text-[#E11D48]">{error}</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (!busy) {
                  setOpen(false);
                  reset();
                }
              }}
              disabled={busy}
              className="text-[12px] px-3 py-1.5 rounded-[var(--radius-pill)] border border-border hover:border-border-hover transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !paste.trim()}
              className="text-[12px] px-3 py-1.5 rounded-[var(--radius-pill)] text-white transition disabled:opacity-50"
              style={{ background: "var(--color-dsc-red)" }}
            >
              {busy ? "Creating…" : "Create VIP"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
