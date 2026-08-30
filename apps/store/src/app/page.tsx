import { OpsShell } from "@craavee/ui";
import { STORE_NAV } from "@/lib/nav";

export default function StoreHomePage() {
  return (
    <OpsShell brand="Craavee Store" navItems={STORE_NAV} active="" title="Store" subtitle="Foundation shell — Phase 2B">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          This is the store/packer operational foundation. Real data
          (confirmed/packed order queue, pick lists, receive-stock)
          connects in Phase 6 — see{" "}
          <code>docs/engineering/PHASE_PLAN.md</code>.
        </p>
      </div>
    </OpsShell>
  );
}
