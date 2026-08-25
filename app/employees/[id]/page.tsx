import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { SetupNotice } from "@/components/ui/setup-notice";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { EvidenceBadge, MeasurabilityTag } from "@/components/ui/evidence-badge";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EmployeeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Employee Profile" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();

  const { data: employee } = await supabase
    .from("employee")
    .select("employee_id, display_name, craft_code, skill_level_code")
    .eq("employee_id", id)
    .eq("is_current", true)
    .maybeSingle();

  if (!employee) {
    return (
      <AppShell>
        <PageHeader title="Employee Profile" />
        <EmptyState message="Employee not found, or you don't have access to view this profile." />
      </AppShell>
    );
  }

  const { data: latestPeriod } = await supabase
    .from("kpi_result")
    .select("period_type, period_key")
    .eq("employee_id", id)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: allResults } = latestPeriod
    ? await supabase
        .from("kpi_result")
        .select("kpi_code, score_0_100, evidence_type, confidence_level, kpi_dictionary(kpi_name, measurability, limitation_notes)")
        .eq("employee_id", id)
        .eq("period_type", latestPeriod.period_type)
        .eq("period_key", latestPeriod.period_key)
    : { data: [] };

  const overall = (allResults ?? []).find((r) => r.kpi_code === "SKILL_OVERALL");
  const dimensions = (allResults ?? []).filter(
    (r) => r.kpi_code !== "SKILL_OVERALL" && r.kpi_code.startsWith("SKILL_DIM_")
  );

  return (
    <AppShell>
      <PageHeader
        title={employee.display_name}
        description={`${employee.craft_code} · ${employee.skill_level_code} (administrative pay tier — not a skill score)`}
      />

      <div className="mb-4 flex gap-2">
        <Link href={`/employees/${id}/radar`} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
          Skill Radar
        </Link>
        <Link href={`/employees/${id}/gap`} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
          Skill Gap
        </Link>
        <Link href={`/employees/${id}/trend`} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
          Trend
        </Link>
        <Link href={`/performance-evidence/${id}`} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
          Performance Evidence Detail
        </Link>
      </div>

      {!latestPeriod ? (
        <EmptyState message="No KPI results calculated yet for this employee. Upload JV data covering this employee and run the KPI calculation." />
      ) : (
        <>
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Overall Rating · {latestPeriod.period_key}
                </div>
                <div className="mt-1 text-4xl font-bold text-gray-900">
                  {overall?.score_0_100 ?? "—"}
                  <span className="ml-1 text-lg font-normal text-gray-400">/100</span>
                </div>
              </div>
              <EvidenceBadge evidenceType={overall?.evidence_type ?? null} confidenceLevel={overall?.confidence_level ?? null} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {dimensions.map((d) => {
              const dict = d.kpi_dictionary as unknown as {
                kpi_name: string;
                measurability: "DIRECT" | "PROXY" | "REQUIRES_ADDITIONAL_DATA";
                limitation_notes: string | null;
              } | null;
              return (
                <div key={d.kpi_code} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-medium text-gray-900">{dict?.kpi_name ?? d.kpi_code}</span>
                    {dict && <MeasurabilityTag measurability={dict.measurability} />}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">
                    {d.score_0_100 ?? "—"}
                  </div>
                  <div className="mt-2">
                    <EvidenceBadge evidenceType={d.evidence_type} confidenceLevel={d.confidence_level} compact />
                  </div>
                  {dict?.limitation_notes && (
                    <p className="mt-2 text-xs text-gray-400">{dict.limitation_notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
