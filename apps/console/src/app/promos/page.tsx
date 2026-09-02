import { OpsShell } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";

export default function ConsolePromosPage() {
  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="Promos" title="Promos" subtitle="Promo codes and campaigns">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          Route structure only — real promo CRUD (D26 concurrency-safe
          design, `promos`/`promo_redemptions`) is in PHASE_PLAN.md's Phase 9
          scope but was not in the 9B brief — still a route stub.
        </p>
      </div>
    </OpsShell>
  );
}
