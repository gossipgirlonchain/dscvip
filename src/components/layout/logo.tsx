interface LogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "full" | "mark";
  className?: string;
}

// Heights chosen to look right at each breakpoint given the logo's
// built-in canvas padding (PNGs are 16:9 with the artwork centered).
const sizes = {
  sm: { mark: "h-6", wordmark: "h-7" },
  md: { mark: "h-8", wordmark: "h-10" },
  lg: { mark: "h-10", wordmark: "h-14" },
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
