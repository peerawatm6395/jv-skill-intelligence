import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, canViewEmployee, ForbiddenError } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";
import { computeGapOrRelativeStanding } from "@/lib/calc-engine/layer4-skill-gap";
import type { EvidenceType } from "@/lib/types/domain";

/**
 * Skill Gap / Relative Standing (Architecture v3.0 §4 page 6, §F).
 * Falls back to Relative Standing mode when no active
 * skill_target_profile exists — never fabricates a target.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: employeeId } = await params;

  return withApiErrorHandling(async () => {
    const user = await requireRole(["ADMIN", "HRBP", "MANAGER", "SUPERVISOR", "VIEWER"]);
    const supabase = await createServerSupabaseClient();

    const { data: employee } = await supabase
      .from("employee")
      .select("employee_id, craft_code, skill_level_code, org_id")
      .eq("employee_id", employeeId)
      .eq("is_current", true)
      .maybeSingle();

    if (!employee) throw new ForbiddenError("Employee not found");
    if (!canViewEmployee(user, { org_id: employee.org_id, employee_id: employee.employee_id })) {
      throw new ForbiddenError("Not authorized to view this employee");
    }

    const { data: latestPeriod } = await supabase
      .from("kpi_result")
      .select("period_type, period_key")
      .eq("employee_id", employeeId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestPeriod) return { items: [] };

    const { data: dims } = await supabase
      .from("kpi_result")
      .select("kpi_code, score_0_100, evidence_type, confidence_level")
      .eq("employee_id", employeeId)
      .eq("period_type", latestPeriod.period_type)
      .eq("period_key", latestPeriod.period_key)
      .like("kpi_code", "SKILL_DIM_%");

    const items = await Promise.all(
      (dims ?? [])
        .filter((d) => d.score_0_100 !== null)
        .map(async (d) => {
          const { data: targetProfile } = await supabase
            .from("skill_target_profile")
            .select("target_percentile, minimum_evidence_type")
            .eq("craft_code", employee.craft_code)
            .eq("skill_dimension", d.kpi_code)
            .eq("is_active", true)
            .maybeSingle();

          const result = computeGapOrRelativeStanding({
            currentScore: d.score_0_100 as number,
            evidenceType: d.evidence_type as EvidenceType,
            confidenceLevel: d.confidence_level as "HIGH" | "MEDIUM" | "LOW",
            targetPercentile: targetProfile?.target_percentile ?? null,
            minimumEvidenceTypeRequired:
              (targetProfile?.minimum_evidence_type as EvidenceType | null) ?? null,
          });

          return { kpiCode: d.kpi_code, ...result };
        })
    );

    return { periodType: latestPeriod.period_type, periodKey: latestPeriod.period_key, items };
  });
}
