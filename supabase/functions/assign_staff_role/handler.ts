// assign_staff_role — API_CONTRACTS.md §3, RBAC_MATRIX.md §4/§5.
//
// `staff_roles` has NO client-facing RLS policy at all, for any role.
// This function is the only door in, which means the admin check is the
// function's own responsibility: the service role bypasses RLS, so there
// is no policy underneath to catch a mistake here.
//
// A `role: null` revokes. There is no separate revoke endpoint because
// "has no staff_roles row" IS the customer state — inventing a second
// verb would imply a third state that does not exist.
import { serviceClient, verifyCaller } from "../_shared/context.ts";
import { httpStatusFor, parseDbError } from "../_shared/errors.ts";
import { fail, ok, preflight } from "../_shared/http.ts";
import { assignStaffRoleSchema } from "../_shared/validation.ts";
import { captureException } from "../_shared/sentry.ts";

const FN = "assign_staff_role";

export async function handleAssignStaffRole(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("VALIDATION_FAILED", "POST only", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_FAILED", "body is not valid JSON", 400);
  }
  const parsed = assignStaffRoleSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "request shape is invalid", 400, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await verifyCaller(req);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") return fail("FORBIDDEN", "admin role required", 403);

  const db = serviceClient();
  try {
    const { data, error } = await db.rpc("process_assign_staff_role", {
      p_profile_id: input.profileId,
      p_actor_id: caller.userId,
      p_role: input.role,
      p_store_id: input.storeId ?? null,
    });

    if (error) {
      const mapped = parseDbError(error.message);
      if (mapped) return fail(mapped.code, mapped.detail || mapped.code, httpStatusFor(mapped.code));
      captureException(error, { fn: FN, userId: caller.userId, code: "STAFF_ROLE_FAULT", level: "error" });
      return fail("SERVICE_UNAVAILABLE", "the role could not be assigned, please retry", 500);
    }

    const r = data as Record<string, unknown>;
    return ok({ profileId: r.profileId, role: r.role ?? null, storeId: r.storeId ?? null });
  } catch (err) {
    captureException(err, { fn: FN, userId: caller.userId, level: "error" });
    return fail("SERVICE_UNAVAILABLE", "unexpected error, please retry", 500);
  }
}
