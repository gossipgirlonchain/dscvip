import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Contact } from "@/types/db";

export const dynamic = "force-dynamic";

const HEADERS = [
  "created_at",
  "lifecycle",
  "permanent_vip",
  "permanent_roster",
  "owner",
  "warmth",
  "priority",
  "castable",
  "gifting_eligible",
  "tags",
  "full_name",
  "display_name",
  "email",
  "project",
  "community",
  "base_city",
  "shipping_recipient",
  "address_line1",
  "address_line2",
  "city_region",
  "country",
  "postal_code",
  "address_verified",
  "x_handle",
  "instagram_handle",
  "telegram_handle",
  "wallet_address",
  "phone",
  "shirt_size",
  "pants_size",
  "shorts_size",
  "sweatshirt_size",
  "shoe_size",
  "hat_size",
  "introduced_by",
  "do_not_gift",
  "do_not_engage",
  "vip_why",
  "roster_why",
  "roster_tier",
  "notes",
  "token",
  "source",
] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return csvCell(v.join("|"));
  const str = String(v);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const rows = (data ?? []) as Contact[];
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      HEADERS.map((h) =>
        csvCell((r as unknown as Record<string, unknown>)[h])
      ).join(",")
    );
  }
  const body = lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dsc-contacts-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
