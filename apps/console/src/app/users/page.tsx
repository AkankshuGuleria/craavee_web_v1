import { OpsShell } from "@craavee/ui";
import { CONSOLE_NAV } from "@/lib/nav";

export default function ConsoleUsersPage() {
  return (
    <OpsShell brand="Craavee Console" navItems={CONSOLE_NAV} active="Users" title="Users" subtitle="Customers and support lookups">
      <div className="clay-card max-w-xl p-6">
        <p className="text-sm text-white/70">
          Route structure only — real customer/profile lookups
          (RBAC_MATRIX.md: admin full read) connects in Phase 9B.
        </p>
      </div>
    </OpsShell>
  );
}
