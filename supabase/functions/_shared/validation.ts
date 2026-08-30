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
