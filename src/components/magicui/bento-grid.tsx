import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

interface BentoGridProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
  className?: string;
}

interface BentoCardProps extends ComponentPropsWithoutRef<"div"> {
  name: string;
  className?: string;
  background: ReactNode;
  Icon: ElementType;
  description: string;
  href: string;
  cta: string;
}

const BentoGrid = ({ children, className, ...props }: BentoGridProps) => {
  return (
    <div
      className={cn(
        "grid w-full auto-rows-[18rem] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

const BentoCard = ({
  name,
  className,
  background,
  Icon,
  description,
  href,
  cta,
  ...props
}: BentoCardProps) => (
  <div
    key={name}
    className={cn(
      "group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-cravee-lg",
      "glass-panel transform-gpu transition-all duration-300 hover:border-violet/40",
      className
    )}
    {...props}
  >
    <div className="pointer-events-none absolute inset-0 opacity-70">{background}</div>

    <div className="relative z-10 flex h-full flex-col justify-between p-6">
      <div className="flex transform-gpu flex-col gap-2 transition-all duration-300 lg:group-hover:-translate-y-2">
        <div className="grid h-12 w-12 place-items-center rounded-cravee border border-white/10 bg-violet/15 text-green-700">
          <Icon size={24} weight="bold" />
        </div>
        <h3 className="text-xl font-semibold text-ink">{name}</h3>
        <p className="max-w-md text-sm leading-relaxed text-stone">
          {description}
        </p>
      </div>

      <Link
        href={href}
        className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-pill border border-white/10 px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-green-50"
      >
        {cta}
        <ArrowRight size={16} weight="bold" />
      </Link>
    </div>

    <div className="pointer-events-none absolute inset-0 transform-gpu transition-all duration-300 group-hover:bg-violet/5" />
  </div>
);

export { BentoCard, BentoGrid };
