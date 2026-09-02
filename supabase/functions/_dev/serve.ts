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
import { handleClaimJob } from "../claim_job/handler.ts";
import { handleMarkPickedUp } from "../mark_picked_up/handler.ts";
import { handleReleaseJob } from "../release_job/handler.ts";
import { handleVerifyDeliveryCode } from "../verify_delivery_code/handler.ts";
import { handleAdminReassign } from "../admin_reassign/handler.ts";
import { handleMarkDeliveryFailed } from "../mark_delivery_failed/handler.ts";
import { handleRegisterPushToken } from "../register_push_token/handler.ts";
import { handleDispatchNotifications } from "../dispatch_notifications/handler.ts";
import { handleAdminCancelOrder } from "../admin_cancel_order/handler.ts";
import { handleAssignStaffRole } from "../assign_staff_role/handler.ts";
import { handleSettleRunnerEarnings } from "../settle_runner_earnings/handler.ts";
import { handleSetServicePause } from "../set_service_pause/handler.ts";
import { handleAdminAdjustInventory } from "../admin_adjust_inventory/handler.ts";
import { handleAdminUpsertProduct } from "../admin_upsert_product/handler.ts";

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  create_order: handleCreateOrder,
  validate_promo: handleValidatePromo,
  expire_stale_reservations: handleExpireStaleReservations,
  payment_webhook: handlePaymentWebhook,
  refund: handleRefund,
  mark_packed: handleMarkPacked,
  mark_stock_out: handleMarkStockOut,
  claim_job: handleClaimJob,
  mark_picked_up: handleMarkPickedUp,
  release_job: handleReleaseJob,
  verify_delivery_code: handleVerifyDeliveryCode,
  admin_reassign: handleAdminReassign,
  mark_delivery_failed: handleMarkDeliveryFailed,
  register_push_token: handleRegisterPushToken,
  dispatch_notifications: handleDispatchNotifications,
  admin_cancel_order: handleAdminCancelOrder,
  assign_staff_role: handleAssignStaffRole,
  settle_runner_earnings: handleSettleRunnerEarnings,
  set_service_pause: handleSetServicePause,
  admin_adjust_inventory: handleAdminAdjustInventory,
  admin_upsert_product: handleAdminUpsertProduct,
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
