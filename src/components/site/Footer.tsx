import Link from "next/link";
import { Sparkle, Phone } from "@phosphor-icons/react";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative mt-24 border-t border-white/10 bg-charcoal/40">
      <div className="mx-auto flex flex-col gap-8 px-5 py-14 sm:px-8 md:flex-row md:items-end">
        <div className="max-w-sm">
          <div className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-ink">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-green-600 text-obsidian">
              <Sparkle weight="fill" size={18} />
            </span>
            Craavee
          </div>
          <p className="mt-3 text-sm leading-relaxed text-stone">
            Quick grabs delivered to your seat. Open fast, order fast, eat fast.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm text-stone sm:grid-cols-3">
          <Link href="/shop" className="transition-colors hover:text-ink">
            Menu
          </Link>
          <Link href="/sign-in" className="transition-colors hover:text-ink">
            Sign in
          </Link>
          <Link href="/shop/cart" className="transition-colors hover:text-ink">
            Cart
          </Link>
          <a href="tel:+1" className="transition-colors hover:text-ink">
            Support
          </a>
          <a href={`tel:+1`} className="transition-colors hover:text-ink">
            Call
          </a>
          <Link href="/shop/track" className="transition-colors hover:text-ink">
            Track
          </Link>
        </nav>
      </div>
      <div className="flex flex-col items-start justify-between gap-2 border-t border-white/10 pt-6 text-xs text-slate sm:flex-row sm:items-center">
        <span>© {currentYear} Craavee. Grab fast.</span>
        <span className="font-mono">v2 · quick commerce</span>
      </div>
    </footer>
  );
}