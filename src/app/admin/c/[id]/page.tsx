import { notFound, redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Contact, ContactGift, ContactTouchpoint } from "@/types/db";
import { ContactShell, ContactPageDeleteForm } from "./contact-shell";

export const dynamic = "force-dynamic";

export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminAuthed())) redirect("/admin/login");
  const { id } = await params;

  const supabase = createServiceRoleClient();
  const [contactRes, giftsRes, touchesRes] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("contact_gifts")
      .select("*")
      .eq("contact_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("contact_touchpoints")
      .select("*")
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false }),
  ]);

  if (!contactRes.data) notFound();
  const contact = contactRes.data as Contact;
  const gifts = (giftsRes.data ?? []) as ContactGift[];
  const touchpoints = (touchesRes.data ?? []) as ContactTouchpoint[];

  return (
    <>
      <ContactShell
        initial={contact}
        gifts={gifts}
        touchpoints={touchpoints}
      />
      <div className="fixed bottom-3 right-4 z-30">
        <ContactPageDeleteForm id={contact.id} />
      </div>
    </>
  );
}
