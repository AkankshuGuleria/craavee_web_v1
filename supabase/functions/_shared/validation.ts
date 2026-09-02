// Request-shape validation — INPUT VALIDATION ONLY (API_CONTRACTS.md §4
// concern 1). Authorization and business invariants are NOT expressed
// here (they are checked in _shared/context.ts and migration 0004's
// functions respectively).
//
// This is a Deno-side mirror of packages/validation/src/requests.ts
// (`createOrderRequestSchema`, `validatePromoRequestSchema`) — the edge
// runtime cannot import the workspace package. The integration suite
// imports the real schemas from @craavee/validation and asserts these
// accept/reject the same payloads.

import { z } from "zod";

const uuid = z.string().uuid();
// API_CONTRACTS.md create_order: qty 1-20 per line.
const qty = z.number().int().min(1).max(20);

export const createOrderSchema = z.object({
  idempotencyKey: uuid,
  addressId: uuid,
  items: z.array(z.object({ productId: uuid, qty })).nonempty(),
  promoCode: z.string().min(1).max(64).optional(),
  useWallet: z.boolean().optional(),
});
export type CreateOrderBody = z.infer<typeof createOrderSchema>;

export const validatePromoSchema = z.object({
  code: z.string().min(1).max(64),
  orderSubtotal: z.number().int().min(0),
});
export type ValidatePromoBody = z.infer<typeof validatePromoSchema>;

// Deno-side mirror of packages/validation/src/requests.ts
// `refundRequestSchema` — API_CONTRACTS.md §3 refund. `amount` is an
// optional cap (omit for a full refund of the remaining captured
// amount); it is never trusted as the authoritative figure — the DB
// function server-computes and bounds it (Phase 5 §13).
export const refundSchema = z.object({
  orderId: uuid,
  idempotencyKey: uuid,
  amount: z.number().int().min(0).optional(),
  reason: z.string().min(1),
});
export type RefundBody = z.infer<typeof refundSchema>;

// API_CONTRACTS.md §"Store-Side Reconciliation" — mark_packed. The order
// id is the entire request: what gets packed, which lines are filled and
// how much stock moves are all decided server-side from the order itself.
export const markPackedSchema = z.object({
  orderId: uuid,
});
export type MarkPackedBody = z.infer<typeof markPackedSchema>;

// mark_stock_out. `availableQty` is a COUNT the packer observed on the
// shelf, not a monetary figure — the refund is derived from the stored
// order_items.unit_price inside process_stock_out and is never sent by
// the client (Phase 6 §13/§15). `delist` is an operational hint,
// defaulting server-side to true for a total miss. `idempotencyKey` keys
// the refunds row for the gateway-funded share.
export const markStockOutSchema = z.object({
  orderId: uuid,
  orderItemId: uuid,
  availableQty: z.number().int().min(0),
  delist: z.boolean().optional(),
  idempotencyKey: uuid,
});
export type MarkStockOutBody = z.infer<typeof markStockOutSchema>;

// ---- Phase 7: runner + last-mile delivery -------------------------
// Mirrors packages/validation's runner request schemas (the Deno side
// cannot import the npm workspace package). Every one of these carries
// an order id and nothing that could stand in for identity: no runnerId,
// no role, no storeId. Those are resolved server-side from the JWT and
// staff_roles, never accepted from the request (Phase 7 §8/§22).

// claim_job. The order id is the whole request; who is claiming is the
// caller's own resolved runners.id (D28).
export const claimJobSchema = z.object({ orderId: uuid });
export type ClaimJobBody = z.infer<typeof claimJobSchema>;

export const markPickedUpSchema = z.object({ orderId: uuid });
export type MarkPickedUpBody = z.infer<typeof markPickedUpSchema>;

export const releaseJobSchema = z.object({
  orderId: uuid,
  reason: z.string().max(500).optional(),
});
export type ReleaseJobBody = z.infer<typeof releaseJobSchema>;

// verify_delivery_code. `code` is a guess the runner types; it is
// compared against orders.delivery_code_hash server-side and is never
// logged or echoed back (D14).
export const verifyDeliveryCodeSchema = z.object({
  orderId: uuid,
  code: z.string().regex(/^\d{4}$/, "must be exactly 4 digits"),
});
export type VerifyDeliveryCodeBody = z.infer<typeof verifyDeliveryCodeSchema>;

// admin_reassign. `runnerId` is a runners.id (D28), not a profile id.
// Omitting it releases the order back to the general claim queue rather
// than naming a runner (API_CONTRACTS.md).
export const adminReassignSchema = z.object({
  orderId: uuid,
  runnerId: uuid.optional(),
});
export type AdminReassignBody = z.infer<typeof adminReassignSchema>;

// mark_delivery_failed (Phase 8). `reason` is required — a delivery
// failure that nobody can explain is not actionable by the admin who has
// to decide between reassignment and cancellation.
export const markDeliveryFailedSchema = z.object({
  orderId: uuid,
  reason: z.string().min(1).max(500),
});
export type MarkDeliveryFailedBody = z.infer<typeof markDeliveryFailedSchema>;

// register_push_token (Phase 8 §14). No profileId field exists, and that
// is deliberate: the owner is the caller the JWT verified, so a client
// cannot register a token against somebody else's account.
export const registerPushTokenSchema = z.object({
  token: z.string().min(1).max(255),
  platform: z.enum(["ios", "android", "web"]),
});
export type RegisterPushTokenBody = z.infer<typeof registerPushTokenSchema>;

// ---- Phase 9: admin operations -------------------------------------
// API_CONTRACTS.md §3 "Administrative / Privileged". Note what is NOT
// here: no amount on the cancel (the contract pairs every admin cancel
// with a FULL refund, so there is nothing for a browser to choose), no
// actorId anywhere (identity comes from the verified JWT, never the
// body), and no storeId on the pause beyond which store — the flag
// values are the only thing the caller supplies.

// admin_cancel_order. Reason is required: ORDER_STATE_MACHINE #9/#14
// both say "cancel_reason required (free text, admin-entered)".
export const adminCancelOrderSchema = z.object({
  orderId: uuid,
  idempotencyKey: uuid,
  reason: z.string().min(1).max(500),
});
export type AdminCancelOrderBody = z.infer<typeof adminCancelOrderSchema>;

// assign_staff_role. `role: null` revokes — "has no staff_roles row" IS
// the customer state, so there is no separate revoke endpoint.
export const assignStaffRoleSchema = z.object({
  profileId: uuid,
  role: z.enum(["packer", "runner", "admin"]).nullable(),
  storeId: uuid.optional(),
});
export type AssignStaffRoleBody = z.infer<typeof assignStaffRoleSchema>;

// settle_runner_earnings. Omitting orderIds settles everything currently
// unsettled for that runner.
export const settleRunnerEarningsSchema = z.object({
  runnerId: uuid,
  orderIds: z.array(uuid).min(1).optional(),
});
export type SettleRunnerEarningsBody = z.infer<typeof settleRunnerEarningsSchema>;

// set_service_pause — the kill switch. `pauseReason` is validated
// server-side too (closing without one is refused), because a UI that
// only asks nicely is not a validation layer.
export const setServicePauseSchema = z.object({
  storeId: uuid,
  isOpen: z.boolean(),
  pauseReason: z.string().max(200).optional(),
  maxQueueDepth: z.number().int().min(1).max(100000).optional(),
});
export type SetServicePauseBody = z.infer<typeof setServicePauseSchema>;

// ---- Phase 9B: administration ---------------------------------------
// Note what is NOT here: no `qtyReserved`. Reserved stock is owned by the
// order lifecycle, so there is no field for a human to type into it.
export const adminAdjustInventorySchema = z.object({
  storeId: uuid,
  productId: uuid,
  qtyOnHand: z.number().int().min(0).max(1_000_000),
  reason: z.string().min(1).max(200),
});
export type AdminAdjustInventoryBody = z.infer<typeof adminAdjustInventorySchema>;

// admin_upsert_product. Prices are integers in paise (D7) — a decimal
// here would be a rounding bug waiting for a customer.
export const adminUpsertProductSchema = z.object({
  productId: uuid.optional(),
  storeId: uuid,
  name: z.string().min(1).max(120),
  brand: z.string().max(80).optional(),
  category: z.string().min(1).max(60),
  unitLabel: z.string().max(40).optional(),
  mrp: z.number().int().min(0).max(10_000_000),
  salePrice: z.number().int().min(0).max(10_000_000),
  isListed: z.boolean().optional(),
});
export type AdminUpsertProductBody = z.infer<typeof adminUpsertProductSchema>;
