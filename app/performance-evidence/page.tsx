import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PerformanceEvidenceIndexPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Performance Evidence" layerBadge="Layer 2" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: employees } = await supabase
    .from("employee")
    .select("employee_id, display_name, craft_code")
    .eq("is_current", true)
    .limit(50);

  return (
    <AppShell>
      <PageHeader
        title="Performance Evidence"
        layerBadge="Layer 2"
        description="What the system observed each employee do, complexity-normalized against peers doing comparably complex work. This is evidence of demonstrated output — deliberately not labeled a skill score. Select an employee to see the full 'show your work' detail."
      />
      {!employees || employees.length === 0 ? (
        <EmptyState message="No employees loaded yet." />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {employees.map((emp) => (
            <Link
              key={emp.employee_id}
              href={`/performance-evidence/${emp.employee_id}`}
              className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="font-medium text-gray-900">{emp.display_name}</div>
              <div className="text-xs text-gray-500">{emp.craft_code}</div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
