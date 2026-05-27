export type SizeBand = "S" | "M" | "L" | "XL" | "XXL" | "XXXL";

export const SIZE_BANDS: SizeBand[] = ["S", "M", "L", "XL", "XXL", "XXXL"];

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

export type Signup = {
  id: string;
  token: string | null;

  email: string;
  full_name: string;
  project: string | null;

  address_line1: string;
  address_line2: string | null;
  city_region: string;
  country: string;
  postal_code: string;

  x_handle: string | null;
  instagram_handle: string | null;
  telegram_handle: string | null;

  shirt_size: SizeBand;
  pants_size: SizeBand;
  shorts_size: SizeBand;
  sweatshirt_size: SizeBand;
  shoe_size: string | null;
  hat_size: SizeBand | null;

  notes: string | null;
  added_by: string | null;
  source: "public" | "admin";
  created_at: string;
};
