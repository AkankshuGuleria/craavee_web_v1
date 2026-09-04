/**
 * Query persistence — an ALLOWLIST, deliberately.
 *
 * The Phase 10 audit found no persistence at all, so every cold start
 * showed an empty catalog and blocked on the network. That is the gap
 * this closes.
 *
 * But persistence is dangerous in exactly this product. The customer's
 * order view is poll-driven (D20) and the system's rule is that the
 * database is the truth: a persisted `orders` entry rehydrated on launch
 * would put a stale order status on screen and present it as current —
 * precisely the failure the audit called P0, arriving by a new route.
 *
 * So this is a whitelist, not a blacklist. A query persists only if it is
 * named here. Anything new is non-persistent until someone decides
 * otherwise, which is the safe default when the thing being cached might
 * be money.
 */
import type { Query } from "@tanstack/react-query";

/**
 * Query-key prefixes safe to restore from disk.
 *
 *   catalog — products, prices and availability. Public, identical for
 *             every customer, and revalidated on mount. Showing a
 *             one-minute-old price for the instant before the refetch
 *             lands is the whole point; the server prices the order
 *             anyway (D7), so a stale price cannot become a wrong charge.
 *
 * NOT here, on purpose:
 *   orders    — money and fulfilment state; must always come from the
 *               server (D20)
 *   payments  — never written to disk in any form
 *   profile   — carries wallet_balance, which is money
 *   addresses — customer PII, cheap to fetch, no reason to persist
 */
const PERSISTABLE = new Set(["catalog"]);

export function shouldPersistQuery(query: Query): boolean {
  const head = query.queryKey?.[0];
  if (typeof head !== "string") return false;
  // Only successful queries are worth restoring; a persisted error would
  // render on launch as a failure the user never actually hit.
  return PERSISTABLE.has(head) && query.state.status === "success";
}

/** Bump to invalidate every persisted cache after a shape change. */
export const PERSIST_BUSTER = "craavee-v1";

/**
 * How long a restored cache may be used before it is discarded outright.
 * Twenty-four hours: long enough that a daily user never sees an empty
 * catalog, short enough that a phone left in a drawer for a week starts
 * clean rather than showing last week's menu.
 */
export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24;
