import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MeasurabilityTag } from "@/components/ui/evidence-badge";

export const dynamic = "force-dynamic";

export default async function PerformanceEvidenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Performance Evidence Detail" layerBadge="Layer 2" />
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

  interface EvidenceKpiRow {
    kpi_code: string;
    value: number | null;
    benchmark_percentile: number | null;
    complexity_coverage_pct: number | null;
    record_count: number | null;
    kpi_dictionary: {
      kpi_name: string;
      formula_description: string;
      measurability: "DIRECT" | "PROXY" | "REQUIRES_ADDITIONAL_DATA";
      limitation_notes: string | null;
      unit: string;
    } | null;
  }

  const { data: evidenceKpisRaw } = latestPeriod
    ? await supabase
        .from("kpi_result")
        .select(
          "kpi_code, value, benchmark_percentile, complexity_coverage_pct, record_count, " +
            "kpi_dictionary(kpi_name, formula_description, measurability, limitation_notes, unit)"
        )
        .eq("employee_id", id)
        .eq("period_type", latestPeriod.period_type)
        .eq("period_key", latestPeriod.period_key)
        .like("kpi_code", "PERF_%")
    : { data: [] };

  const evidenceKpis = (evidenceKpisRaw ?? []) as unknown as EvidenceKpiRow[];

  return (
    <AppShell>
      <PageHeader
        title={`Performance Evidence — ${employee?.display_name ?? "Employee"}`}
        layerBadge="Layer 2"
        description={`Peer group: ${employee?.craft_code} / ${employee?.skill_level_code}. Every metric below shows what fraction of the employee's hours had RELIABLE (Tier A, specific job-plan) complexity normalization vs. LOW_COVERAGE (Tier B, coarse) — never presented without that context.`}
      />
      {!evidenceKpis || evidenceKpis.length === 0 ? (
        <EmptyState message="No Performance Evidence calculated yet for this employee." />
      ) : (
        <div className="space-y-3">
          {evidenceKpis.map((k) => {
            const dict = k.kpi_dictionary;
            return (
              <div key={k.kpi_code} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-medium text-gray-900">{dict?.kpi_name ?? k.kpi_code}</span>
                    <div className="mt-0.5 text-xs text-gray-400">{dict?.formula_description}</div>
                  </div>
                  {dict && <MeasurabilityTag measurability={dict.measurability} />}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
                  <Metric label="Value" value={k.value !== null ? `${k.value} ${dict?.unit ?? ""}` : "—"} />
                  <Metric label="Benchmark Percentile" value={k.benchmark_percentile !== null ? `p${k.benchmark_percentile}` : "—"} />
                  <Metric
                    label="Complexity Coverage"
                    value={k.complexity_coverage_pct !== null ? `${k.complexity_coverage_pct}% Tier A` : "—"}
                    warn={k.complexity_coverage_pct !== null && k.complexity_coverage_pct < 30}
                  />
                  <Metric label="Records" value={String(k.record_count ?? 0)} />
                </div>
                {dict?.limitation_notes && <p className="mt-2 text-xs text-gray-400">{dict.limitation_notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={warn ? "font-medium text-amber-700" : "font-medium text-gray-900"}>{value}</div>
    </div>
  );
}
