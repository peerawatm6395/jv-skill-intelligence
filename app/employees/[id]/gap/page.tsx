import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { computeGapOrRelativeStanding } from "@/lib/calc-engine/layer4-skill-gap";
import type { ConfidenceLevel, EvidenceType } from "@/lib/types/domain";

export const dynamic = "force-dynamic";

export default async function EmployeeSkillGapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Skill Gap & Development" layerBadge="Layer 4" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: employee } = await supabase
    .from("employee")
    .select("display_name, craft_code")
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

  const hasActiveTargets = employee
    ? (
        await supabase
          .from("skill_target_profile")
          .select("profile_id", { count: "exact", head: true })
          .eq("craft_code", employee.craft_code)
          .eq("is_active", true)
      ).count! > 0
    : false;

  const items = await Promise.all(
    (dims ?? [])
      .filter((d) => d.score_0_100 !== null)
      .map(async (d) => {
        const { data: target } = employee
          ? await supabase
              .from("skill_target_profile")
              .select("target_percentile, minimum_evidence_type")
              .eq("craft_code", employee.craft_code)
              .eq("skill_dimension", d.kpi_code)
              .eq("is_active", true)
              .maybeSingle()
          : { data: null };

        const result = computeGapOrRelativeStanding({
          currentScore: d.score_0_100 as number,
          evidenceType: d.evidence_type as EvidenceType,
          confidenceLevel: d.confidence_level as ConfidenceLevel,
          targetPercentile: target?.target_percentile ?? null,
          minimumEvidenceTypeRequired: (target?.minimum_evidence_type as EvidenceType | null) ?? null,
        });

        const name = (d.kpi_dictionary as unknown as { kpi_name: string } | null)?.kpi_name ?? d.kpi_code;
        return { name, ...result };
      })
  );

  return (
    <AppShell>
      <PageHeader
        title={`Skill Gap — ${employee?.display_name ?? "Employee"}`}
        layerBadge="Layer 4"
        description={
          hasActiveTargets
            ? "Gap-to-target mode: comparing current scores against HRBP-approved craft targets."
            : "Relative Standing mode: no HRBP-approved target skill profile exists for this craft yet, so gaps are not fabricated — this shows percentile standing vs. peers only."
        }
      />
      {items.length === 0 ? (
        <EmptyState message="No Skill Intelligence scores calculated yet for this employee." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.name} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{item.name}</span>
                <EvidenceBadge evidenceType={item.evidenceType} confidenceLevel={item.confidenceLevel} compact />
              </div>
              <div className="mt-2 text-sm text-gray-600">
                Current: <span className="font-semibold text-gray-900">{item.currentScore}</span>
                {item.mode === "GAP_TO_TARGET" && (
                  <>
                    {" "}
                    · Target (p{item.targetPercentile}):{" "}
                    <span className="font-semibold text-gray-900">{item.targetPercentile}</span> · Gap:{" "}
                    <span className="font-semibold text-amber-700">{item.gapSize}</span>
                    {!item.isActionable && (
                      <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                        Not actionable — insufficient evidence type
                      </span>
                    )}
                    <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                      Pending supervisor review
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
