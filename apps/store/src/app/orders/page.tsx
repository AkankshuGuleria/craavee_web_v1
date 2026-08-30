import { OpsShell } from "@craavee/ui";
import { STORE_NAV } from "@/lib/nav";

export default function StoreOrdersPage() {
  return (
    <OpsShell brand="Craavee Store" navItems={STORE_NAV} active="Orders" title="Orders" subtitle="Confirmed orders awaiting packing">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          Route structure only — the confirmed-order queue (RBAC_MATRIX.md
          §5: packer sees confirmed/packed at own store) connects in
          Phase 6.
        </p>
      </div>
    </OpsShell>
  );
}
