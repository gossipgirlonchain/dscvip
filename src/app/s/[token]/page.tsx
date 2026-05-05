import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { Logo } from "@/components/layout/logo";
import { SignupForm } from "@/components/signup/signup-form";
import type { InviteToken } from "@/types/db";

export const dynamic = "force-dynamic";

async function lookupToken(token: string): Promise<InviteToken | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("gifting_invite_tokens")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;

  const t = data as InviteToken;
  if (t.revoked_at) return null;
  if (t.expires_at && new Date(t.expires_at) < new Date()) return null;
  if (t.max_uses != null && t.use_count >= t.max_uses) return null;
  return t;
}

export default async function SecretSignupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await lookupToken(token);
  if (!invite) notFound();

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-8">
        <Logo size="lg" className="justify-center" />

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">VIP gifting</h1>
          <p className="text-muted-fg text-sm">
            This is a private link — please fill out the form to be added to the
            VIP gifting list. Do not share.
            {invite.label ? (
              <>
                <br />
                <span className="text-muted text-[13px]">via {invite.label}</span>
              </>
            ) : null}
          </p>
        </div>

        <SignupForm token={token} />

        <p className="text-center text-[12px] text-muted">
          Digital Spenders Club · invite-only
        </p>
      </div>
    </main>
  );
}
