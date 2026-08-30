import { OpsShell } from "@craavee/ui";
import { STORE_NAV } from "@/lib/nav";

export default function StoreInventoryPage() {
  return (
    <OpsShell brand="Craavee Store" navItems={STORE_NAV} active="Inventory" title="Inventory" subtitle="Stock levels and receive-stock intake">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          Route structure only — receive-stock tooling is explicitly
          scoped to Phase P1 in the dossier roadmap (§19), out of scope
          for this foundation.
        </p>
      </div>
    </OpsShell>
  );
}
