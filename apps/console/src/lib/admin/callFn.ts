"use client";

// The single client-side door to every admin mutation.
//
// Nothing in this file is a security control, and it is worth being blunt
// about that: the Console is a browser, the browser is untrusted, and
// every function called from here re-derives the caller's identity from
// the verified JWT and re-checks the admin role server-side. Removing a
// `disabled` attribute in devtools produces the same refusal.
//
// What this file IS for: making sure the whole Console speaks to the
// backend one way, and that the operator reads a sentence rather than a
// Postgres error.
import { createClient } from "@/lib/supabase/client";

const FN_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1`;

export interface FnResult<T = Record<string, unknown>> {
  ok: boolean;
  code?: string;
  /** The server's own sentence. Only surfaced for VALIDATION_FAILED (see
   *  `explain`), because those messages are written for an operator —
   *  "4 units are already reserved by live orders" is actionable in a way
   *  no generic string can be. */
  message?: string;
  data?: T;
}

export async function callFn<T = Record<string, unknown>>(
  name: string,
  body: unknown,
): Promise<FnResult<T>> {
  const supabase = createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token ?? "";

  try {
    const r = await fetch(`${FN_BASE}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { ok: boolean; data?: T; error?: { code: string; message?: string } };
    return { ok: j.ok, code: j.error?.code, message: j.error?.message, data: j.data };
  } catch {
    // A dropped connection is not a refusal — say so, because the two
    // need different reactions from the operator.
    return { ok: false, code: "NETWORK" };
  }
}

/** Canonical error codes (API_CONTRACTS.md §5) turned into something an
 *  operator can act on. Raw database text never reaches this layer. */
export function explain(code: string | undefined, message?: string): string {
  // A validation refusal is the one case where the server writes a
  // sentence FOR the operator, and swallowing it to say "invalid" would
  // hide the only useful part. Everything else maps to a fixed string, so
  // no raw Postgres text can reach the screen.
  if (code === "VALIDATION_FAILED" && message && message.length <= 200) return message;

  switch (code) {
    case "AUTH_REQUIRED":
      return "Your session expired. Sign in again.";
    case "FORBIDDEN":
      return "You are not allowed to do that.";
    case "VALIDATION_FAILED":
      return "That request was rejected as invalid. Check the details and try again.";
    case "INVALID_ORDER_TRANSITION":
      return "The order has moved on since this page loaded. Refresh and look again.";
    case "RUNNER_ALREADY_ASSIGNED":
      return "That runner already has a live job.";
    case "JOB_ALREADY_CLAIMED":
      return "Another runner claimed this job first.";
    case "REFUND_EXCEEDS_CAPTURED":
      return "That is more than the remaining captured amount.";
    case "IDEMPOTENCY_CONFLICT":
      return "This action was already submitted with different details. Reload before retrying.";
    case "STORE_CLOSED":
      return "The store is paused.";
    case "NETWORK":
      return "Could not reach the server. Nothing was changed — check your connection and retry.";
    default:
      return "That did not go through. Nothing was changed — try again.";
  }
}
