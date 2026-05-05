"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAdminAuthed, clearAdminCookie } from "@/lib/admin-auth";

async function requireAdmin() {
  if (!(await isAdminAuthed())) {
    redirect("/admin/login");
  }
}

export async function logout() {
  await clearAdminCookie();
  redirect("/admin/login");
}

export async function mintInvite(formData: FormData) {
  await requireAdmin();
  const label = String(formData.get("label") ?? "").trim() || null;
  const created_by = String(formData.get("created_by") ?? "").trim() || null;

  const token = randomBytes(9).toString("base64url"); // ~12 chars

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("gifting_invite_tokens").insert({
    token,
    label,
    created_by,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
}

export async function revokeInvite(formData: FormData) {
  await requireAdmin();
  const token = String(formData.get("token") ?? "");
  if (!token) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("gifting_invite_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token", token);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function deleteSignup(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("gifting_signups").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
