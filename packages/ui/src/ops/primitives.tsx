"use client";

// Shared operational primitives for the Store and Console. Built for
// someone sitting at a laptop scanning for the one row that needs them,
// not for a marketing page: dense tables, no entrance animations, states
// that say what happened.
//
// Every ops surface is required to have a designed loading, empty, error
// and mutation-failure state (Phase 9 §38) — these are the pieces that
// make that cheap enough to actually do everywhere.
//
// MOVED HERE IN PHASE 10D. These lived in apps/console/src/lib/admin/ui.tsx
// and were, in practice, Craavee's real design system: the Console had
// nine confirm dialogs and ten error states built on them while
// apps/store had NONE — not one skeleton, empty state, error state or
// confirmation. That was not a Store oversight; the components were
// simply somewhere the Store could not import from. Promoting them is a
// file move, not a rewrite: the implementations are unchanged.
import { useEffect, useId, useRef, useState } from "react";
import { Warning, MagnifyingGlass, CheckCircle } from "@phosphor-icons/react";
import { cn } from "../lib/utils";

/* ---------------------------------------------------------------- table */

export function Table({ children, label }: { children: React.ReactNode; label: string }) {
  // The wrapper scrolls, never the page — a wide operational table on a
  // laptop should not push the whole layout sideways.
  return (
    <div className="clay-card overflow-x-auto p-0">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap bg-[#14161a] px-3 py-2.5 text-[11px] font-extrabold uppercase tracking-wide text-white/45",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("border-t border-white/[0.06] px-3 py-2.5 align-middle text-white/80", className)}>{children}</td>;
}

/* --------------------------------------------------------------- states */

export function Skeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div className="clay-card space-y-2 p-4" role="status" aria-live="polite" aria-label={`Loading ${label}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-lg bg-white/[0.05]" />
      ))}
      <span className="sr-only">Loading {label}…</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="clay-card flex flex-col items-center gap-2 p-10 text-center">
      <MagnifyingGlass size={22} weight="bold" className="text-white/25" />
      <p className="text-sm font-semibold text-white/70">{title}</p>
      {hint && <p className="max-w-sm text-xs text-white/40">{hint}</p>}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      role="alert"
      className="clay-card flex flex-col gap-1 border-red-400/30 bg-red-400/[0.07] p-5"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-red-200">
        <Warning size={16} weight="bold" /> {title}
      </p>
      {detail && <p className="text-xs text-red-200/70">{detail}</p>}
    </div>
  );
}

/** Inline result of a mutation. Success is transient, failure is not:
 *  an operator who looked away should still find out it failed. */
export function ActionResult({ error, success }: { error?: string | null; success?: string | null }) {
  if (!error && !success) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold",
        error ? "bg-red-400/10 text-red-200" : "bg-emerald-400/10 text-emerald-200",
      )}
    >
      {error ? <Warning size={14} weight="bold" /> : <CheckCircle size={14} weight="bold" />}
      {error ?? success}
    </p>
  );
}

/* ----------------------------------------------------------------- chips */

const TONES = {
  live: "bg-sky-400/15 text-sky-200",
  done: "bg-emerald-400/15 text-emerald-200",
  attention: "bg-orange-400/20 text-orange-200",
  alarm: "bg-red-400/20 text-red-200",
  dead: "bg-white/10 text-white/50",
} as const;

export function Pill({ tone = "live", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-extrabold", TONES[tone])}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ confirming */

/**
 * Destructive-action confirmation, on a native <dialog>.
 *
 * Native because it brings the things a hand-rolled overlay usually
 * forgets and an operations tool cannot: focus is trapped and restored,
 * Escape closes, the backdrop is inert, and screen readers announce it as
 * a modal. `impact` is required — a confirmation that only says "are you
 * sure?" teaches people to click through it.
 */
export function ConfirmDialog({
  open,
  title,
  impact,
  confirmLabel,
  confirmDisabled,
  busy,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  impact: React.ReactNode;
  confirmLabel: string;
  /** Blocks an obviously-incomplete submission (an empty required reason,
   *  say). The server validates the same thing — this only saves the
   *  operator a round trip. */
  confirmDisabled?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="clay-card m-auto w-[min(28rem,92vw)] border-white/10 bg-[#16181d] p-0 text-white backdrop:bg-black/70"
    >
      <div className="space-y-3 p-5">
        <h2 id={titleId} className="font-display text-lg font-extrabold text-white">
          {title}
        </h2>
        <div className="rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed text-white/70">{impact}</div>
        {children}
        <ActionResult error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className="rounded-xl bg-red-500/90 px-3 py-2 text-sm font-extrabold text-white hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200 disabled:opacity-50"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/* ---------------------------------------------------------------- inputs */

export const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300";

export const btnClass =
  "rounded-xl bg-white/[0.08] px-3 py-2 text-xs font-extrabold text-white/85 hover:bg-white/[0.14] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-40";

export const btnPrimaryClass =
  "rounded-xl bg-emerald-500/90 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200 disabled:opacity-40";

/** Debounced text input for filter bars — one state update per pause,
 *  not one per keystroke, so a 200-row table does not re-render on every
 *  letter. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* --------------------------------------------------------------- button */
/**
 * The ops button.
 *
 * `btnClass` / `btnPrimaryClass` existed as raw strings and were pasted
 * onto bare `<button>` elements, which is how the audit found fourteen
 * distinct hand-written control styles across the product — several
 * without a focus ring, and none with a loading state.
 *
 * The class constants stay exported for the places that legitimately
 * style a non-button element, but new work should use this component: it
 * carries the focus ring, the disabled semantics and `aria-busy` that a
 * bare element does not.
 */
export function Button({
  children, onClick, type = "button", variant = "secondary",
  disabled = false, loading = false, className, title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  title?: string;
}) {
  const inert = disabled || loading;
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold " +
    "min-h-[44px] transition-colors focus-visible:outline focus-visible:outline-2 " +
    "focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed";
  const tone = {
    primary: "bg-orange-500/90 text-white hover:bg-orange-500 focus-visible:outline-orange-200",
    secondary: "bg-white/10 text-white hover:bg-white/15 focus-visible:outline-white/40",
    danger: "bg-red-500/90 text-white hover:bg-red-500 focus-visible:outline-red-200",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={inert}
      title={title}
      aria-busy={loading || undefined}
      className={cn(base, tone, className)}
    >
      {children}
      {/* Reserved width so the label does not shift when loading starts. */}
      <span className={loading ? "inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" : "hidden"} />
    </button>
  );
}
