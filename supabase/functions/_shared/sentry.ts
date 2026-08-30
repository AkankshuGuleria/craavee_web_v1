// Minimal Sentry capture for unexpected Edge Function failures
// (Phase 4 prompt §34). No-op when SENTRY_DSN is unset (local/CI).
//
// NEVER logs: OTP, payment secrets, service-role keys, wallet
// credentials, gateway signatures. Captured context is limited to
// non-sensitive identifiers: user id, order id, function name, error
// code, and a short message.

interface CaptureContext {
  fn: string;
  userId?: string;
  orderId?: string;
  code?: string;
  level?: "error" | "fatal";
  extra?: Record<string, string | number | boolean | null>;
}

const DSN = Deno.env.get("SENTRY_DSN");

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") {
      return [o.message, o.code, o.details, o.hint].filter(Boolean).join(" | ");
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export function captureException(err: unknown, ctx: CaptureContext): void {
  const message = messageOf(err);
  const payload = {
    fn: ctx.fn,
    level: ctx.level ?? "error",
    code: ctx.code ?? null,
    userId: ctx.userId ?? null,
    orderId: ctx.orderId ?? null,
    message,
    extra: ctx.extra ?? {},
  };

  // Structured console line is always emitted (picked up by Supabase's
  // own log drain); the HTTP POST to Sentry only happens when configured.
  console.error(`[craavee] ${JSON.stringify(payload)}`);

  if (!DSN) return;
  try {
    const u = new URL(DSN);
    const projectId = u.pathname.replace(/\//g, "");
    const host = u.host;
    const key = u.username;
    fetch(`https://${host}/api/${projectId}/store/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=craavee-edge/1.0`,
      },
      body: JSON.stringify({
        platform: "javascript",
        level: payload.level,
        logger: ctx.fn,
        message: `${ctx.fn}: ${message}`,
        tags: { fn: ctx.fn, code: payload.code },
        extra: { userId: payload.userId, orderId: payload.orderId, ...payload.extra },
      }),
    }).catch(() => {});
  } catch {
    // a malformed DSN must never take down the request path
  }
}
