import { OpsShell } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";

export default function ConsoleRunnersPage() {
  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="Runners" title="Runners" subtitle="Roster, shifts, and earnings settlement">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          Route structure only — runner roster/earnings settlement
          (`settle_runner_earnings`, API_CONTRACTS.md) connects in a
          later phase.
        </p>
      </div>
    </OpsShell>
  );
}
