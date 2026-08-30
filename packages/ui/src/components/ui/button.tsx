import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center font-display font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus:outline-none focus:ring-2 focus:ring-ember/50 focus:ring-offset-2 focus:ring-offset-obsidian disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "clay-btn text-obsidian",
        secondary: "glass-panel text-ivory hover:bg-concrete/50",
        ghost: "text-ember hover:text-ember-hover hover:bg-ember/10",
        danger: "bg-alert text-white hover:bg-alert/90",
      },
      size: {
        sm: "px-4 py-2 text-sm rounded-cravee",
        md: "px-6 py-3 text-base rounded-cravee",
        lg: "px-8 py-4 text-lg rounded-cravee-lg",
        icon: "p-2 rounded-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
