# Craavee — In-Venue Commerce

Premium in-venue ordering experience built with Next.js, TypeScript, and Tailwind CSS v4.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 with `@tailwindcss/postcss`
- **Animation:** Motion (Framer Motion)
- **Icons:** Lucide React / Phosphor Icons
- **Fonts:** Outfit (display), Geist (body), Geist Mono (mono)

## Project Structure

```
src/
├── app/
│   ├── (auth)/
│   │   └── sign-in/        # Customer magic-link sign-in
│   ├── (shop)/
│   │   ├── page.tsx        # Product catalog
│   │   ├── cart/           # Cart bottom sheet
│   │   └── track/          # Order tracking (5-stage)
│   ├── (runner)/
│   │   ├── queue/          # Runner job queue
│   │   └── active/         # Active job / claim-pickup-deliver
│   ├── (admin)/
│   │   ├── catalog/        # Admin catalog/inventory
│   │   ├── live-ops/       # Admin live ops board
│   │   └── packing/        # Packing queue (pick list)
│   └── api/
│       ├── orders/         # Order CRUD
│       ├── products/       # Product CRUD
│       └── runner/queue/   # Runner queue operations
├── components/
│   ├── ui/                 # Shared UI components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   └── status-chip.tsx
│   └── layout/             # Layout components
├── lib/
│   └── utils.ts            # cn() helper
├── server/
│   └── services/           # Business logic services
│       ├── order.service.ts
│       ├── product.service.ts
│       └── user.service.ts
├── db/
│   ├── migrations/         # SQL schema files
│   ├── seeders/            # Seed data
│   └── repositories/       # Data access layer
│       ├── order.repository.ts
│       └── product.repository.ts
├── types/
│   └── index.ts            # TypeScript interfaces
└── styles/
    └── globals.css         # Global styles + Tailwind imports
```

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

## Design System

See `DESIGN.md` for the complete design system specification, including:
- Color palette (Obsidian, Charcoal, Ember accent)
- Typography (Outfit, Geist, Geist Mono)
- Component styling (glass panels, clay buttons, status chips)
- Motion philosophy (spring physics, perpetual micro-loops)
- Anti-patterns (no Inter, no pure black, no neon glows)

## Screens

| Screen | Route | Status |
|--------|-------|--------|
| Sign In | `/(auth)/sign-in` | ✅ Complete |
| Shop / Catalog | `/(shop)` | ✅ Complete |
| Cart | `/(shop)/cart` | ✅ Complete |
| Track Order | `/(shop)/track` | ✅ Complete |
| Runner Queue | `/(runner)/queue` | ✅ Complete |
| Runner Active Job | `/(runner)/active` | ✅ Complete |
| Admin Catalog | `/(admin)/catalog` | ✅ Complete |
| Admin Live Ops | `/(admin)/live-ops` | ✅ Complete |
| Admin Packing Queue | `/(admin)/packing` | ✅ Complete |

## Backend APIs

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/orders` | GET, POST, PATCH | Order lifecycle |
| `/api/products` | GET, POST | Product catalog |
| `/api/runner/queue` | GET, PATCH | Runner job queue |

## Next Steps

1. Connect API routes to database (SQLite/PostgreSQL)
2. Implement authentication (magic link / JWT)
3. Add real-time updates (WebSocket / Server-Sent Events)
4. Implement payment/credit system
5. Add image uploads for products
6. Implement runner GPS tracking
7. Add push notifications
8. Write tests (unit + integration)
