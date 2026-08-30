import { OpsShell } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";

export default function ConsoleSettingsPage() {
  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="Settings" title="Settings" subtitle="Store hours, pause, queue threshold">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          Route structure only — real store config writes (`stores.
          is_open`/`pause_reason`/`max_queue_depth`, ENGINEERING_
          SPECIFICATION.md §11) connect in Phase 9.
        </p>
      </div>
    </OpsShell>
  );
}
