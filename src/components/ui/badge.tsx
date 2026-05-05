interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  className?: string;
}

const variantStyles = {
  default: "bg-offwhite text-muted-fg border border-border",
  success: "bg-primary-light text-primary border border-primary/10",
  warning: "bg-warning/8 text-warning border border-warning/10",
  error: "bg-error/8 text-error border border-error/10",
  info: "bg-info/8 text-info border border-info/10",
};

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5
        text-[11px] font-medium tracking-wide uppercase
        rounded-[5px]
        ${variantStyles[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}
