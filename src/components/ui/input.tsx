import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-[13px] font-medium text-muted-fg">{label}</label>
        )}
        <input
          ref={ref}
          className={`
            w-full px-3.5 py-2.5
            bg-surface border border-border
            rounded-[var(--radius-input)]
            text-dark text-sm placeholder:text-muted
            focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40
            transition-all duration-150
            ${error ? "border-error focus:ring-error/10" : ""}
            ${className}
          `}
          {...props}
        />
        {error && <p className="text-[13px] text-error">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
