import { Logo } from "@/components/layout/logo";
import { SignupForm } from "@/components/signup/signup-form";

export const dynamic = "force-dynamic";

export default function Home() {
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
          </p>

          <p className="text-sm md:text-base text-muted-fg max-w-md mx-auto leading-relaxed">
            Drop your details and we&rsquo;ll send you something good when
            we&rsquo;re back from Consensus.
          </p>
        </section>

        <section className="bg-surface border border-border rounded-[var(--radius-card)] shadow-card p-6 md:p-10">
          <SignupForm />
        </section>

        <p className="text-center text-[11px] font-mono tracking-[0.2em] uppercase text-muted">
          Digital Spenders Club
        </p>
      </div>
    </main>
  );
}
