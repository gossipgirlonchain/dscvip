import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Signup } from "@/types/db";

export const dynamic = "force-dynamic";

const HEADERS = [
  "created_at",
  "full_name",
  "email",
  "address_line1",
  "address_line2",
  "city_region",
  "country",
  "postal_code",
  "telegram_handle",
  "x_handle",
  "instagram_handle",
  "shirt_size",
  "pants_size",
  "shorts_size",
  "sweatshirt_size",
  "shoe_size",
  "hat_size",
  "token",
  "source",
] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("gifting_signups")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const rows = (data ?? []) as Signup[];
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(HEADERS.map((h) => csvCell((r as unknown as Record<string, unknown>)[h])).join(","));
  }
  const body = lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="spenders-club-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
