import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TrendChartClient } from "@/components/charts/trend-chart";

export const dynamic = "force-dynamic";

export default async function EmployeeTrendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Trend" />
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

  const { data: series } = await supabase
    .from("kpi_result")
    .select("period_key, score_0_100")
    .eq("employee_id", id)
    .eq("kpi_code", "SKILL_OVERALL")
    .order("period_key", { ascending: true });

  let peerSeries: { period_key: string; p50: number | null }[] = [];
  if (employee) {
    const { data } = await supabase
      .from("peer_benchmark")
      .select("period_key, p50")
      .eq("craft_code", employee.craft_code)
      .eq("skill_level_code", employee.skill_level_code)
      .eq("kpi_code", "PERF_PRODUCTIVITY_ADJ")
      .order("period_key", { ascending: true });
    peerSeries = data ?? [];
  }

  const chartData = (series ?? []).map((s) => ({
    periodKey: s.period_key,
    employeeScore: s.score_0_100,
    peerMedian: peerSeries.find((p) => p.period_key === s.period_key)?.p50 ?? null,
  }));

  return (
    <AppShell>
      <PageHeader title={`Trend — ${employee?.display_name ?? "Employee"}`} description="Overall Skill Rating over time, with peer-median overlay. Periods with no qualifying data show as explicit gaps — never interpolated." />
      {chartData.length === 0 ? (
        <EmptyState message="No historical KPI results yet for this employee." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <TrendChartClient data={chartData} />
        </div>
      )}
    </AppShell>
  );
}
