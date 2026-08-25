import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TrendAnalysisPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Trend Analysis" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: employees } = await supabase
    .from("employee")
    .select("employee_id, display_name")
    .eq("is_current", true)
    .limit(20);

  return (
    <AppShell>
      <PageHeader
        title="Trend Analysis"
        description="Selectable KPI + entity across all layers, with peer-median overlay and confidence shading for low-evidence periods. Select an employee below to view their trend page."
      />
      {!employees || employees.length === 0 ? (
        <EmptyState message="No employees loaded yet." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {employees.map((e) => (
            <Link
              key={e.employee_id}
              href={`/employees/${e.employee_id}/trend`}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              {e.display_name}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
