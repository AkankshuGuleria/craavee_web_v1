import { z } from "zod";

// Base building blocks — Phase 2B §8's explicit minimum list. Every
// schema here is a direct encoding of a type/constraint already named in
// API_CONTRACTS.md; nothing below invents a business rule the spec
// doesn't already state.

export const uuidSchema = z.string().uuid();

// API_CONTRACTS.md `create_order`: "qty 1–20 per line (a sane per-SKU
// cap, not a dossier requirement — flagged as an engineering default,
// revisit if a real use case needs more)".
export const quantitySchema = z.number().int().min(1).max(20);

// D23 / API_CONTRACTS.md: client-generated, UUID-shaped.
export const idempotencyKeySchema = uuidSchema;

export const addressIdSchema = uuidSchema;
export const productIdSchema = uuidSchema;
export const orderIdSchema = uuidSchema;
export const orderItemIdSchema = uuidSchema;
export const runnerIdSchema = uuidSchema;

// `validate_promo`/`create_order`: promo codes are plain strings entered
// by the customer — API_CONTRACTS.md doesn't specify a format beyond
// "string", so this is intentionally permissive (length-bounded only, to
// reject obviously-malformed input at the edge) rather than guessing a
// character-set rule the spec doesn't state.
export const promoCodeSchema = z.string().min(1).max(64);

// D14 / API_CONTRACTS.md `verify_delivery_code`: "4-digit numeric".
export const deliveryCodeSchema = z.string().regex(/^\d{4}$/, "must be exactly 4 digits");

// D7: money is always integer paise, never negative for a single line
// amount. Used by composed schemas below where a request carries a money
// value (currently: none in the client-supplied request shapes, since
// API_CONTRACTS.md is explicit that the client never sends a price — kept
// here because `mark_stock_out`'s `availableQty` and similar
// non-negative-integer fields reuse the same shape).
export const nonNegativeIntSchema = z.number().int().min(0);

// Phase 3 — customer phone OTP sign-in (SECURITY_MODEL.md §1). This is a
// UX-only format check before calling Supabase Auth's `signInWithOtp`/
// `verifyOtp` — same governing rule as every other schema in this file
// (API_CONTRACTS.md §4): client validation is a nicety, never the
// enforcement point. Supabase Auth itself is the actual authority on
// whether a phone number is valid/sendable and an OTP is correct.
// E.164 (`+<country code><number>`, digits only after `+`, 8-15 digits
// total per the ITU E.164 standard) — permissive on country, since the
// dossier doesn't restrict Craavee to a single country and Supabase Auth
// itself is the real validator.
export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "must be a phone number in +<countrycode><number> format");

// Supabase's default SMS OTP length (`config.toml` doesn't override
// `auth.sms.otp_length`, so this is the platform default) and the same
// length used by the local `auth.sms.test_otp` fixtures.
export const otpCodeSchema = z.string().regex(/^\d{6}$/, "must be exactly 6 digits");
