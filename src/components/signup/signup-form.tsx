"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SIZE_BANDS, type SizeBand } from "@/types/db";
import { submitSignup } from "@/lib/actions/submit-signup";

const inputClass =
  "w-full px-3.5 py-2.5 bg-surface border border-border rounded-[var(--radius-input)] text-dark text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all duration-150";

function SizeSelect({
  name,
  label,
  required,
  includeBlank = false,
}: {
  name: string;
  label: string;
  required?: boolean;
  includeBlank?: boolean;
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
        <option value="" disabled={required} hidden={required && !includeBlank}>
          Pick a size
        </option>
        {!required ? <option value="">—</option> : null}
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
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center space-y-2">
        <p className="text-base font-medium">You&rsquo;re on the VIP list.</p>
        <p className="text-sm text-muted-fg">
          We&rsquo;ll ship after Consensus. Watch your inbox.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
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
      <Input name="email" type="email" label="Email" required autoComplete="email" />
      <Input name="full_name" label="Name" required autoComplete="name" />

      <Input
        name="address_line1"
        label="Address"
        required
        autoComplete="address-line1"
      />
      <Input
        name="address_line2"
        label="Apt, Suite, Unit (optional)"
        autoComplete="address-line2"
      />
      <Input
        name="city_region"
        label="City, State, Province, Region"
        required
        autoComplete="address-level2"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input name="country" label="Country" required autoComplete="country-name" />
        <Input
          name="postal_code"
          label="Postal / Zip"
          required
          autoComplete="postal-code"
        />
      </div>

      <Input name="x_handle" label="X handle (optional)" placeholder="@you" />
      <Input
        name="instagram_handle"
        label="Instagram handle (optional)"
        placeholder="@you"
      />

      <div className="pt-2">
        <p className="text-[13px] font-medium text-dark mb-3">Sizing</p>
        <div className="grid grid-cols-2 gap-3">
          <SizeSelect name="shirt_size" label="Shirt" required />
          <SizeSelect name="pants_size" label="Pants" required />
          <SizeSelect name="shorts_size" label="Shorts" required />
          <SizeSelect name="sweatshirt_size" label="Sweatshirt" required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input name="shoe_size" label="Shoe size (optional)" placeholder="e.g. 10 US" />
        <SizeSelect name="hat_size" label="Hat" />
      </div>

      {error && <p className="text-[13px] text-error">{error}</p>}

      <Button type="submit" size="lg" isLoading={pending} className="w-full">
        Add me to the VIP list
      </Button>
    </form>
  );
}
