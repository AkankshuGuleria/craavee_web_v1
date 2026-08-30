import { z } from "zod";
import {
  addressIdSchema,
  deliveryCodeSchema,
  idempotencyKeySchema,
  nonNegativeIntSchema,
  orderIdSchema,
  orderItemIdSchema,
  productIdSchema,
  promoCodeSchema,
  quantitySchema,
  runnerIdSchema,
  uuidSchema,
} from "./primitives.ts";

// Request-shape schemas for the Edge Functions API_CONTRACTS.md §3
// currently specifies. These are INPUT VALIDATION only — the first of
// API_CONTRACTS.md §4's three separate concerns (input validation,
// authorization, business invariants); authorization and business-
// invariant checks are not, and cannot be, expressed as a Zod schema,
// and are not attempted here. The functions themselves are not
// implemented in this phase (Phase 2B §2 hard stop).

// Category 1 — Order & Payment Lifecycle
export const createOrderRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  addressId: addressIdSchema,
  items: z
    .array(
      z.object({
        productId: productIdSchema,
        qty: quantitySchema,
      })
    )
    .nonempty(),
  promoCode: promoCodeSchema.optional(),
  useWallet: z.boolean().optional(),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const refundRequestSchema = z.object({
  orderId: orderIdSchema,
  idempotencyKey: idempotencyKeySchema,
  amount: nonNegativeIntSchema.optional(),
  reason: z.string().min(1),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;

// Category 2 — Fulfilment Claim & Handoff
export const claimJobRequestSchema = z.object({ orderId: orderIdSchema });
export type ClaimJobRequest = z.infer<typeof claimJobRequestSchema>;

export const releaseJobRequestSchema = z.object({
  orderId: orderIdSchema,
  reason: z.string().optional(),
});
export type ReleaseJobRequest = z.infer<typeof releaseJobRequestSchema>;

export const markPickedUpRequestSchema = z.object({ orderId: orderIdSchema });
export type MarkPickedUpRequest = z.infer<typeof markPickedUpRequestSchema>;

export const verifyDeliveryCodeRequestSchema = z.object({
  orderId: orderIdSchema,
  code: deliveryCodeSchema,
});
export type VerifyDeliveryCodeRequest = z.infer<typeof verifyDeliveryCodeRequestSchema>;

export const markDeliveryFailedRequestSchema = z.object({
  orderId: orderIdSchema,
  reason: z.string().min(1),
});
export type MarkDeliveryFailedRequest = z.infer<typeof markDeliveryFailedRequestSchema>;

// Category 3 — Store-Side Reconciliation
export const markPackedRequestSchema = z.object({ orderId: orderIdSchema });
export type MarkPackedRequest = z.infer<typeof markPackedRequestSchema>;

export const markStockOutRequestSchema = z.object({
  orderId: orderIdSchema,
  orderItemId: orderItemIdSchema,
  availableQty: nonNegativeIntSchema,
  delist: z.boolean().optional(),
});
export type MarkStockOutRequest = z.infer<typeof markStockOutRequestSchema>;

// Category 4 — Administrative / Privileged
export const adminCancelOrderRequestSchema = z.object({
  orderId: orderIdSchema,
  reason: z.string().min(1),
});
export type AdminCancelOrderRequest = z.infer<typeof adminCancelOrderRequestSchema>;

export const adminReassignRequestSchema = z.object({
  orderId: orderIdSchema,
  runnerId: runnerIdSchema.optional(),
});
export type AdminReassignRequest = z.infer<typeof adminReassignRequestSchema>;

export const assignStaffRoleRequestSchema = z.object({
  profileId: uuidSchema,
  role: z.enum(["packer", "runner", "admin"]),
  storeId: uuidSchema.optional(),
});
export type AssignStaffRoleRequest = z.infer<typeof assignStaffRoleRequestSchema>;

export const settleRunnerEarningsRequestSchema = z.object({
  runnerId: runnerIdSchema,
  upToOrderIds: z.array(orderIdSchema).optional(),
});
export type SettleRunnerEarningsRequest = z.infer<typeof settleRunnerEarningsRequestSchema>;

// Advisory (non-mutating) — validate_promo
export const validatePromoRequestSchema = z.object({
  code: promoCodeSchema,
  orderSubtotal: nonNegativeIntSchema,
});
export type ValidatePromoRequest = z.infer<typeof validatePromoRequestSchema>;
