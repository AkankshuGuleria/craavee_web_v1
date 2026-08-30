import Link from "next/link";

/**
 * Reached when a signed-in account has no packer/admin role — most often
 * a customer who followed a Store link. Deliberately says nothing about
 * what exists behind the gate.
 */
export default function NotAuthorizedPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold text-white">Not a store account</h1>
        <p className="text-sm text-white/60">
          This surface is for store staff. Your account does not have packing access — if that looks
          wrong, ask an admin to check your staff role.
        </p>
        <Link
          href="/sign-in"
          className="inline-flex h-11 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15"
        >
          Sign in with a different account
        </Link>
      </div>
    </main>
  );
}
