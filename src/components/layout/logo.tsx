interface LogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "full" | "mark";
  className?: string;
}

const sizes = {
  sm: { mark: "w-7 h-7", text: "text-base" },
  md: { mark: "w-8 h-8", text: "text-lg" },
  lg: { mark: "w-10 h-10", text: "text-xl" },
};

export function Logo({ size = "md", variant = "full", className = "" }: LogoProps) {
  const s = sizes[size];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`${s.mark} rounded-[8px] bg-dark flex items-center justify-center`}>
        <span
          className="font-semibold text-white leading-none"
          style={{ fontSize: size === "lg" ? "18px" : size === "md" ? "15px" : "13px" }}
        >
          $
        </span>
      </div>
      {variant === "full" && (
        <span className={`${s.text} font-semibold tracking-[-0.03em] text-dark`}>
          spenders.club
        </span>
      )}
    </div>
  );
}
