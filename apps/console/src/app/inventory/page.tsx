import { OpsShell } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";

export default function ConsoleInventoryPage() {
  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="Inventory" title="Inventory" subtitle="Stock levels and reservations">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          Route structure only — real inventory queries (qty_on_hand /
          qty_reserved, DATABASE_SPEC.md §6) connect in Phase 9.
        </p>
      </div>
    </OpsShell>
  );
}
