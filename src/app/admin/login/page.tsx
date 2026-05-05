import { redirect } from "next/navigation";
import { checkAdminPassword, setAdminCookie, isAdminAuthed } from "@/lib/admin-auth";
import { Logo } from "@/components/layout/logo";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!checkAdminPassword(password)) {
    redirect("/admin/login?error=1");
  }
  await setAdminCookie();
  redirect("/admin");
}

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAdminAuthed()) redirect("/admin");
  const { error } = await searchParams;

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <form
        action={login}
        className="w-full max-w-sm space-y-6 rounded-[var(--radius-card)] border border-border bg-surface p-6"
      >
        <Logo size="md" variant="mark" />
        <div>
          <h1 className="text-lg font-semibold">Admin</h1>
          <p className="text-[13px] text-muted-fg">Shared team password.</p>
        </div>
        <input
          name="password"
          type="password"
          autoFocus
          required
          placeholder="Password"
          className="w-full px-3.5 py-2.5 bg-offwhite border border-border rounded-[var(--radius-input)] text-dark text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40"
        />
        {error ? (
          <p className="text-[13px] text-error">Wrong password.</p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-[var(--radius-button)] bg-dark text-white px-5 py-2.5 text-sm font-medium hover:bg-dark/85 transition"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
