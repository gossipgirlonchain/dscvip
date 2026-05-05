interface LogoProps {
  size?: "sm" | "md" | "lg" | "hero";
  variant?: "full" | "mark";
  className?: string;
}

// Heights at each breakpoint. PNGs are 16:9 with built-in canvas padding,
// so we err on the larger side to compensate.
const sizes = {
  sm: { mark: "h-6", wordmark: "h-7" },
  md: { mark: "h-8", wordmark: "h-10" },
  lg: { mark: "h-10", wordmark: "h-14" },
  hero: { mark: "h-24 md:h-36", wordmark: "h-32 md:h-52" },
};

export function Logo({
  size = "md",
  variant = "full",
  className = "",
}: LogoProps) {
  const s = sizes[size];
  const isFull = variant === "full";
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <div className={`flex items-center ${className}`}>
      <img
        src={isFull ? "/dsc-wordmark.png" : "/dsc-mark.png"}
        alt={isFull ? "Digital Spenders Club" : "_dsc"}
        className={`${isFull ? s.wordmark : s.mark} w-auto`}
      />
    </div>
  );
}
