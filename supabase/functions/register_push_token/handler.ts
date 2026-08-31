// register_push_token — Phase 8 §14.
//
// The request carries a token and a platform. It does NOT carry a
// profile id, and there is no field for one: the owner is the caller the
// JWT verified. That is what makes "never trust a client to assign a
// push token to another profile" structural rather than a convention —
// there is nothing to forge.
//
// push_tokens has no INSERT policy at all, so this function (running as
// service_role) is the only way a row is ever created.

import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { registerPushTokenSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "register_push_token";

export async function handleRegisterPushToken(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = registerPushTokenSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  // Any authenticated role may register a device — customers get order
  // notifications, and staff surfaces may later want them too.
  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_register_push_token", {
      p_profile_id: caller.userId,
      p_token: input.token,
      p_platform: input.platform,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      // The token itself is never put in Sentry context — it is a
      // routable address for this user's device.
      captureException(error, { fn: FN, userId: caller.userId, code: "PUSH_REGISTER_FAULT", level: "error" });
      return fail("SERVICE_UNAVAILABLE", "could not register for notifications", 500);
    }

    const r = data as Record<string, unknown>;
    if (typeof r.error === "string") {
      const code = r.error as Parameters<typeof fail>[0];
      return fail(code, code, httpStatusFor(code));
    }
    return ok({ registered: true });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, level: "error" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
