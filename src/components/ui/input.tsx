import React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s/g, "-");

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-stone"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full px-4 py-3 rounded-cravee bg-concrete border border-whisper-border",
            "text-ivory placeholder:text-slate",
            "focus:outline-none focus:ring-2 focus:ring-ember/50 focus:border-transparent",
            "transition-[background-color,border-color,color,box-shadow,transform] duration-200",
            error && "border-alert focus:ring-alert/50",
            className
          )}
          {...props}
        />
        {error && (
          <p className="text-sm text-alert">{error}</p>
        )}
        {helperText && !error && (
          <p className="text-sm text-slate">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export { Input };
