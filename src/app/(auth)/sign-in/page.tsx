"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EnvelopeSimple, ArrowRight, Lightning } from "@phosphor-icons/react";
import { Reveal } from "@/components/interactive";
import { useAuth } from "@/components/providers";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = decodeURIComponent(params.get("redirect") || "/shop");
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setLoading(true);
    setTimeout(() => {
      signIn(email);
      router.push(redirect);
    }, 700);
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col justify-center  px-5 py-16 sm:px-10 lg:w-1/2">
      <Link
        href="/"
        className="absolute left-5 top-6 inline-flex items-center gap-2 sm:left-10"
      >
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-green-600 font-display text-base font-black text-white shadow-[0_8px_18px_-6px_rgba(22,163,74,0.5)]">
          C
        </span>
        <span className="font-display text-lg font-extrabold tracking-tight text-neutral-900">
          Craavee
        </span>
      </Link>

      <div className="mx-auto w-full max-w-sm">
        <Reveal>
          <h1 className="font-display text-[clamp(1.8rem,4vw,2.6rem)] font-extrabold leading-tight tracking-tight text-neutral-900">
            Sign in to order
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">
            Browsing is open to everyone. Sign in when you're ready to get
            something delivered.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div className="clay-input flex items-center gap-3 px-5 py-3.5">
              <EnvelopeSimple size={18} weight="bold" className="shrink-0 text-neutral-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Email address"
                className="w-full bg-transparent text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-clay flex w-full cursor-pointer items-center justify-center gap-2 px-6 py-3.5 font-display text-sm font-bold disabled:opacity-70"
            >
              {loading ? (
                <>
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-white"
                        style={{
                          animation: "float-soft 0.7s ease-in-out infinite",
                          animationDelay: `${i * 0.12}s`,
                        }}
                      />
                    ))}
                  </span>
                  Signing in…
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight weight="bold" size={17} />
                </>
              )}
            </button>
          </form>
        </Reveal>

        <Reveal delay={0.14}>
          <p className="mt-6 text-xs text-neutral-400">
            Demo mode — any email signs you in instantly.
          </p>
        </Reveal>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <main className="relative flex min-h-[100dvh] flex-col lg:flex-row">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>

      {/* visual side — glass bento with floating clay tiles */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-green-50 via-[#fafaf7] to-yellow-50 lg:block lg:w-1/2">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-green-200/50 blur-3xl float-soft"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-16 right-10 h-56 w-56 rounded-full bg-yellow-200/60 blur-3xl"
        />

        <div className="relative flex h-full items-center justify-center p-12 tilt-scene">
          <div className="grid w-full max-w-md grid-cols-2 gap-4 tilt-card-3d">
            {[
              { emoji: "🥦", label: "Fresh veg", cls: "bg-white", delay: "0s" },
              { emoji: "🥛", label: "Dairy", cls: "glass-card", delay: "0.6s" },
              { emoji: "🍜", label: "Instant", cls: "glass-card", delay: "1.2s" },
              { emoji: "🍦", label: "Frozen", cls: "bg-white", delay: "1.8s" },
            ].map((t) => (
              <Reveal key={t.label}>
                <div
                  className={`clay-card ${t.cls} grid h-36 place-items-center gap-2 !rounded-3xl`}
                  style={{ animationDelay: t.delay }}
                >
                  <span className="text-4xl">{t.emoji}</span>
                  <span className="text-xs font-bold text-neutral-600">{t.label}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="absolute bottom-10 left-12 right-12">
          <div className="glass-card inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-green-700">
            <Lightning size={13} weight="fill" />
            Delivered fast · tracked live
          </div>
        </div>
      </div>
    </main>
  );
}