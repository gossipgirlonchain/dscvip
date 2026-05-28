import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { logout } from "@/app/admin/actions";

/**
 * Top nav for /admin pages. STOCK / CONTACTS toggle.
 * DSC voice — oxblood active state, mono uppercase tracked labels.
 */
export function AdminNav({ active }: { active: "contacts" | "stock" }) {
  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <Logo size="md" variant="mark" />
        <nav className="flex items-center gap-3">
          <NavLink href="/admin" active={active === "contacts"}>
            contacts
          </NavLink>
          <NavLink href="/admin/products" active={active === "stock"}>
            stock
          </NavLink>
        </nav>
      </div>
      <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em]">
        <Link
          href="/admin/export.csv"
          className="text-[var(--color-muted)] hover:text-[var(--color-dsc-red)]"
        >
          csv
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="text-[var(--color-muted)] hover:text-[var(--color-dsc-red)]"
          >
            sign out
          </button>
        </form>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="font-mono text-[10px] uppercase tracking-[0.22em] px-2.5 py-1 transition"
      style={{
        border: "1px solid var(--color-dsc-red)",
        background: active ? "var(--color-dsc-red)" : "transparent",
        color: active ? "var(--color-bone)" : "var(--color-dsc-red)",
        borderRadius: 2,
      }}
    >
      {children}
    </Link>
  );
}
