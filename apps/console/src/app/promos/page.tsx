import { OpsShell } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";

export default function ConsolePromosPage() {
  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="Promos" title="Promos" subtitle="Promo codes and campaigns">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          Route structure only — real promo CRUD (D26 concurrency-safe
          design, `promos`/`promo_redemptions`) connects in Phase 9.
        </p>
      </div>
    </OpsShell>
  );
}
