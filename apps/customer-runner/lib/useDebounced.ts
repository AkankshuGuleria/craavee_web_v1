import { useEffect, useState } from "react";

/**
 * Debounce a rapidly-changing value.
 *
 * Search types at roughly 5-8 characters per second. Without this, "milk"
 * is four requests of which three are already obsolete when they land.
 * With 300ms, an ordinary word is one request.
 *
 * 300ms is chosen rather than inherited: below ~200ms a normal typist
 * still fires per-keystroke, and above ~400ms the field starts to feel
 * like it is lagging behind the finger. This is the pause between words,
 * not a throttle.
 *
 * Note this is deliberately NOT the same mechanism as request
 * cancellation. Debouncing stops requests being made; the query's
 * `abortSignal` cancels ones already in flight when the term moves on.
 * Search needs both - a fast typist can still outrun any debounce.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
