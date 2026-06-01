import "server-only";

/**
 * Fire a notification to the Telegram bot edge function. Best-effort: a
 * failing notification must never block the CRM write that triggered it, so
 * everything is caught and logged. Configure EDGE_NOTIFY_URL (the function's
 * /notify URL) and INTERNAL_NOTIFY_SECRET; if unset, notifications are skipped
 * silently (e.g. local dev without the bot wired up).
 */
type NotifyPayload =
  | { kind: "new_vip"; contact_id: string }
  | {
      kind: "activation";
      contact_id: string;
      gift_id: string;
      request_reason?: string | null;
    };

export async function notifyTelegram(payload: NotifyPayload): Promise<void> {
  const url = process.env.EDGE_NOTIFY_URL;
  const secret = process.env.INTERNAL_NOTIFY_SECRET;
  if (!url || !secret) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("[telegram notify] failed", e);
  }
}
