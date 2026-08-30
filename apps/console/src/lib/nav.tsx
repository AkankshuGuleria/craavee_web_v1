// `/ssr` entry point, not the bare package: the default
// @phosphor-icons/react export evaluates a client-only Context Provider
// at module scope that breaks Next.js's server/RSC "collect page data"
// build pass ("createContext is not a function") — found and fixed
// during Phase 2B build verification, not a style preference.
import {
  Lightning,
  Package,
  Stack,
  Users,
  Bicycle,
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
export const CONSOLE_NAV: OpsNavItem[] = [
  { href: "/orders", label: "Orders", icon: <Lightning size={18} weight="bold" /> },
  { href: "/catalog", label: "Catalog", icon: <Package size={18} weight="bold" /> },
  { href: "/inventory", label: "Inventory", icon: <Stack size={18} weight="bold" /> },
  { href: "/users", label: "Users", icon: <Users size={18} weight="bold" /> },
  { href: "/runners", label: "Runners", icon: <Bicycle size={18} weight="bold" /> },
  { href: "/promos", label: "Promos", icon: <Ticket size={18} weight="bold" /> },
  { href: "/settings", label: "Settings", icon: <GearSix size={18} weight="bold" /> },
];
