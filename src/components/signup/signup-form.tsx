"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SIZE_BANDS, type SizeBand } from "@/types/db";
import { submitSignup } from "@/lib/actions/submit-signup";

const inputClass =
  "w-full px-3.5 py-2.5 bg-surface border border-border rounded-[var(--radius-input)] text-dark text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all duration-150";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-mono tracking-[0.2em] uppercase text-muted-fg mb-4">
      {children}
    </p>
  );
}

function SizeSelect({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-muted-fg">
        {label}
        {required ? "" : " (optional)"}
      </label>
      <select
        name={name}
        defaultValue=""
        required={required}
        className={inputClass}
      >
        <option value="" disabled={required} hidden={required}>
          Pick a size
        </option>
        {!required ? <option value="">None</option> : null}
        {SIZE_BANDS.map((s: SizeBand) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SignupForm({ token = null }: { token?: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="text-center space-y-3 py-8">
        <p className="text-[13px] font-mono tracking-[0.25em] uppercase text-dark">
          On the list
        </p>
        <p className="text-sm md:text-base text-muted-fg max-w-sm mx-auto">
          We&rsquo;ll reach out when gifts ship.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-10"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await submitSignup(token, fd);
          if (result.ok) setDone(true);
          else setError(result.error);
        });
      }}
    >
      <div>
        <SectionHeading>About you</SectionHeading>
        <div className="space-y-4">
          <Input
            name="email"
            type="email"
            label="Email"
            required
            autoComplete="email"
          />
          <Input
            name="full_name"
            label="Full name"
            required
            autoComplete="name"
          />
        </div>
      </div>

      <div>
        <SectionHeading>Where to ship</SectionHeading>
        <div className="space-y-4">
          <Input
            name="address_line1"
            label="Street address"
            required
            autoComplete="address-line1"
          />
          <Input
            name="address_line2"
            label="Apt, suite, unit (optional)"
            autoComplete="address-line2"
          />
          <Input
            name="city_region"
            label="City, state, province, region"
            required
            autoComplete="address-level2"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              name="country"
              label="Country"
              required
              autoComplete="country-name"
            />
            <Input
              name="postal_code"
              label="Postal / zip"
              required
              autoComplete="postal-code"
            />
          </div>
        </div>
      </div>

      <div>
        <SectionHeading>Socials (optional)</SectionHeading>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input name="x_handle" label="X handle" placeholder="@you" />
          <Input
            name="instagram_handle"
            label="Instagram handle"
            placeholder="@you"
          />
        </div>
      </div>

      <div>
        <SectionHeading>Sizing</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <SizeSelect name="shirt_size" label="Shirt" required />
          <SizeSelect name="pants_size" label="Pants" required />
          <SizeSelect name="shorts_size" label="Shorts" required />
          <SizeSelect name="sweatshirt_size" label="Sweatshirt" required />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Input
            name="shoe_size"
            label="Shoe size (optional)"
            placeholder="e.g. 10 US"
          />
          <SizeSelect name="hat_size" label="Hat" />
        </div>
      </div>

      {error && (
        <p className="text-[13px] text-error text-center -mb-4">{error}</p>
      )}

      <Button
        type="submit"
        size="lg"
        isLoading={pending}
        className="w-full font-mono uppercase tracking-[0.2em] text-[13px]"
      >
        Join the VIP list
      </Button>
    </form>
  );
}
