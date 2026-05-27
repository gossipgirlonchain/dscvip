import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Contact, SizeBand } from "@/types/db";

/* ─────────────────────────────────────────────────────────────────────
   Schema — the structured diff Claude returns.

   Each "change" is one of five kinds. The shape is intentionally narrow
   so the apply step is a clean dispatch.
   ───────────────────────────────────────────────────────────────────── */

const SIZE_VALUES = ["S", "M", "L", "XL", "XXL", "XXXL"] as const;

// Whitelist of fields the LLM is allowed to propose updates for. Anything
// outside this list is dropped at apply time. Kept here (not pulled from
// the Contact type) because some Contact fields (lifecycle, tags, owner,
// permanent_vip…) are policy decisions the team makes, not paste-derived.
const SETTABLE_FIELDS = [
  "email",
  "full_name",
  "display_name",
  "project",
  "community",
  "base_city",
  "timezone",
  "x_handle",
  "instagram_handle",
  "telegram_handle",
  "wallet_address",
  "phone",
  "introduced_by",
  "shipping_recipient",
  "address_line1",
  "address_line2",
  "city_region",
  "country",
  "postal_code",
  "shirt_size",
  "pants_size",
  "shorts_size",
  "sweatshirt_size",
  "shoe_size",
  "hat_size",
] as const;

export type SettableField = (typeof SETTABLE_FIELDS)[number];

const SettableFieldSchema = z.enum(
  SETTABLE_FIELDS as unknown as [SettableField, ...SettableField[]]
);

const SetChangeSchema = z.object({
  kind: z.literal("set"),
  field: SettableFieldSchema,
  value: z.string(),
  source: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

const AppendContextSchema = z.object({
  kind: z.literal("append_context"),
  text: z.string(),
  source: z.string(),
});

const HeadsUpSchema = z.object({
  kind: z.literal("heads_up"),
  text: z.string(),
  source: z.string(),
});

const SuggestTagSchema = z.object({
  kind: z.literal("suggest_tag"),
  tag: z.string(),
  source: z.string(),
});

const MentionPersonSchema = z.object({
  kind: z.literal("mention_person"),
  name: z.string(),
  relationship: z.string().optional(),
  source: z.string(),
});

const DiffSchema = z.object({
  changes: z.array(
    z.discriminatedUnion("kind", [
      SetChangeSchema,
      AppendContextSchema,
      HeadsUpSchema,
      SuggestTagSchema,
      MentionPersonSchema,
    ])
  ),
});

export type SetChange = z.infer<typeof SetChangeSchema>;
export type AppendContextChange = z.infer<typeof AppendContextSchema>;
export type HeadsUpChange = z.infer<typeof HeadsUpSchema>;
export type SuggestTagChange = z.infer<typeof SuggestTagSchema>;
export type MentionPersonChange = z.infer<typeof MentionPersonSchema>;
export type DiffChange = z.infer<typeof DiffSchema>["changes"][number];
export type Diff = z.infer<typeof DiffSchema>;

/* ─────────────────────────────────────────────────────────────────────
   System prompt — large, stable, prompt-cached. Every call against the
   same contact-card shape reuses this cached prefix.
   ───────────────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You extract structured CRM updates from freeform text pastes for the Digital Spenders Club (DSC) gifting CRM. The input is anything: a DM, an email, a voice-memo transcript, a contact form scrape, a screenshot OCR. Your job is to map it onto the contact card.

You emit a JSON object with a "changes" array. Each change has a "kind" field that determines its shape:

1. "set" — propose overwriting a structured field. Required: field, value (string), source (verbatim quote from the paste that justified this), confidence ("high" | "medium" | "low"). Only propose if the new value materially differs from the current value OR the current value is null/empty. Settable fields:

   - email, full_name, display_name
   - project, community, base_city, timezone
   - x_handle, instagram_handle, telegram_handle, wallet_address, phone
   - introduced_by
   - shipping_recipient, address_line1, address_line2, city_region, country, postal_code
   - shirt_size, pants_size, shorts_size, sweatshirt_size (values must be exactly one of: S, M, L, XL, XXL, XXXL)
   - shoe_size (free text — "10 US", "EU 43", etc)
   - hat_size (same size band as shirts)

2. "append_context" — qualitative content that does not fit a structured field. Required: text (the formatted prose to append), source (verbatim quote). Goes into the Context block as a timestamped, sourced note. Use for: vibe/excitement, personal notes, sizing nuance ("S or M, prefers S if oversized"), emoji-laden enthusiasm, asks ("can you send a double for my fiancé"), anything that has texture beyond a clean field value. Always also append for sizing fields where the literal phrase has nuance the structured field can't hold.

3. "heads_up" — future-conditional or transient info that must NOT overwrite the live address/data. Required: text (the warning), source (verbatim quote). Examples: "moving next month", "address will change after June", "out of country until July". Address fields stay as-is — heads_up is a flag the team sees above the Shipping panel.

4. "suggest_tag" — a tag worth proposing for the team to add. Required: tag (lowercase-hyphen slug), source. Never auto-applied; just a suggestion.

5. "mention_person" — another person mentioned in the paste (fiancé, partner, team mate, friend). Required: name. Optional: relationship. Never auto-added as a contact; just surfaced. Always include source.

Rules:

- Address parsing: support US and international formats. Normalize into address_line1 (street + number), address_line2 (apt/suite/unit, may be null), city_region (city + state/province/region as one string per the existing schema), country, postal_code.
- Sizing: parse "S or M, prefers S if oversized" by proposing shirt_size = "S" with confidence "low" AND appending the full sizing phrase as a quoted append_context block.
- Future-conditional addresses go into heads_up, NOT into address fields. The current address stays as-is. This is the most important rule.
- Tone, emoji, excitement, personal context (fiancé jealousy, hearts, exclamation marks) goes into append_context as a quoted block with the exact original text preserved.
- Handles, emails, phone numbers: auto-detect and propose if they look real (not placeholder).
- Names of other people mentioned: never auto-add. Use mention_person.
- When uncertain, propose with confidence "low" — the user reviews everything anyway.
- Always include source: a verbatim quote from the paste (or as close to verbatim as makes sense). This is what the user sees as justification.
- Never invent data. If the paste doesn't mention an email, do not propose an email update.
- If the paste yields zero parseable fields, return an empty changes array.

Output a single JSON object matching the schema. No prose, no preamble.`;

/* ─────────────────────────────────────────────────────────────────────
   Main entrypoint — used by the proposePasteDiff server action.
   ───────────────────────────────────────────────────────────────────── */

function summarizeContact(c: Contact): string {
  // Compact representation Claude sees alongside the paste. JSON.stringify
  // would over-include irrelevant CRM state (lifecycle, owner, warmth…).
  const fields = {
    email: c.email,
    full_name: c.full_name,
    display_name: c.display_name,
    project: c.project,
    community: c.community,
    base_city: c.base_city,
    timezone: c.timezone,
    x_handle: c.x_handle,
    instagram_handle: c.instagram_handle,
    telegram_handle: c.telegram_handle,
    wallet_address: c.wallet_address,
    phone: c.phone,
    introduced_by: c.introduced_by,
    shipping_recipient: c.shipping_recipient,
    address_line1: c.address_line1,
    address_line2: c.address_line2,
    city_region: c.city_region,
    country: c.country,
    postal_code: c.postal_code,
    shirt_size: c.shirt_size,
    pants_size: c.pants_size,
    shorts_size: c.shorts_size,
    sweatshirt_size: c.sweatshirt_size,
    shoe_size: c.shoe_size,
    hat_size: c.hat_size,
  };
  // Sort keys deterministically so the prefix bytes don't shift across
  // calls — keeps the system-prompt cache warm even though this part is
  // post-cache (it's in user content, not system).
  const sorted = Object.fromEntries(
    Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))
  );
  return JSON.stringify(sorted, null, 2);
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Set it in .env.local (local) " +
        "and Vercel project settings (production)."
    );
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function parsePasteDiff(
  contact: Contact,
  paste: string
): Promise<Diff> {
  const client = getClient();
  const today = new Date().toISOString().slice(0, 10);

  const response = await client.messages.parse({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: zodOutputFormat(DiffSchema),
    },
    // Cache the static system prompt — it's stable across every paste, so
    // the second call onwards reads it for ~0.1x the input price.
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Today's date: ${today}

Current contact (existing field values — only propose changes that materially differ from these):

\`\`\`json
${summarizeContact(contact)}
\`\`\`

Paste:

\`\`\`
${paste}
\`\`\``,
      },
    ],
  });

  if (!response.parsed_output) {
    // Parse failures usually mean the model returned non-JSON because the
    // paste was unparseable. Return an empty diff so the UI can fall back
    // to "add as raw note?".
    return { changes: [] };
  }
  return response.parsed_output;
}

/* Helpers used by the apply step. */

export function isValidSizeBand(v: string): v is SizeBand {
  return (SIZE_VALUES as readonly string[]).includes(v);
}

export const SIZE_FIELDS = new Set([
  "shirt_size",
  "pants_size",
  "shorts_size",
  "sweatshirt_size",
  "hat_size",
]);

export const ALLOWED_SETTABLE = new Set<string>(SETTABLE_FIELDS);
