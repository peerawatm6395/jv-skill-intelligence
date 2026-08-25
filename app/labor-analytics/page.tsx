import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LaborAnalyticsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Productivity / Labor Analytics" layerBadge="Layer 3" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: results } = await supabase
    .from("kpi_result")
    .select("org_id, kpi_code, value, org_unit(team, plant)")
    .in("kpi_code", ["LABOR_OT_RATIO", "LABOR_UTILIZATION"])
    .not("org_id", "is", null)
    .limit(50);

  return (
    <AppShell>
      <PageHeader
        title="Productivity / Labor Analytics"
        layerBadge="Layer 3"
        description="Workload and scheduling metrics — OT ratio, utilization, planned-vs-reactive mix. This is explicitly NOT a skill measurement: high overtime can mean responsiveness or overload, and this page does not assert which."
      />
      {!results || results.length === 0 ? (
        <EmptyState message="No Labor Analytics results calculated yet. This layer is designed to be usable even before any Skill Intelligence decisions (weight profiles, target profiles) are approved." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {results.map((r, i) => {
            const org = r.org_unit as unknown as { team: string | null; plant: string | null } | null;
            return (
              <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-xs text-gray-500">
                  {org?.team ?? org?.plant ?? "Org"} · {r.kpi_code}
                </div>
                <div className="mt-1 text-xl font-semibold text-gray-900">{r.value ?? "—"}</div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
