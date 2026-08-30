// Envelope + CORS helpers — API_CONTRACTS.md §2.
//
// Response (success): { ok: true, data: <T> }
// Response (failure): { ok: false, error: { code, message, details? } }
// Canonical error codes: packages/api-contracts/src/errors.ts (mirrored
// in ./errors.ts — kept in sync by the integration suite, which imports
// the real ERROR_CODES and asserts every code this function can emit is
// in it).

import type { ErrorCode } from "./errors.ts";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-craavee-mock-gateway",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

export function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: JSON_HEADERS });
}

export function fail(
  code: ErrorCode,
  message: string,
  httpStatus: number,
  details?: unknown,
): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message, ...(details ? { details } : {}) } }),
    { status: httpStatus, headers: JSON_HEADERS },
  );
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  return null;
}
