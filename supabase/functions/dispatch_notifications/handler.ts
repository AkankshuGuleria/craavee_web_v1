// dispatch_notifications — Phase 8 §16.
//
// Drains notification_outbox and sends via Expo's push API. This is the
// only place network I/O happens for notifications: the trigger that
// enqueues runs inside the state-change transaction and does no HTTP
// (D24's rule), and this runs outside it.
//
// Notifications are never the system of record
// (ENGINEERING_SPECIFICATION.md §14). Every failure path here is
// deliberately non-fatal to the order: a dead token, a 500 from Expo, or
// this function never running at all leaves orders/payments/wallet
// untouched, and the customer's next poll shows the truth.
//
// Idempotency comes from two places, neither of them this file:
//   * UNIQUE (order_id, event) on the outbox — an event exists at most once
//   * `for update skip locked` in claim_notification_batch — two
//     concurrent dispatcher runs can never claim the same row
//
// Payload safety (§15): title, body, and an orderId for the deep link.
// No delivery code, no amount, no address, no auth material. Safe on a
// lock screen.

import { serviceClient } from "../_shared/context.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "dispatch_notifications";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface Claimed {
  outbox_id: string;
  order_id: string;
  event: string;
  title: string;
  body: string;
  token: string;
  platform: string;
}

export async function handleDispatchNotifications(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  // Service-role only: this is a scheduled/internal drain, not a client
  // endpoint. verifyCaller is not used because there is no user here.
  const secret = req.headers.get("x-craavee-dispatch-key");
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!expected || secret !== expected) {
    return fail("AUTH_REQUIRED", "dispatcher key required", 401);
  }

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("claim_notification_batch", { p_limit: 50 });
    if (error) {
      captureException(error, { fn: FN, code: "DISPATCH_CLAIM_FAULT", level: "error" });
      return fail("SERVICE_UNAVAILABLE", "could not claim notifications", 500);
    }

    const rows = (data ?? []) as Claimed[];
    if (rows.length === 0) return ok({ claimed: 0, sent: 0, dropped: 0 });

    const messages = rows.map((r) => ({
      to: r.token,
      title: r.title,
      body: r.body,
      // The client re-reads the order on tap; the payload is a pointer,
      // never a source of state (§22).
      data: { orderId: r.order_id, event: r.event },
    }));

    let sent = 0;
    let dropped = 0;

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      // Leave the rows unsent; `attempts` was already incremented, so a
      // permanently failing row stops being retried after 5 tries rather
      // than looping forever.
      const detail = `expo ${res.status}`;
      for (const r of rows) {
        await db.rpc("mark_notification_sent", { p_outbox_id: r.outbox_id, p_error: detail });
      }
      captureException(new Error(`expo push returned ${res.status}`), {
        fn: FN,
        code: "PUSH_SEND_FAILED",
        level: "error",
      });
      return ok({ claimed: rows.length, sent: 0, dropped: 0, deferred: rows.length });
    }

    const payload = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    const tickets = payload.data ?? [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const t = tickets[i];
      if (t?.status === "ok") {
        await db.rpc("mark_notification_sent", { p_outbox_id: r.outbox_id, p_error: null });
        sent++;
      } else if (t?.details?.error === "DeviceNotRegistered") {
        // §14: clean up dead tokens rather than retrying them forever.
        await db.rpc("delete_push_token", { p_token: r.token });
        await db.rpc("mark_notification_sent", { p_outbox_id: r.outbox_id, p_error: "DeviceNotRegistered" });
        dropped++;
      } else {
        await db.rpc("mark_notification_sent", {
          p_outbox_id: r.outbox_id,
          p_error: t?.details?.error ?? "unknown",
        });
      }
    }

    return ok({ claimed: rows.length, sent, dropped });
  } catch (err) {
    captureException(err, { fn: FN, level: "error" });
    // Still a 200-shaped failure for the caller: a dispatcher problem
    // must never look like an order problem.
    return fail("SERVICE_UNAVAILABLE", "dispatch failed", 500);
  }
}
