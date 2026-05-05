import { Logo } from "@/components/layout/logo";
import { SignupForm } from "@/components/signup/signup-form";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="flex-1 relative overflow-hidden">
      {/* Subtle dot grid behind everything */}
      <div className="absolute inset-0 dot-grid opacity-50 pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-6 py-14 md:py-20 space-y-10 md:space-y-14">
        {/* Hero */}
        <section className="text-center space-y-6">
          <div className="flex justify-center animate-float">
            <Logo size="hero" variant="full" />
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-mono tracking-[0.25em] uppercase text-muted">
              Invite only · do not share
            </p>
            <h1 className="text-4xl md:text-6xl font-semibold tracking-[-0.04em]">
              VIP gifting.
            </h1>
            <p className="text-base md:text-lg text-muted-fg max-w-lg mx-auto leading-relaxed">
              You got the link, so you&rsquo;re on the list. Drop your details
              and we&rsquo;ll send you something good when we&rsquo;re back from
              Consensus.
            </p>
          </div>
        </section>

        {/* Form */}
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
