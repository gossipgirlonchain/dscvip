import { Logo } from "@/components/layout/logo";
import { SignupForm } from "@/components/signup/signup-form";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-8">
        <Logo size="lg" className="justify-center" />

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">VIP gifting</h1>
          <p className="text-muted-fg text-sm">
            This is a private link — please fill out the form to be added to the
            VIP gifting list. Do not share.
          </p>
        </div>

        <SignupForm />

        <p className="text-center text-[12px] text-muted">
          Digital Spenders Club · invite-only
        </p>
      </div>
    </main>
  );
}
