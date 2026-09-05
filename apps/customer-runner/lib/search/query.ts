/**
 * Pure search-query logic.
 *
 * Separated from `hooks/useProductSearch` for the same reason
 * `lib/cart/logic.ts` is separate from the cart store: this is the part
 * with rules worth testing, and it must not drag the Supabase client into
 * a unit test just to assert a string transform.
 */

/**
 * Below this, a query is noise: one character matches most of the
 * catalogue and is a wasted round trip. Two is short enough to still
 * serve real brand searches.
 */
export const MIN_QUERY_LENGTH = 2;

/**
 * Strip characters that are structural to a PostgREST filter.
 *
 * This is a security boundary, not tidying. Search is sent as
 * `or=(name.ilike.%q%,brand.ilike.%q%,category.ilike.%q%)` - a
 * comma-separated list inside parentheses. A raw comma, paren or `*` in
 * the search box is therefore not text, it is syntax the customer gets to
 * write, and could append filters of their own or widen the ilike pattern.
 *
 * Stripped rather than escaped because none of these characters is
 * meaningful when searching a product name, so removing them costs
 * nothing and cannot be got wrong the way escaping can.
 */
export function sanitiseQuery(q: string): string {
  return q.trim().replace(/[,()*]/g, " ").replace(/\s+/g, " ");
}

/** Whether a term is worth sending to the server at all. */
export function isSearchable(q: string): boolean {
  return sanitiseQuery(q).length >= MIN_QUERY_LENGTH;
}
