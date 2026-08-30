// /ssr entry point — see apps/console/src/lib/nav.tsx for why.
import { ClipboardText, Lightning, Stack } from "@phosphor-icons/react/ssr";
import type { OpsNavItem } from "@craavee/ui";

// Store route namespace (Phase 2B §5). Store owns the packer/operational
// surface (order queue, pick/pack, receive-stock) — Console (a separate
// app) owns administrative surfaces (pricing, promos, staff). See
// apps/console/src/lib/nav.tsx.
export const STORE_NAV: OpsNavItem[] = [
  { href: "/orders", label: "Orders", icon: <Lightning size={18} weight="bold" /> },
  { href: "/packing", label: "Packing", icon: <ClipboardText size={18} weight="bold" /> },
  { href: "/inventory", label: "Inventory", icon: <Stack size={18} weight="bold" /> },
];
