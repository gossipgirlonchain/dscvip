export type SizeBand = "S" | "M" | "L" | "XL" | "XXL" | "XXXL";

export const SIZE_BANDS: SizeBand[] = ["S", "M", "L", "XL", "XXL", "XXXL"];

export type Lifecycle = "audience" | "roster" | "vip" | "archived";

export const LIFECYCLES: Lifecycle[] = [
  "audience",
  "roster",
  "vip",
  "archived",
];

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  audience: "Audience",
  roster: "Roster",
  vip: "VIP",
  archived: "Archived",
};

export type GiftStatus =
  | "requested"
  | "queued"
  | "packed"
  | "shipped"
  | "delivered"
  | "posted"
  | "returned"
  | "skipped";

export const GIFT_STATUSES: GiftStatus[] = [
  "requested",
  "queued",
  "packed",
  "shipped",
  "delivered",
  "posted",
  "returned",
  "skipped",
];

export type TouchChannel =
  | "dm_x"
  | "dm_tg"
  | "reply"
  | "email"
  | "call"
  | "irl"
  | "other";

export const TOUCH_CHANNELS: TouchChannel[] = [
  "dm_x",
  "dm_tg",
  "reply",
  "email",
  "call",
  "irl",
  "other",
];

export const CHANNEL_LABEL: Record<TouchChannel, string> = {
  dm_x: "X DM",
  dm_tg: "Telegram DM",
  reply: "Public reply",
  email: "Email",
  call: "Call",
  irl: "IRL",
  other: "Other",
};

export type InviteToken = {
  token: string;
  label: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  max_uses: number | null;
  use_count: number;
};

export type Contact = {
  id: string;
  token: string | null;

  // Identity
  email: string;
  full_name: string;
  display_name: string | null;
  project: string | null;
  community: string | null;
  base_city: string | null;
  timezone: string | null;

  // Socials
  x_handle: string | null;
  instagram_handle: string | null;
  telegram_handle: string | null;
  wallet_address: string | null;
  phone: string | null;

  // Shipping
  shipping_recipient: string | null;
  address_line1: string;
  address_line2: string | null;
  city_region: string;
  country: string;
  postal_code: string;
  address_verified: boolean;

  // Sizing
  shirt_size: SizeBand;
  pants_size: SizeBand;
  shorts_size: SizeBand;
  sweatshirt_size: SizeBand;
  shoe_size: string | null;
  hat_size: SizeBand | null;

  // CRM state
  lifecycle: Lifecycle;
  permanent_vip: boolean;
  permanent_roster: boolean;
  owner: string | null;
  priority: number | null;
  warmth: number | null;
  castable: boolean;
  gifting_eligible: boolean;
  roster_tier: string | null;
  roster_why: string | null;
  vip_why: string | null;
  do_not_gift: boolean;
  do_not_engage: boolean;

  // Tagging + notes
  tags: string[];
  notes: string | null;
  heads_up: string | null;
  introduced_by: string | null;

  // Provenance
  added_by: string | null;
  source: "public" | "admin";

  created_at: string;
  updated_at: string;
};

export type ContactGift = {
  id: string;
  contact_id: string;
  /**
   * What was sent. Free text. Null for a 'requested' gift where Simmone
   * hasn't yet recorded the item via /sent.
   */
  item: string | null;
  drop_name: string | null;
  /** Catalog link (added 2026-05-10). Null for legacy free-text rows. */
  product_id: string | null;
  size: string | null;
  status: GiftStatus;
  // Request provenance (Telegram-driven activation / PR request).
  requested_at: string | null;
  requested_by: string | null;
  request_reason: string | null;
  skipped_at: string | null;
  skip_reason: string | null;
  sent_at: string | null;
  packed_at: string | null;
  delivered_at: string | null;
  posted_at: string | null;
  returned_at: string | null;
  posted_url: string | null;
  tracking: string | null;
  notes: string | null;
  logged_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TelegramMessage = {
  id: string;
  message_id: number;
  chat_id: number;
  gift_id: string | null;
  contact_id: string | null;
  kind: string;
  code: string | null;
  created_at: string;
};

export type NoteSource = "manual" | "paste" | "outreach";

export type ContactNote = {
  id: string;
  contact_id: string;
  body: string;
  author: string | null;
  source: NoteSource;
  created_at: string;
};

/* Product catalog ───────────────────────────────────────────────────── */

export type ProductCategory =
  | "apparel"
  | "accessory"
  | "print"
  | "hardware"
  | "consumable";

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  "apparel",
  "accessory",
  "print",
  "hardware",
  "consumable",
];

export type Drop = {
  id: string;
  name: string;
  date: string | null;
  status: "active" | "archived";
  notes: string | null;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  drop_id: string | null;
  category: ProductCategory;
  image_url: string | null;
  /**
   * Sizes the product is offered in. For apparel use the size_band values
   * ("S", "M", "L", "XL", "XXL", "XXXL"). For non-sized items use "OS" or
   * leave the array empty.
   */
  sizes: string[];
  /**
   * Per-size inventory count. Keys must be elements of `sizes`. Sizes
   * absent from the object (or with null value) are untracked — no
   * decrement on send, no out-of-stock warning.
   */
  inventory: Record<string, number | null>;
  cost: number | null;
  status: "active" | "archived";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactTouchpoint = {
  id: string;
  contact_id: string;
  channel: TouchChannel;
  direction: "outbound" | "inbound";
  summary: string;
  occurred_at: string;
  follow_up_at: string | null;
  logged_by: string | null;
  created_at: string;
};
