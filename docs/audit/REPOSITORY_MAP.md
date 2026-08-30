# Repository Map — craavee_web_v1

Audit date: 2026-08-29. Commit: `d079294c7f2c3a23587a925c97f99f9fc0c5b0dc`.
71 tracked files total (excluding `node_modules`, `.next`, `.git`).

## Full file tree

```
.
├── .gitignore
├── DESIGN.md                              # design system spec (see note below)
├── README.md                              # describes app as "in-venue commerce"
├── next-env.d.ts
├── next.config.ts                         # only picsum.photos allowlisted for next/image
├── package.json / package-lock.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── public/fonts/IndieFlower-Regular.ttf
└── src/
    ├── app/
    │   ├── (auth)/sign-in/page.tsx        # fake auth: any "x@y" string signs in
    │   ├── (admin)/                       # NOTE: route group, adds NO url prefix
    │   │   ├── catalog/page.tsx           # -> /catalog, hardcoded inline data
    │   │   ├── live-ops/page.tsx          # -> /live-ops, hardcoded inline data
    │   │   └── packing/page.tsx           # -> /packing, hardcoded inline data
    │   ├── (runner)/                      # NOTE: route group, adds NO url prefix
    │   │   ├── queue/page.tsx             # -> /queue, hardcoded inline data
    │   │   └── active/page.tsx            # -> /active, hardcoded inline data
    │   ├── api/
    │   │   ├── orders/route.ts            # GET/POST/PATCH, in-memory array A
    │   │   ├── products/route.ts          # GET/POST, in-memory array
    │   │   └── runner/queue/route.ts      # GET/PATCH, in-memory array B (diverges from A)
    │   ├── shop/
    │   │   ├── page.tsx                   # catalog, imports src/lib/products.ts
    │   │   ├── cart/page.tsx              # cart, localStorage via Providers
    │   │   └── track/page.tsx             # order tracking, static 5-stage UI
    │   ├── layout.tsx, loading.tsx, page.tsx  # landing page
    ├── components/
    │   ├── address/AddressSheet.tsx       # ONLY real external fetch: bigdatacloud.net reverse-geocode
    │   ├── home/ (LandingHero, LandingNavbar, ProductDiscovery)
    │   ├── layout/craavee-intro-gate.tsx
    │   ├── magicui/ (aurora-text, bento-grid, marquee, shimmer-button, warp-background)
    │   ├── providers.tsx                  # Auth/Cart/Address/Toast contexts, ALL localStorage
    │   ├── search/SearchOverlay.tsx
    │   ├── shop/ProductCard.tsx
    │   ├── site/ (AdminShell, Footer, SiteNav)
    │   └── ui/ (button, card, input, status-chip, glass-*, liquid-*, premium-button, ...)
    ├── db/
    │   ├── migrations/001_initial_schema.sql   # SQLite-flavored DDL, never executed
    │   ├── seeders/001_initial_data.sql
    │   └── repositories/
    │       ├── order.repository.ts        # 100% stub — every method returns [] / null
    │       └── product.repository.ts      # 100% stub — every method returns [] / null
    ├── hooks/use-motion-preference.ts
    ├── lib/
    │   ├── craavee-data.ts                # curated homepage content, references products by id
    │   ├── products.ts                    # 28-item mock catalog (source for /shop UI)
    │   └── utils.ts                       # cn() helper
    ├── server/services/
    │   ├── order.service.ts               # 100% stub — "Not implemented"
    │   ├── product.service.ts             # 100% stub — "Not implemented"
    │   └── user.service.ts                # 100% stub — "Not implemented"
    ├── styles/globals.css
    └── types/index.ts                     # domain types: venue/table/seat model
```

## Tech stack actually found vs. dossier §12

| Layer | Dossier (target) | Repository (actual) |
|---|---|---|
| Customer/Runner app | Expo · React Native | **Absent.** Next.js web pages only |
| Store/Console | Next.js · shadcn/ui | Next.js ✓, but custom design system, not shadcn/ui |
| Database | PostgreSQL via Supabase | **Absent.** No DB client, no connection, decorative SQLite-syntax DDL file only |
| Auth | Supabase Auth, phone OTP | **Absent.** `localStorage` fake auth, any string accepted |
| Authorization | Postgres RLS | **Absent.** No authorization mechanism anywhere (not client, not server) |
| Business logic | Supabase Edge Functions | **Absent.** Route Handlers exist but are unwired stubs |
| Payments | Razorpay/Cashfree | **Absent.** No payment code, no gateway reference anywhere |
| Realtime | Supabase Realtime | **Absent** |
| Notifications | expo-notifications | **Absent** (no Expo app to notify) |
| Observability | Sentry | **Absent** |
| Analytics | PostHog | **Absent** |
| Load testing | k6 | **Absent** |
| Cache | Redis (deferred) | Absent — accidentally compliant, not by design |
| Deployment | Vercel · EAS · Supabase | **Absent.** No `vercel.json`, no CI, no env config |

## Route map (as built from `next build`)

| Route | Type | Notes |
|---|---|---|
| `/` | static | Landing page |
| `/sign-in` | static | Fake auth form |
| `/shop`, `/shop/cart`, `/shop/track` | static | Customer surface, mock data |
| `/catalog` | static | Admin catalog — **no `/admin` prefix, unauthenticated** |
| `/live-ops` | static | Admin ops board — **no `/admin` prefix, unauthenticated** |
| `/packing` | static | Store/packer queue — **no `/admin` prefix, unauthenticated** |
| `/queue` | static | Runner job queue — **no `/runner` prefix, unauthenticated** |
| `/active` | static | Runner active job — **no `/runner` prefix, unauthenticated** |
| `/api/orders` | dynamic | GET/POST/PATCH against in-memory array |
| `/api/products` | dynamic | GET/POST against in-memory array |
| `/api/runner/queue` | dynamic | GET/PATCH against a **second, divergent** in-memory order array |

Next.js route groups `(admin)` and `(runner)` are a file-organization
convention only — they do not add `/admin` or `/runner` to the URL. Combined
with zero auth gating, this means the operations console and runner app are
reachable by anonymous users at plain, guessable URLs.

## Database schema as found vs. dossier §11 data model

| Dossier table | Repo equivalent | Gap |
|---|---|---|
| `customers` | `users` (role enum incl. customer/runner/admin) | No separate identity per role; no `wallet_balance`/`referral_code` |
| `addresses` (structured campus geo) | `tables` (venue seating) | Wrong domain entirely — seating, not hostel/block/room |
| `stores` | `venues` | Wrong domain entirely — venue, not micro-store; no `store_id` concept anywhere |
| `zones` | — | Missing entirely |
| `products` | `products` | Present but flat: no `mrp`/`sale_price` split, single `stock` int not inventory rows |
| `inventory` (`qty_on_hand`/`qty_reserved`) | — | Missing entirely — no reservation semantics possible |
| `orders` | `orders` | Present but no `store_id`, `idempotency_key`, `delivery_code`, `payment_status` |
| `order_items` | `order_items` | Present, minimal |
| `payments` | — | Missing entirely |
| `wallet_ledger` | `credit_ledger` | Present but names/semantics follow the superseded "event credit" model, not a real-money wallet ledger |
| `runners` | `runners` | Present, minimal |
| `runner_earnings` | — | Missing entirely |
| `promos` | — | Missing entirely |
| `audit_logs` | — | Missing entirely |

No RLS policies exist because no Postgres database exists to hold them. No
indexes beyond the ones declared (and unused) in the static SQL file.
