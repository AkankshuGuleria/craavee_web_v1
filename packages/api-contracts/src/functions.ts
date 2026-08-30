// Request/response contract for every Edge Function API_CONTRACTS.md §3
// currently specifies, organized into the four mutation categories D31
// defines (plus the one advisory function). This package does NOT
// implement any function — Phase 2B §2's hard stop — it only types the
// wire contract so apps/customer-runner, apps/store, apps/console, and
// the eventual Edge Functions themselves (Phase 4+) share one source of
// truth instead of drifting.
//
// Request types are imported from @craavee/validation (the Zod schemas
// there are the actual runtime-enforced source; z.infer already gives us
// the exact TS shape — composed here, not re-declared) per the explicit
// instruction to compose rather than duplicate. Status/enum values reuse
// @craavee/types' generated database enums for the same reason.
import type {
  AdminCancelOrderRequest,
  AdminReassignRequest,
  AssignStaffRoleRequest,
  ClaimJobRequest,
  CreateOrderRequest,
  MarkDeliveryFailedRequest,
  MarkPackedRequest,
  MarkPickedUpRequest,
  MarkStockOutRequest,
  RefundRequest,
  ReleaseJobRequest,
  SettleRunnerEarningsRequest,
  ValidatePromoRequest,
  VerifyDeliveryCodeRequest,
} from "@craavee/validation";
import type { OrderStatus } from "@craavee/types";

// ============================================================
// Category 1 — Order & Payment Lifecycle
// ============================================================

export interface PaymentIntent {
  gateway: string;
  gatewayOrderRef: string;
  checkoutParams: object;
}

export interface CreateOrderResponse {
  orderId: string;
  status: Extract<OrderStatus, "created" | "confirmed"> | "payment_setup_in_progress";
  subtotal: number;
  /** Promo discount in paise (Phase 4, D33 — `orders.discount`). 0 when
   *  no promo applied or the promo was a wallet_credit type. */
  discount: number;
  deliveryFee: number;
  walletApplied: number;
  payable: number;
  paymentIntent?: PaymentIntent;
}

export interface RefundResponse {
  refundId: string;
  amount: number;
  walletCredited: number;
  gatewayRefunded: number;
}

// payment_webhook is not client-callable (gateway-signed, not JWT-authed)
// — API_CONTRACTS.md §3 — so it has no typed client request/response
// pair here; its authentication is signature verification, its request
// body shape is gateway-defined, and its response is always `{ok:true}`
// on success per that document.

// ============================================================
// Category 2 — Fulfilment Claim & Handoff
// ============================================================

export interface ClaimJobResponse {
  orderId: string;
  status: Extract<OrderStatus, "assigned">;
  address: { block: string; floor: string | null; room: string; landmark: string | null; zoneName: string };
  itemSummary: string;
}

export interface ReleaseJobResponse {
  orderId: string;
  status: Extract<OrderStatus, "packed">;
}

export interface MarkPickedUpResponse {
  orderId: string;
  status: Extract<OrderStatus, "picked_up">;
}

export interface VerifyDeliveryCodeResponse {
  orderId: string;
  status: Extract<OrderStatus, "delivered">;
}

export interface MarkDeliveryFailedResponse {
  orderId: string;
  status: Extract<OrderStatus, "delivery_failed">;
}

// ============================================================
// Category 3 — Store-Side Reconciliation
// ============================================================

export interface MarkPackedResponse {
  orderId: string;
  status: Extract<OrderStatus, "packed">;
}

export interface MarkStockOutResponse {
  orderItemId: string;
  fulfilledQty: number;
  refundAmount: number;
  newPayable: number;
}

// ============================================================
// Category 4 — Administrative / Privileged
// ============================================================

export interface AdminCancelOrderResponse {
  orderId: string;
  status: Extract<OrderStatus, "cancelled">;
}

export interface AdminReassignResponse {
  orderId: string;
  status: Extract<OrderStatus, "assigned">;
}

export interface AssignStaffRoleResponse {
  profileId: string;
  role: string;
  storeId: string | null;
}

export interface SettleRunnerEarningsResponse {
  settledCount: number;
  totalAmount: number;
}

// ============================================================
// Advisory (non-mutating)
// ============================================================

export interface ValidatePromoResponse {
  valid: boolean;
  discountAmount?: number;
  reason?: string;
}

// ============================================================
// Full function -> {request, response} map, one entry per D31 category
// member. Useful as a single import for a typed RPC client wrapper in a
// later phase; not itself an implementation.
// ============================================================
export interface EdgeFunctionContracts {
  create_order: { request: CreateOrderRequest; response: CreateOrderResponse };
  refund: { request: RefundRequest; response: RefundResponse };

  claim_job: { request: ClaimJobRequest; response: ClaimJobResponse };
  release_job: { request: ReleaseJobRequest; response: ReleaseJobResponse };
  mark_picked_up: { request: MarkPickedUpRequest; response: MarkPickedUpResponse };
  verify_delivery_code: { request: VerifyDeliveryCodeRequest; response: VerifyDeliveryCodeResponse };
  mark_delivery_failed: { request: MarkDeliveryFailedRequest; response: MarkDeliveryFailedResponse };

  mark_packed: { request: MarkPackedRequest; response: MarkPackedResponse };
  mark_stock_out: { request: MarkStockOutRequest; response: MarkStockOutResponse };

  admin_cancel_order: { request: AdminCancelOrderRequest; response: AdminCancelOrderResponse };
  admin_reassign: { request: AdminReassignRequest; response: AdminReassignResponse };
  assign_staff_role: { request: AssignStaffRoleRequest; response: AssignStaffRoleResponse };
  settle_runner_earnings: { request: SettleRunnerEarningsRequest; response: SettleRunnerEarningsResponse };

  validate_promo: { request: ValidatePromoRequest; response: ValidatePromoResponse };
}

export type EdgeFunctionName = keyof EdgeFunctionContracts;
