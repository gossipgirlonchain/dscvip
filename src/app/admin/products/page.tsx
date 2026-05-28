import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Product, Drop, ContactGift } from "@/types/db";
import { AdminNav } from "@/components/admin/nav";
import { StockShell } from "./stock-shell";

export const dynamic = "force-dynamic";

type ProductWithStats = Product & {
  drop_name: string | null;
  sent_count: number;
  last_sent_at: string | null;
};

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; drop?: string; archived?: string }>;
}) {
  if (!(await isAdminAuthed())) redirect("/admin/login");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const dropFilter = (sp.drop ?? "").trim();
  const showArchived = sp.archived === "1";

  const supabase = createServiceRoleClient();

  // Pull products + their drop name in one query.
  const productsQuery = supabase
    .from("products")
    .select("*, drops(name)")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (!showArchived) productsQuery.eq("status", "active");
  if (dropFilter) productsQuery.eq("drop_id", dropFilter);
  if (q) productsQuery.ilike("name", `%${q}%`);

  const dropsQuery = supabase
    .from("drops")
    .select("*")
    .order("created_at", { ascending: false });

  // Aggregate sent counts per product. One round-trip; we'll bin in JS.
  const giftsQuery = supabase
    .from("contact_gifts")
    .select("product_id, created_at")
    .not("product_id", "is", null);

  const [productsRes, dropsRes, giftsRes] = await Promise.all([
    productsQuery,
    dropsQuery,
    giftsQuery,
  ]);

  type RawProduct = Omit<Product, "drop_id"> & {
    drop_id: string | null;
    drops: { name?: string } | null;
  };

  const rawProducts = (productsRes.data ?? []) as RawProduct[];
  const drops = (dropsRes.data ?? []) as Drop[];
  const gifts = (giftsRes.data ?? []) as Array<{
    product_id: string | null;
    created_at: string;
  }>;

  // Compute sent_count + last_sent_at per product.
  const counts = new Map<string, { count: number; last: string | null }>();
  for (const g of gifts) {
    if (!g.product_id) continue;
    const c = counts.get(g.product_id) ?? { count: 0, last: null };
    c.count += 1;
    if (!c.last || g.created_at > c.last) c.last = g.created_at;
    counts.set(g.product_id, c);
  }

  const products: ProductWithStats[] = rawProducts.map((p) => {
    const stats = counts.get(p.id) ?? { count: 0, last: null };
    return {
      ...p,
      drop_name: p.drops?.name ?? null,
      sent_count: stats.count,
      last_sent_at: stats.last,
    } as ProductWithStats;
  });

  return (
    <main className="dsc-bone relative flex-1 px-12 py-8 max-w-[1180px] w-full mx-auto space-y-6">
      <AdminNav active="stock" />
      {/* note: stock here, pipeline lives at /admin */}
      <StockShell
        products={products}
        drops={drops}
        filter={{ q, dropFilter, showArchived }}
      />
    </main>
  );
}

export type { ProductWithStats };
