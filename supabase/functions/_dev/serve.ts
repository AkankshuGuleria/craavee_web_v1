// Local dev / integration-test server.
//
// Runs the REAL Edge Function handlers (../<fn>/handler.ts) as a single
// Deno HTTP server that routes /functions/v1/<name> exactly the way the
// deployed Supabase edge runtime does. Used instead of `supabase
// functions serve` because the CLI edge-runtime container fails to boot
// on this machine ("failed to determine entrypoint" — a CLI/image issue
// unrelated to the function code; see PHASE_4_IMPLEMENTATION_REPORT.md
// §20). The handler code, the DB it talks to, and the auth path are all
// identical to production; only the process wrapper differs.
//
// Run:  npm run functions:serve      (from the repo root)
// Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//       CRAAVEE_ALLOW_MOCK_CONTROL=1, PORT (default 54321-style 8790)

import { handleCreateOrder } from "../create_order/handler.ts";
import { handleValidatePromo } from "../validate_promo/handler.ts";
import { handleExpireStaleReservations } from "../expire_stale_reservations/handler.ts";
import { handlePaymentWebhook } from "../payment_webhook/handler.ts";
import { handleRefund } from "../refund/handler.ts";
import { handleMarkPacked } from "../mark_packed/handler.ts";
import { handleMarkStockOut } from "../mark_stock_out/handler.ts";

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  create_order: handleCreateOrder,
  validate_promo: handleValidatePromo,
  expire_stale_reservations: handleExpireStaleReservations,
  payment_webhook: handlePaymentWebhook,
  refund: handleRefund,
  mark_packed: handleMarkPacked,
  mark_stock_out: handleMarkStockOut,
};

const PORT = Number(Deno.env.get("FUNCTIONS_PORT") ?? "8790");

Deno.serve({ port: PORT, onListen: ({ port }) => console.log(`craavee edge functions on :${port}`) }, (req) => {
  const { pathname } = new URL(req.url);
  // accept both /functions/v1/<name> and /<name>
  const name = pathname.replace(/^\/functions\/v1\//, "/").split("/").filter(Boolean)[0];
  const handler = name ? ROUTES[name] : undefined;
  if (!handler) {
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: `no function '${name}'` } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return handler(req);
});
