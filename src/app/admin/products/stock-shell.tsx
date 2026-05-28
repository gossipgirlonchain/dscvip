"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProductWithStats } from "./page";
import type { Drop, ProductCategory } from "@/types/db";
import { PRODUCT_CATEGORIES } from "@/types/db";
import {
  createDrop,
  createProduct,
  updateProduct,
  archiveProduct,
  unarchiveProduct,
} from "@/app/admin/actions";

type FilterState = { q: string; dropFilter: string; showArchived: boolean };

export function StockShell({
  products,
  drops,
  filter,
}: {
  products: ProductWithStats[];
  drops: Drop[];
  filter: FilterState;
}) {
  const router = useRouter();
  const [ingestOpen, setIngestOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const detail = products.find((p) => p.id === detailId) ?? null;

  function urlWith(over: Partial<FilterState>): string {
    const next = new URLSearchParams();
    const merged = { ...filter, ...over };
    if (merged.q) next.set("q", merged.q);
    if (merged.dropFilter) next.set("drop", merged.dropFilter);
    if (merged.showArchived) next.set("archived", "1");
    const qs = next.toString();
    return qs ? `/admin/products?${qs}` : "/admin/products";
  }

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1
            className="text-[28px] leading-none font-bold uppercase tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            STOCK
          </h1>
          <p
            className="font-mono text-[10px] uppercase tracking-[0.22em] mt-1"
            style={{ color: "var(--color-dsc-red)" }}
          >
            // catalog · {products.length} item{products.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={() => setIngestOpen(true)}
          className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 transition"
          style={{
            border: "1px solid var(--color-dsc-red)",
            background: "var(--color-dsc-red)",
            color: "var(--color-bone)",
            borderRadius: 6,
          }}
        >
          + ingest product
        </button>
      </div>

      <FilterBar filter={filter} drops={drops} urlWith={urlWith} />

      {products.length === 0 ? (
        <EmptyStock />
      ) : (
        <ProductTable
          products={products}
          onOpen={(id) => setDetailId(id)}
        />
      )}

      {ingestOpen ? (
        <IngestModal
          drops={drops}
          onClose={() => setIngestOpen(false)}
          onCreated={() => {
            setIngestOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {detail ? (
        <ProductDetailDrawer
          product={detail}
          drops={drops}
          onClose={() => setDetailId(null)}
          onMutated={() => {
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Filter bar
   ───────────────────────────────────────────────────────────────────── */

function FilterBar({
  filter,
  drops,
  urlWith,
}: {
  filter: FilterState;
  drops: Drop[];
  urlWith: (over: Partial<FilterState>) => string;
}) {
  return (
    <form
      action="/admin/products"
      method="get"
      className="flex flex-wrap items-end gap-4"
    >
      <div className="flex-1 min-w-[220px]">
        <label
          className="font-mono text-[9px] uppercase tracking-[0.22em] block mb-1"
          style={{ color: "var(--color-dsc-red)" }}
        >
          search
        </label>
        <input
          name="q"
          defaultValue={filter.q}
          placeholder="product name"
          className="w-full px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent"
          style={{ borderBottom: "1px solid rgba(14,14,14,0.2)" }}
        />
      </div>
      <div className="w-[180px]">
        <label
          className="font-mono text-[9px] uppercase tracking-[0.22em] block mb-1"
          style={{ color: "var(--color-dsc-red)" }}
        >
          drop
        </label>
        <select
          name="drop"
          defaultValue={filter.dropFilter}
          className="w-full px-1 py-1.5 text-[13px] focus:outline-none cursor-pointer bg-transparent"
          style={{
            borderBottom: "1px solid rgba(14,14,14,0.2)",
            appearance: "none",
          }}
        >
          <option value="">any</option>
          {drops.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 pb-2 text-[12px]">
        <input
          type="checkbox"
          name="archived"
          value="1"
          defaultChecked={filter.showArchived}
          className="size-3.5 accent-[var(--color-dsc-red)]"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-deep)]">
          show archived
        </span>
      </label>
      <button
        type="submit"
        className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5"
        style={{
          border: "1px solid var(--color-dsc-red)",
          background: "transparent",
          color: "var(--color-dsc-red)",
          borderRadius: 6,
        }}
      >
        filter
      </button>
      {filter.q || filter.dropFilter ? (
        <Link
          href={urlWith({ q: "", dropFilter: "" })}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-dsc-red)] pb-2"
        >
          clear
        </Link>
      ) : null}
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   List table
   ───────────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function totalStock(inv: Record<string, number | null>): number | null {
  // Sum tracked sizes only. Returns null if no size has a tracked count
  // (i.e. inventory tracking is disabled for this product).
  let total = 0;
  let any = false;
  for (const v of Object.values(inv)) {
    if (typeof v === "number") {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function ProductTable({
  products,
  onOpen,
}: {
  products: ProductWithStats[];
  onOpen: (id: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr
          className="text-left font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{
            color: "var(--color-dsc-red)",
            borderBottom: "1px solid var(--color-dsc-red)",
          }}
        >
          <th className="py-2 pr-3 font-normal w-[60px]" />
          <th className="py-2 pr-3 font-normal">name</th>
          <th className="py-2 pr-3 font-normal">drop</th>
          <th className="py-2 pr-3 font-normal">sizes</th>
          <th className="py-2 pr-3 font-normal w-[80px]">sent</th>
          <th className="py-2 pr-3 font-normal w-[80px]">stock</th>
          <th className="py-2 pr-3 font-normal w-[90px]">last sent</th>
          <th className="py-2 pr-3 font-normal w-[90px]">status</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => {
          const stock = totalStock(p.inventory);
          return (
            <tr
              key={p.id}
              onClick={() => onOpen(p.id)}
              className={`cursor-pointer hover:bg-[var(--color-bone-deep)] transition ${
                p.status === "archived" ? "opacity-50" : ""
              }`}
              style={{ borderBottom: "1px solid rgba(14,14,14,0.08)" }}
            >
              <td className="py-2.5 pr-3 align-middle">
                <Thumb url={p.image_url} alt={p.name} />
              </td>
              <td className="py-2.5 pr-3 align-middle">
                <div
                  className="font-medium text-[14px]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {p.name}
                </div>
                <div className="text-[11px] text-[var(--color-muted)] font-mono uppercase tracking-[0.12em]">
                  {p.category}
                </div>
              </td>
              <td className="py-2.5 pr-3 align-middle text-[12px]">
                {p.drop_name ?? (
                  <span className="text-[var(--color-muted)]">—</span>
                )}
              </td>
              <td className="py-2.5 pr-3 align-middle">
                <div className="flex flex-wrap gap-1">
                  {p.sizes.length === 0 ? (
                    <span className="text-[var(--color-muted)]">—</span>
                  ) : (
                    p.sizes.map((s) => (
                      <span
                        key={s}
                        className="font-mono text-[10px] px-1.5 py-0.5"
                        style={{
                          border: "1px solid rgba(14,14,14,0.2)",
                          color: "var(--color-muted-deep)",
                        }}
                      >
                        {s}
                      </span>
                    ))
                  )}
                </div>
              </td>
              <td className="py-2.5 pr-3 align-middle font-mono text-[12px]">
                {p.sent_count}
              </td>
              <td className="py-2.5 pr-3 align-middle font-mono text-[12px]">
                {stock == null ? (
                  <span className="text-[var(--color-muted)]">∞</span>
                ) : (
                  stock
                )}
              </td>
              <td className="py-2.5 pr-3 align-middle font-mono text-[11px] text-[var(--color-muted)]">
                {fmtDate(p.last_sent_at)}
              </td>
              <td className="py-2.5 pr-3 align-middle">
                <span
                  className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em]"
                  style={{
                    border: "1px solid var(--color-dsc-red)",
                    background:
                      p.status === "active" ? "transparent" : "transparent",
                    color: "var(--color-dsc-red)",
                    borderRadius: 6,
                    textDecoration:
                      p.status === "archived" ? "line-through" : "none",
                  }}
                >
                  {p.status}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={alt}
        className="w-10 h-10 object-cover"
        style={{ border: "1px solid rgba(14,14,14,0.2)" }}
      />
    );
  }
  return (
    <div
      className="w-10 h-10 flex items-center justify-center"
      style={{
        border: "1px dashed rgba(14,14,14,0.2)",
        background: "var(--color-bone-deep)",
      }}
    >
      <span className="font-mono text-[9px] text-[var(--color-muted)]">
        ∅
      </span>
    </div>
  );
}

function EmptyStock() {
  return (
    <div
      className="relative p-6"
      style={{ border: "1px dashed var(--color-dsc-red-soft)", minHeight: 200 }}
    >
      <p
        className="font-mono text-[11px] uppercase tracking-[0.18em]"
        style={{ color: "var(--color-dsc-red)" }}
      >
        // no stock on shelves. + ingest first product.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Ingest modal — add product form
   ───────────────────────────────────────────────────────────────────── */

const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;

function IngestModal({
  drops,
  onClose,
  onCreated,
}: {
  drops: Drop[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [dropId, setDropId] = useState<string>("");
  const [newDropName, setNewDropName] = useState("");
  const [category, setCategory] = useState<ProductCategory>("apparel");
  const [imageUrl, setImageUrl] = useState("");
  const [sizes, setSizes] = useState<string[]>(["S", "M", "L", "XL"]);
  const [shoeSize, setShoeSize] = useState("");
  const [inventory, setInventory] = useState<Record<string, string>>({});
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  function toggleSize(s: string) {
    setSizes((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]
    );
  }

  async function submit() {
    if (!name.trim()) {
      setError("name required.");
      return;
    }
    setError(null);

    let resolvedDropId: string | null = dropId || null;
    if (!resolvedDropId && newDropName.trim()) {
      const d = await createDrop(newDropName.trim());
      if (!d.ok) {
        setError(d.error);
        return;
      }
      resolvedDropId = d.id;
    }

    const inv: Record<string, number | null> = {};
    for (const s of sizes) {
      const raw = inventory[s]?.trim();
      inv[s] = raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
    }

    const r = await createProduct({
      name: name.trim(),
      drop_id: resolvedDropId,
      category,
      image_url: imageUrl.trim() || null,
      sizes,
      inventory: inv,
      cost: cost ? parseFloat(cost) : null,
      notes: notes.trim() || null,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onCreated();
  }

  return (
    <SlideOver title="// ingest product" onClose={onClose} side="center">
      <div className="space-y-5">
        <Field label="name" required>
          <DscInput
            value={name}
            onChange={setName}
            autoFocus
            placeholder="DSC hoodie"
          />
        </Field>

        <Field label="category">
          <DscSelect
            value={category}
            onChange={(v) => setCategory(v as ProductCategory)}
            options={PRODUCT_CATEGORIES}
          />
        </Field>

        <Field label="drop">
          <div className="space-y-2">
            <DscSelect
              value={dropId}
              onChange={(v) => {
                setDropId(v);
                if (v) setNewDropName("");
              }}
              options={[
                { value: "", label: "select existing…" },
                ...drops.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
            <DscInput
              value={newDropName}
              onChange={(v) => {
                setNewDropName(v);
                if (v) setDropId("");
              }}
              placeholder="or create new drop name"
            />
          </div>
        </Field>

        {category === "apparel" ? (
          <Field label="sizes available">
            <div className="flex flex-wrap gap-1.5">
              {APPAREL_SIZES.map((s) => (
                <SizeChip
                  key={s}
                  size={s}
                  active={sizes.includes(s)}
                  onClick={() => toggleSize(s)}
                />
              ))}
            </div>
          </Field>
        ) : null}

        {sizes.length > 0 ? (
          <Field label="per-size inventory (blank = untracked)">
            <div className="grid grid-cols-4 gap-2">
              {sizes.map((s) => (
                <div key={s}>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-deep)] mb-0.5">
                    {s}
                  </div>
                  <DscInput
                    value={inventory[s] ?? ""}
                    onChange={(v) =>
                      setInventory((cur) => ({ ...cur, [s]: v }))
                    }
                    placeholder="—"
                  />
                </div>
              ))}
            </div>
          </Field>
        ) : null}

        {category === "apparel" ? null : (
          <Field label="shoe size or N/A">
            <DscInput
              value={shoeSize}
              onChange={setShoeSize}
              placeholder="e.g. 9, 10 US, or leave blank"
            />
          </Field>
        )}

        <Field label="image URL">
          <DscInput
            value={imageUrl}
            onChange={setImageUrl}
            placeholder="https://…"
            mono
          />
        </Field>

        <Field label="internal notes">
          <DscTextarea
            value={notes}
            onChange={setNotes}
            placeholder="printing defect on the back, run 2, etc."
          />
        </Field>

        <Field label="cost (admin only, optional)">
          <DscInput
            value={cost}
            onChange={setCost}
            placeholder="0.00"
            mono
            type="number"
          />
        </Field>

        {error ? (
          <p
            className="font-mono text-[11px] uppercase tracking-[0.18em]"
            style={{ color: "var(--color-dsc-red)" }}
          >
            // {error}
          </p>
        ) : null}

        <div
          className="flex items-center justify-end gap-3 pt-3"
          style={{ borderTop: "1px solid rgba(14,14,14,0.08)" }}
        >
          <button
            onClick={onClose}
            disabled={pending}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-dsc-red)]"
          >
            cancel
          </button>
          <button
            onClick={() => startTransition(submit)}
            disabled={pending}
            className="font-mono text-[10px] uppercase tracking-[0.18em] px-4 py-1.5 transition"
            style={{
              border: "1px solid var(--color-dsc-red)",
              background: "var(--color-dsc-red)",
              color: "var(--color-bone)",
              borderRadius: 6,
            }}
          >
            {pending ? "ingesting…" : "ingest"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}

function SizeChip({
  size,
  active,
  onClick,
}: {
  size: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-[11px] uppercase tracking-[0.15em] px-2.5 py-1 transition"
      style={{
        border: "1px solid var(--color-dsc-red)",
        background: active ? "var(--color-dsc-red)" : "transparent",
        color: active ? "var(--color-bone)" : "var(--color-dsc-red)",
        borderRadius: 6,
      }}
    >
      {size}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Product detail drawer
   ───────────────────────────────────────────────────────────────────── */

function ProductDetailDrawer({
  product,
  drops,
  onClose,
  onMutated,
}: {
  product: ProductWithStats;
  drops: Drop[];
  onClose: () => void;
  onMutated: () => void;
}) {
  const [recipients, setRecipients] = useState<RecipientRow[] | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await fetch(`/admin/products/${product.id}/recipients`, {
        cache: "no-store",
      });
      if (cancelled) return;
      if (r.ok) {
        const data = (await r.json()) as { recipients: RecipientRow[] };
        setRecipients(data.recipients);
      } else {
        setRecipients([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  return (
    <SlideOver
      title={product.name}
      onClose={onClose}
      side="right"
      eyebrow={`// product · ${product.category}`}
    >
      <div className="space-y-6">
        {/* Hero image */}
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full aspect-square object-cover"
            style={{ border: "1px solid rgba(14,14,14,0.2)" }}
          />
        ) : (
          <div
            className="w-full aspect-square flex items-center justify-center"
            style={{
              border: "1px dashed rgba(14,14,14,0.2)",
              background: "var(--color-bone-deep)",
            }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
              // no image
            </span>
          </div>
        )}

        {/* Spec block */}
        <SpecBlock>
          <SpecRow label="sku" value={product.id.slice(0, 8).toUpperCase()} />
          <SpecRow label="category" value={product.category} />
          <SpecRow label="drop" value={product.drop_name ?? "—"} />
          <SpecRow label="status" value={product.status} />
          <SpecRow label="last sent" value={fmtDate(product.last_sent_at)} />
        </SpecBlock>

        {/* Sizing matrix */}
        {product.sizes.length > 0 ? (
          <div>
            <SectionHeader>sizing matrix</SectionHeader>
            <table className="w-full text-[12px]">
              <thead>
                <tr
                  className="text-left font-mono text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--color-dsc-red)" }}
                >
                  <th className="py-1 font-normal">size</th>
                  <th className="py-1 font-normal text-right">in stock</th>
                  <th className="py-1 font-normal text-right">sent</th>
                </tr>
              </thead>
              <tbody>
                {product.sizes.map((s) => {
                  const stock = product.inventory[s];
                  const sentInSize =
                    recipients?.filter((r) => r.size === s).length ?? 0;
                  return (
                    <tr
                      key={s}
                      style={{
                        borderTop: "1px solid rgba(14,14,14,0.08)",
                      }}
                    >
                      <td className="py-1.5 font-mono">{s}</td>
                      <td className="py-1.5 text-right font-mono">
                        {stock == null ? (
                          <span className="text-[var(--color-muted)]">
                            untracked
                          </span>
                        ) : stock === 0 ? (
                          <span className="text-[var(--color-dsc-red)]">
                            out
                          </span>
                        ) : (
                          stock
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono">
                        {sentInSize}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {product.notes ? (
          <div>
            <SectionHeader>notes</SectionHeader>
            <p className="text-[13px] whitespace-pre-line">{product.notes}</p>
          </div>
        ) : null}

        {/* Recipients */}
        <div>
          <SectionHeader>
            recipients [{recipients?.length ?? "…"}]
          </SectionHeader>
          {recipients == null ? (
            <p className="font-mono text-[11px] text-[var(--color-muted)]">
              // loading…
            </p>
          ) : recipients.length === 0 ? (
            <p
              className="font-mono text-[11px] uppercase tracking-[0.18em]"
              style={{ color: "var(--color-dsc-red)" }}
            >
              // unshipped. zero recipients.
            </p>
          ) : (
            <ul>
              {recipients.map((r) => (
                <li
                  key={r.id}
                  className="py-2 flex items-center justify-between gap-2"
                  style={{ borderBottom: "1px solid rgba(14,14,14,0.08)" }}
                >
                  <div className="min-w-0">
                    <Link
                      href={`/admin/c/${r.contact_id}`}
                      className="text-[13px] font-medium hover:text-[var(--color-dsc-red)]"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {r.contact_name}
                    </Link>
                    <div className="font-mono text-[10px] text-[var(--color-muted)]">
                      {r.size ?? "—"} · {r.status} · {fmtDate(r.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-3 pt-3"
          style={{ borderTop: "1px solid rgba(14,14,14,0.08)" }}
        >
          <button
            onClick={() => setEditing((e) => !e)}
            className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5"
            style={{
              border: "1px solid var(--color-dsc-red)",
              background: editing ? "var(--color-dsc-red)" : "transparent",
              color: editing ? "var(--color-bone)" : "var(--color-dsc-red)",
              borderRadius: 6,
            }}
          >
            {editing ? "close edit" : "edit"}
          </button>
          {product.status === "active" ? (
            <form action={archiveProduct} onSubmit={() => onMutated()}>
              <input type="hidden" name="id" value={product.id} />
              <button
                type="submit"
                className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5"
                style={{
                  border: "1px dashed var(--color-dsc-red)",
                  color: "var(--color-dsc-red)",
                  borderRadius: 6,
                }}
              >
                archive
              </button>
            </form>
          ) : (
            <form action={unarchiveProduct} onSubmit={() => onMutated()}>
              <input type="hidden" name="id" value={product.id} />
              <button
                type="submit"
                className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5"
                style={{
                  border: "1px solid var(--color-dsc-red)",
                  color: "var(--color-dsc-red)",
                  borderRadius: 6,
                }}
              >
                unarchive
              </button>
            </form>
          )}
        </div>

        {editing ? (
          <EditProductInline
            product={product}
            drops={drops}
            onSaved={() => {
              setEditing(false);
              onMutated();
            }}
          />
        ) : null}
      </div>
    </SlideOver>
  );
}

type RecipientRow = {
  id: string;
  contact_id: string;
  contact_name: string;
  size: string | null;
  status: string;
  created_at: string;
};

function EditProductInline({
  product,
  drops,
  onSaved,
}: {
  product: ProductWithStats;
  drops: Drop[];
  onSaved: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [dropId, setDropId] = useState(product.drop_id ?? "");
  const [imageUrl, setImageUrl] = useState(product.image_url ?? "");
  const [notes, setNotes] = useState(product.notes ?? "");
  const [inv, setInv] = useState<Record<string, string>>(
    Object.fromEntries(
      product.sizes.map((s) => [
        s,
        product.inventory[s] != null ? String(product.inventory[s]) : "",
      ])
    )
  );
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    const inventory: Record<string, number | null> = {};
    for (const s of product.sizes) {
      const v = inv[s]?.trim();
      inventory[s] = v && /^\d+$/.test(v) ? parseInt(v, 10) : null;
    }
    startTransition(async () => {
      const r = await updateProduct(product.id, {
        name: name.trim(),
        drop_id: dropId || null,
        image_url: imageUrl.trim() || null,
        notes: notes.trim() || null,
        inventory,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div
      className="p-4 space-y-4"
      style={{
        border: "1px solid var(--color-dsc-red)",
        background: "var(--color-dsc-red-mist)",
      }}
    >
      <Field label="name">
        <DscInput value={name} onChange={setName} />
      </Field>
      <Field label="drop">
        <DscSelect
          value={dropId}
          onChange={setDropId}
          options={[
            { value: "", label: "—" },
            ...drops.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </Field>
      <Field label="image URL">
        <DscInput value={imageUrl} onChange={setImageUrl} mono />
      </Field>
      <Field label="notes">
        <DscTextarea value={notes} onChange={setNotes} />
      </Field>
      {product.sizes.length > 0 ? (
        <Field label="inventory">
          <div className="grid grid-cols-4 gap-2">
            {product.sizes.map((s) => (
              <div key={s}>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-deep)] mb-0.5">
                  {s}
                </div>
                <DscInput
                  value={inv[s] ?? ""}
                  onChange={(v) =>
                    setInv((cur) => ({ ...cur, [s]: v }))
                  }
                  placeholder="—"
                />
              </div>
            ))}
          </div>
        </Field>
      ) : null}
      {err ? (
        <p
          className="font-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: "var(--color-dsc-red)" }}
        >
          // {err}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => startTransition(save)}
          disabled={pending}
          className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 transition"
          style={{
            border: "1px solid var(--color-dsc-red)",
            background: "var(--color-dsc-red)",
            color: "var(--color-bone)",
            borderRadius: 6,
          }}
        >
          {pending ? "saving…" : "save"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Shared bits
   ───────────────────────────────────────────────────────────────────── */

function SlideOver({
  title,
  eyebrow,
  side,
  onClose,
  children,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  side: "right" | "center";
  onClose: () => void;
  children: React.ReactNode;
}) {
  const positioning =
    side === "right"
      ? "right-0 top-0 bottom-0 w-full max-w-[640px]"
      : "left-1/2 top-[8vh] -translate-x-1/2 w-full max-w-2xl max-h-[84vh]";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="font-sans fixed inset-0 z-50"
      style={{ background: "rgba(14,14,14,0.4)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute ${positioning} bg-[var(--color-bone)] overflow-hidden flex flex-col`}
        style={{
          border: "1px solid var(--color-dsc-red)",
        }}
      >
        <div
          className="px-5 py-3 flex items-start justify-between gap-3"
          style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
        >
          <div>
            {eyebrow ? (
              <p
                className="font-mono text-[9px] uppercase tracking-[0.22em]"
                style={{ color: "var(--color-dsc-red)" }}
              >
                {eyebrow}
              </p>
            ) : null}
            <h2
              className="text-[20px] font-bold uppercase leading-tight tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[14px] text-[var(--color-dsc-red)] hover:opacity-70"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label
        className="font-mono text-[9px] uppercase tracking-[0.22em] block mb-1"
        style={{ color: "var(--color-dsc-red)" }}
      >
        {label}
        {required ? " *" : ""}
      </label>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="font-mono text-[10px] uppercase tracking-[0.2em] pb-1 mb-2"
      style={{
        color: "var(--color-dsc-red)",
        borderBottom: "1px solid var(--color-dsc-red)",
      }}
    >
      {children}
    </h3>
  );
}

function SpecBlock({ children }: { children: React.ReactNode }) {
  return (
    <dl
      className="grid grid-cols-[120px_1fr] gap-y-1 text-[13px]"
      style={{ borderTop: "1px solid rgba(14,14,14,0.08)" }}
    >
      {children}
    </dl>
  );
}

function SpecRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-deep)] py-1.5">
        {label}
      </dt>
      <dd
        className="py-1.5 font-mono text-[12px]"
        style={{ borderBottom: "1px solid rgba(14,14,14,0.08)" }}
      >
        {value}
      </dd>
    </>
  );
}

function DscInput({
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={`w-full px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent ${mono ? "font-mono text-[12px]" : ""}`}
      style={{ borderBottom: "1px solid rgba(14,14,14,0.2)" }}
      onFocus={(e) => {
        e.currentTarget.style.borderBottom = "1px solid var(--color-dsc-red)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderBottom = "1px solid rgba(14,14,14,0.2)";
      }}
    />
  );
}

function DscTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className="w-full px-2 py-2 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent resize-none"
      style={{ border: "1px solid rgba(14,14,14,0.2)" }}
    />
  );
}

function DscSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options:
    | string[]
    | Array<{ value: string; label: string }>;
}) {
  const normalized: Array<{ value: string; label: string }> =
    Array.isArray(options) && typeof options[0] === "string"
      ? (options as string[]).map((o) => ({ value: o, label: o }))
      : (options as Array<{ value: string; label: string }>);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-1 py-1.5 text-[13px] focus:outline-none cursor-pointer bg-transparent"
      style={{
        borderBottom: "1px solid rgba(14,14,14,0.2)",
        appearance: "none",
      }}
    >
      {normalized.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
