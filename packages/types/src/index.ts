// Generated Supabase types (src/database.ts) are the source of truth for
// every table/enum/view shape — DO NOT hand-maintain a duplicate schema
// type definition here (Phase 2 prompt §28). Regenerate with `npm run gen`
// (in this package) whenever a migration changes, against the local
// Supabase instance (`supabase start` first).
export * from "./database";
export type { Database, Json } from "./database";

import type { Database } from "./database";

// Convenience row/enum aliases — thin type-level sugar over the generated
// types, not a competing hand-written schema. Extend as apps/packages
// need specific shapes; every alias below still resolves back to
// database.ts under the hood.
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];

export type Profile = Tables<"profiles">;
export type Order = Tables<"orders">;
export type OrderItem = Tables<"order_items">;
export type Payment = Tables<"payments">;
export type Refund = Tables<"refunds">;
export type Product = Tables<"products">;
export type Inventory = Tables<"inventory">;
export type Runner = Tables<"runners">;
export type Store = Tables<"stores">;
export type Zone = Tables<"zones">;
export type Address = Tables<"addresses">;
export type Promo = Tables<"promos">;
export type Campaign = Tables<"campaigns">;

export type OrderStatus = Enums<"order_status">;
export type PaymentStatus = Enums<"payment_status">;
export type UserRole = Enums<"user_role">;
export type WalletLedgerReason = Enums<"wallet_ledger_reason">;
