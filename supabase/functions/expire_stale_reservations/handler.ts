// expire_stale_reservations — API_CONTRACTS.md §3, D27.
//
// NOT client-callable — a system/service-role job. Invoked on a schedule.
// The primary schedule is pg_cron (migration 0004); this HTTP entry point
// exists for the "Supabase scheduled Edge Function" deployment option and
// for the Phase 4 integration tests, which call it directly. It carries
// no `Authorization: Bearer` caller — it is protected by not being routed
// to any client (verify_jwt=false, and it takes no user input) and by
// only ever running the service-role RPC.

import { serviceClient } from "../_shared/context.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { captureException } from "../_shared/sentry.ts";

export async function handleExpireStaleReservations(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  try {
    const db = serviceClient();
    const { data, error } = await db.rpc("expire_stale_reservations");
    if (error) {
      captureException(error, { fn: "expire_stale_reservations", code: "SWEEP_FAULT", level: "fatal" });
      return fail("PAYMENT_SETUP_FAILED", "sweep failed", 500);
    }
    return ok({ swept: Number(data) });
  } catch (err) {
    captureException(err, { fn: "expire_stale_reservations", level: "fatal" });
    return fail("PAYMENT_SETUP_FAILED", "sweep failed", 500);
  }
}
