"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  listProductsForPicker,
  logGiftFromProduct,
} from "@/app/admin/actions";
import type { Contact, GiftStatus, SizeBand } from "@/types/db";
import { GIFT_STATUSES } from "@/types/db";

type PickerProduct = Awaited<
  ReturnType<typeof listProductsForPicker>
>[number];

/**
 * The new + LOG GIFT row. Picker flow replaces free-text item/drop.
 * Auto-preselects size from the contact's sizing fields when possible
 * and warns inline when the product doesn't come in the contact's size.
 */
export function LogGiftPicker({
  contact,
  recentProductIds,
  onClose,
}: {
  contact: Contact;
  recentProductIds: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [products, setProducts] = useState<PickerProduct[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [status, setStatus] = useState<GiftStatus>("queued");
  const [tracking, setTracking] = useState("");
  const [loggedBy, setLoggedBy] = useState(contact.owner ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await listProductsForPicker();
      if (cancelled) return;
      setProducts(list);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const product = useMemo(
    () => products?.find((p) => p.id === productId) ?? null,
    [products, productId]
  );

  /* Auto-preselect size from contact sizing when the product is apparel. */
  useEffect(() => {
    if (!product) return;
    if (size) return;
    if (product.category !== "apparel") return;
    if (product.sizes.length === 0) return;

    // Match against contact's shirt/pants/etc — the simplest heuristic
    // is to try shirt_size first since most apparel is shirts/hoodies/
    // sweats. Fall back to the rest if shirt isn't offered.
    const candidates: SizeBand[] = [
      contact.shirt_size,
      contact.sweatshirt_size,
      contact.pants_size,
      contact.shorts_size,
    ];
    for (const cand of candidates) {
      if (cand && product.sizes.includes(cand)) {
        setSize(cand);
        return;
      }
    }
  }, [product, size, contact]);

  // Detect size conflict for the warning line.
  const contactSizeForCategory = (() => {
    if (!product) return null;
    if (product.category !== "apparel") return null;
    return contact.shirt_size;
  })();
  const hasSizeConflict =
    product &&
    product.sizes.length > 0 &&
    contactSizeForCategory &&
    !product.sizes.includes(contactSizeForCategory);

  // Recently-sent ordering: pinned at top of the dropdown for fast repeats.
  const orderedProducts = useMemo(() => {
    if (!products) return [];
    const recentSet = new Set(recentProductIds);
    const recent: PickerProduct[] = [];
    const rest: PickerProduct[] = [];
    for (const p of products) {
      (recentSet.has(p.id) ? recent : rest).push(p);
    }
    const filter = (arr: PickerProduct[]) =>
      query
        ? arr.filter((p) =>
            p.name.toLowerCase().includes(query.toLowerCase())
          )
        : arr;
    return { recent: filter(recent), rest: filter(rest) };
  }, [products, recentProductIds, query]);

  function submit() {
    if (!product) {
      setError("pick a product.");
      return;
    }
    if (product.sizes.length > 0 && !size) {
      setError("pick a size.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await logGiftFromProduct({
        contact_id: contact.id,
        product_id: product.id,
        size,
        status,
        tracking: tracking.trim() || null,
        notes: notes.trim() || null,
        logged_by: loggedBy.trim() || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="p-3 mb-3 space-y-3"
      style={{
        border: "1px solid var(--color-dsc-red)",
        background: "var(--color-dsc-red-mist)",
      }}
    >
      {/* Product field */}
      <div className="relative">
        <FieldLabel>product</FieldLabel>
        {product ? (
          <button
            type="button"
            onClick={() => {
              setProductId(null);
              setSize(null);
              setPickerOpen(true);
            }}
            className="w-full text-left flex items-center gap-2 px-2 py-1.5"
            style={{ borderBottom: "1px solid var(--color-dsc-red)" }}
          >
            <ProductThumb url={product.image_url} alt={product.name} />
            <div className="flex-1 min-w-0">
              <div
                className="text-[13px] font-medium truncate"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {product.name}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-muted-deep)]">
                {product.drop_name ?? "no drop"} · {product.category}
              </div>
            </div>
            <span className="font-mono text-[10px] text-[var(--color-dsc-red)]">
              change
            </span>
          </button>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setPickerOpen(true)}
              placeholder={
                products == null ? "// loading catalog…" : "// type to filter"
              }
              disabled={products == null}
              className="w-full px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent"
              style={{ borderBottom: "1px solid rgba(14,14,14,0.25)" }}
            />
            {pickerOpen && products && products.length > 0 ? (
              <PickerDropdown
                groups={orderedProducts as { recent: PickerProduct[]; rest: PickerProduct[] }}
                onPick={(p) => {
                  setProductId(p.id);
                  setSize(null);
                  setPickerOpen(false);
                  setQuery("");
                }}
                onClose={() => setPickerOpen(false)}
              />
            ) : null}
            {products && products.length === 0 ? (
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-dsc-red)] mt-1">
                // no products in catalog. ingest first via /admin/products.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Size field — only when a sized product is picked */}
      {product && product.sizes.length > 0 ? (
        <div>
          <FieldLabel>size</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {product.sizes.map((s) => {
              const stock = product.inventory[s];
              const outOfStock = stock === 0;
              const active = size === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => setSize(s)}
                  className="font-mono text-[11px] uppercase tracking-[0.15em] px-2.5 py-1 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    border: "1px solid var(--color-dsc-red)",
                    background: active
                      ? "var(--color-dsc-red)"
                      : "transparent",
                    color: active
                      ? "var(--color-bone)"
                      : "var(--color-dsc-red)",
                    borderRadius: 2,
                    textDecoration: outOfStock ? "line-through" : "none",
                  }}
                  title={
                    outOfStock
                      ? "out of stock"
                      : typeof stock === "number"
                        ? `${stock} in stock`
                        : "untracked"
                  }
                >
                  {s}
                  {typeof stock === "number" ? (
                    <span className="opacity-70 ml-1">[{stock}]</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {hasSizeConflict ? (
            <p
              className="font-mono text-[10px] uppercase tracking-[0.18em] mt-1.5"
              style={{ color: "var(--color-dsc-red)" }}
            >
              // size conflict. contact is {contactSizeForCategory}, product
              not offered in that size.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Drop (locked) */}
      {product ? (
        <div>
          <FieldLabel>drop</FieldLabel>
          <div
            className="px-1 py-1.5 text-[13px]"
            style={{ borderBottom: "1px solid rgba(14,14,14,0.12)" }}
          >
            {product.drop_name ?? (
              <span className="text-[var(--color-muted)]">no drop linked</span>
            )}
          </div>
        </div>
      ) : null}

      {/* Status + tracking + logged by */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel>status</FieldLabel>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as GiftStatus)}
            className="w-full px-1 py-1.5 text-[13px] focus:outline-none cursor-pointer bg-transparent"
            style={{
              borderBottom: "1px solid rgba(14,14,14,0.25)",
              appearance: "none",
            }}
          >
            {GIFT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>tracking</FieldLabel>
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="usps / dhl #"
            className="w-full px-1 py-1.5 text-[13px] font-mono focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent"
            style={{ borderBottom: "1px solid rgba(14,14,14,0.25)" }}
          />
        </div>
        <div>
          <FieldLabel>logged by</FieldLabel>
          <input
            value={loggedBy}
            onChange={(e) => setLoggedBy(e.target.value)}
            placeholder="you"
            className="w-full px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent"
            style={{ borderBottom: "1px solid rgba(14,14,14,0.25)" }}
          />
        </div>
      </div>

      <div>
        <FieldLabel>notes (optional)</FieldLabel>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="anything to remember about this send"
          className="w-full px-1 py-1.5 text-[13px] focus:outline-none placeholder:text-[var(--color-muted)] bg-transparent"
          style={{ borderBottom: "1px solid rgba(14,14,14,0.25)" }}
        />
      </div>

      {error ? (
        <p
          className="font-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: "var(--color-dsc-red)" }}
        >
          // {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          onClick={onClose}
          disabled={pending}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-dsc-red)]"
        >
          cancel
        </button>
        <button
          onClick={submit}
          disabled={pending || !product}
          className="font-mono text-[10px] uppercase tracking-[0.18em] px-4 py-1.5 transition disabled:opacity-40"
          style={{
            border: "1px solid var(--color-dsc-red)",
            background: "var(--color-dsc-red)",
            color: "var(--color-bone)",
            borderRadius: 2,
          }}
        >
          {pending ? "logging…" : "log gift"}
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="font-mono text-[9px] uppercase tracking-[0.22em] block mb-1"
      style={{ color: "var(--color-dsc-red)" }}
    >
      {children}
    </label>
  );
}

function ProductThumb({
  url,
  alt,
}: {
  url: string | null;
  alt: string;
}) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={alt}
        className="w-9 h-9 object-cover shrink-0"
        style={{ border: "1px solid rgba(14,14,14,0.2)" }}
      />
    );
  }
  return (
    <div
      className="w-9 h-9 flex items-center justify-center shrink-0"
      style={{
        border: "1px dashed rgba(14,14,14,0.2)",
        background: "var(--color-bone)",
      }}
    >
      <span className="font-mono text-[9px] text-[var(--color-muted)]">∅</span>
    </div>
  );
}

function PickerDropdown({
  groups,
  onPick,
  onClose,
}: {
  groups: { recent: PickerProduct[]; rest: PickerProduct[] };
  onPick: (p: PickerProduct) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="absolute left-0 right-0 top-full mt-1 max-h-[300px] overflow-y-auto z-10"
      style={{
        background: "var(--color-bone)",
        border: "1px solid var(--color-dsc-red)",
      }}
    >
      {groups.recent.length > 0 ? (
        <>
          <div
            className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.22em]"
            style={{
              color: "var(--color-dsc-red)",
              background: "var(--color-dsc-red-mist)",
            }}
          >
            recent
          </div>
          {groups.recent.map((p) => (
            <PickerRow key={p.id} product={p} onPick={onPick} />
          ))}
        </>
      ) : null}
      {groups.rest.length > 0 ? (
        <>
          {groups.recent.length > 0 ? (
            <div
              className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.22em]"
              style={{
                color: "var(--color-dsc-red)",
                background: "var(--color-dsc-red-mist)",
              }}
            >
              catalog
            </div>
          ) : null}
          {groups.rest.map((p) => (
            <PickerRow key={p.id} product={p} onPick={onPick} />
          ))}
        </>
      ) : null}
      {groups.recent.length === 0 && groups.rest.length === 0 ? (
        <p className="px-3 py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          // no matches.
        </p>
      ) : null}
    </div>
  );
}

function PickerRow({
  product,
  onPick,
}: {
  product: PickerProduct;
  onPick: (p: PickerProduct) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(product)}
      className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-bone-deep)] transition"
    >
      <ProductThumb url={product.image_url} alt={product.name} />
      <div className="flex-1 min-w-0">
        <div
          className="text-[13px] truncate"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {product.name}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-muted-deep)] truncate">
          {product.drop_name ?? "no drop"} · {product.category}
          {product.sizes.length > 0 ? ` · ${product.sizes.join("/")}` : ""}
        </div>
      </div>
    </button>
  );
}
