import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthed())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const { id } = await ctx.params;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contact_gifts")
    .select(
      "id, contact_id, size, status, created_at, contacts(full_name, display_name)"
    )
    .eq("product_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ recipients: [] }, { status: 500 });
  }
  const recipients = (data ?? []).map((g) => {
    const c = (g as unknown as {
      contacts?: { display_name?: string | null; full_name?: string } | null;
    }).contacts;
    return {
      id: g.id as string,
      contact_id: g.contact_id as string,
      contact_name: c?.display_name ?? c?.full_name ?? "—",
      size: (g.size as string | null) ?? null,
      status: g.status as string,
      created_at: g.created_at as string,
    };
  });
  return NextResponse.json({ recipients });
}
