// `/ssr` entry point, not the bare package: the default
// @phosphor-icons/react export evaluates a client-only Context Provider
// at module scope that breaks Next.js's server/RSC "collect page data"
// build pass ("createContext is not a function") — found and fixed
// during Phase 2B build verification, not a style preference.
import {
  Gauge,
  Lightning,
  WarningOctagon,
  Package,
  Stack,
  Users,
  Bicycle,
  Receipt,
  ClipboardText,
  Ticket,
  GearSix,
} from "@phosphor-icons/react/ssr";
import type { OpsNavItem } from "@craavee/ui";

// Console route namespace (Phase 2B §5) — replaces the old bare
// /catalog, /live-ops, /packing routes the (admin) route group produced.
// Console owns administrative surfaces; Store (a separate app) owns
// packer/operational surfaces — see apps/store/src/lib/nav.tsx.
//
// Icons are rendered here (`<Lightning ... />`, a React ELEMENT) rather
// than passed as bare component references (`icon: Lightning`) — see
// OpsNavItem's doc comment in packages/ui/src/components/OpsShell.tsx
// for why passing the raw function across the Server→Client Component
// boundary fails at build time while a pre-rendered element does not.
// Phase 9A shipped Overview / Orders / Failures / Runners / Settings;
// Phase 9B adds Catalog, Inventory, Users, Refunds and Audit. Promos is
// the one remaining Phase 2B route stub — promo CRUD is in PHASE_PLAN's
// Phase 9 scope but was not in the 9B brief, so it stays a stub that says
// so rather than a half-built surface.
export const CONSOLE_NAV: OpsNavItem[] = [
  { href: "/overview", label: "Overview", icon: <Gauge size={18} weight="bold" /> },
  { href: "/orders", label: "Orders", icon: <Lightning size={18} weight="bold" /> },
  // Directly under Orders on purpose: a failed delivery is a customer who
  // paid and has nothing, and it should never be buried behind a submenu.
  { href: "/delivery-failures", label: "Failures", icon: <WarningOctagon size={18} weight="bold" /> },
  { href: "/catalog", label: "Catalog", icon: <Package size={18} weight="bold" /> },
  { href: "/inventory", label: "Inventory", icon: <Stack size={18} weight="bold" /> },
  { href: "/users", label: "Users", icon: <Users size={18} weight="bold" /> },
  { href: "/runners", label: "Runners", icon: <Bicycle size={18} weight="bold" /> },
  { href: "/refunds", label: "Refunds", icon: <Receipt size={18} weight="bold" /> },
  { href: "/promos", label: "Promos", icon: <Ticket size={18} weight="bold" /> },
  { href: "/audit", label: "Audit", icon: <ClipboardText size={18} weight="bold" /> },
  { href: "/settings", label: "Settings", icon: <GearSix size={18} weight="bold" /> },
];
