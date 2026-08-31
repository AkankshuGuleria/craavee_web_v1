"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Staff phone-OTP sign-in. Same Supabase auth architecture as the
 * customer app (D8) rather than a second mechanism — the role and
 * store_id claims that gate this app are minted server-side by
 * custom_access_token_hook from staff_roles at token issue.
 *
 * Nothing here decides authorization. A successful sign-in only proves
 * who you are; whether you may see the queue is decided by requireStaff()
 * on the server and, finally, by RLS.
 */
export default function StoreSignInPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) return setError(error.message);
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    setBusy(false);
    if (error) return setError(error.message);
    // Full reload so the server components re-read the refreshed cookie.
    router.replace("/orders");
    router.refresh();
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <form
        onSubmit={sent ? verify : sendCode}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-white/5 p-7"
      >
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-white">Craavee Console</h1>
          <p className="text-sm text-white/50">Staff sign-in</p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-white/40">Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            required
            disabled={sent}
            className="h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white outline-none focus:border-white/30 disabled:opacity-50"
          />
        </label>

        {sent && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-white/40">Code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 tracking-[0.3em] text-white outline-none focus:border-white/30"
            />
          </label>
        )}

        {error && <p className="text-sm text-red-300">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="h-12 w-full rounded-xl bg-white text-sm font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Working…" : sent ? "Verify and continue" : "Send code"}
        </button>
      </form>
    </main>
  );
}
