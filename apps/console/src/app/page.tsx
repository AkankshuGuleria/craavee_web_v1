import { OpsShell } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";

export default function ConsoleHomePage() {
  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="" title="Console" subtitle="Foundation shell — Phase 2B">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          This is the operations console foundation. Real data (live
          orders, catalog, inventory, staff, promos, settings) connects in
          a later phase — see <code>docs/engineering/PHASE_PLAN.md</code>{" "}
          Phase 9. Navigate the sidebar to see the route structure.
        </p>
      </div>
    </OpsShell>
  );
}
