import React from "react";
import { cn } from "../../lib/utils";

interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: "active" | "pending" | "completed" | "error" | "warning";
  size?: "sm" | "md";
}

const statusStyles = {
  active: "bg-signal/20 text-signal border-signal/30",
  pending: "bg-warning/20 text-warning border-warning/30",
  completed: "bg-signal/20 text-signal border-signal/30",
  error: "bg-alert/20 text-alert border-alert/30",
  warning: "bg-warning/20 text-warning border-warning/30",
};

const StatusChip = React.forwardRef<HTMLSpanElement, StatusChipProps>(
  ({ className, status, size = "md", children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-pill border font-medium",
          "animate-pulse",
          statusStyles[status],
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
          className
        )}
        {...props}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
        {children}
      </span>
    );
  }
);

StatusChip.displayName = "StatusChip";

export { StatusChip };
