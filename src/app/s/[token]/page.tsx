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
    <main className="flex-1 relative overflow-hidden">
      <div className="absolute inset-0 dot-grid opacity-50 pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-6 py-12 md:py-20 space-y-10 md:space-y-14">
        <section className="text-center space-y-5">
          <div className="flex justify-center">
            <Logo size="hero" variant="full" />
          </div>

          <p className="text-[11px] font-mono tracking-[0.25em] uppercase text-muted">
            Invite only · do not share
            {invite.label ? (
              <span className="block normal-case tracking-normal text-[12px] text-muted-fg mt-1">
                via {invite.label}
              </span>
            ) : null}
          </p>

          <p className="text-sm md:text-base text-muted-fg max-w-md mx-auto leading-relaxed">
            Sign up for the VIP list and get gifts dropped from DSC, first.
          </p>
        </section>

        <section className="bg-surface border border-border rounded-[var(--radius-card)] shadow-card p-6 md:p-10">
          <SignupForm token={token} />
        </section>

        <p className="text-center text-[11px] font-mono tracking-[0.2em] uppercase text-muted">
          Digital Spenders Club
        </p>
      </div>
    </main>
  );
}
