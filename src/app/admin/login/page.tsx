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
    <main className="dsc-bone flex-1 flex items-center justify-center px-6 py-16">
      <form
        action={login}
        className="w-full max-w-sm space-y-5 p-6"
        style={{ border: "1px solid var(--color-dsc-red)" }}
      >
        <div className="flex items-center gap-3">
          <Logo size="md" variant="mark" />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: "var(--color-dsc-red)" }}
          >
            CRM · spenders.club
          </span>
        </div>
        <div>
          <p
            className="font-mono text-[9px] uppercase tracking-[0.22em]"
            style={{ color: "var(--color-dsc-red)" }}
          >
            // restricted access
          </p>
          <p className="text-[12px] text-[var(--color-muted-deep)] mt-1">
            Shared team password. Sessions live 12 hours.
          </p>
        </div>
        <input
          name="password"
          type="password"
          autoFocus
          required
          placeholder="password"
          className="w-full px-1 py-2 text-[14px] focus:outline-none bg-transparent placeholder:text-[var(--color-muted)]"
          style={{
            borderBottom: "1px solid rgba(14,14,14,0.2)",
            color: "var(--color-ink)",
          }}
        />
        {error ? (
          <p
            className="font-mono text-[11px] uppercase tracking-[0.18em]"
            style={{ color: "var(--color-dsc-red)" }}
          >
            // wrong password.
          </p>
        ) : null}
        <button
          type="submit"
          className="w-full font-mono text-[10px] uppercase tracking-[0.22em] px-5 py-2.5 transition"
          style={{
            border: "1px solid var(--color-dsc-red)",
            background: "transparent",
            color: "var(--color-dsc-red)",
            borderRadius: 6,
          }}
        >
          enter
        </button>
      </form>
    </main>
  );
}
