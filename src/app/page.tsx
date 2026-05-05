import { Logo } from "@/components/layout/logo";

export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <Logo size="lg" className="justify-center" />
        <p className="text-muted">
          Private gifting list for the Spenders Club. Access is by invite link only.
        </p>
      </div>
    </main>
  );
}
