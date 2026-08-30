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
