import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/ui/setup-notice";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { RadarChartClient } from "@/components/charts/radar-chart";

export const dynamic = "force-dynamic";

export default async function SkillRadarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Skill Radar" layerBadge="Layer 1" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: employee } = await supabase
    .from("employee")
    .select("display_name, craft_code, skill_level_code")
    .eq("employee_id", id)
    .eq("is_current", true)
    .maybeSingle();

  const { data: latestPeriod } = await supabase
    .from("kpi_result")
    .select("period_type, period_key")
    .eq("employee_id", id)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: dims } = latestPeriod
    ? await supabase
        .from("kpi_result")
        .select("kpi_code, score_0_100, evidence_type, confidence_level, kpi_dictionary(kpi_name)")
        .eq("employee_id", id)
        .eq("period_type", latestPeriod.period_type)
        .eq("period_key", latestPeriod.period_key)
        .like("kpi_code", "SKILL_DIM_%")
    : { data: [] };

  const chartData = (dims ?? []).map((d) => ({
    dimension: (d.kpi_dictionary as unknown as { kpi_name: string } | null)?.kpi_name ?? d.kpi_code,
    score: d.score_0_100 ?? 0,
  }));

  return (
    <AppShell>
      <PageHeader title={`Skill Radar — ${employee?.display_name ?? "Employee"}`} layerBadge="Layer 1" />
      {chartData.length === 0 ? (
        <EmptyState message="No Skill Intelligence scores calculated yet for this employee." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <RadarChartClient data={chartData} />
          <div className="mt-4 flex flex-wrap gap-2">
            {(dims ?? []).map((d) => (
              <EvidenceBadge key={d.kpi_code} evidenceType={d.evidence_type} confidenceLevel={d.confidence_level} compact />
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}
