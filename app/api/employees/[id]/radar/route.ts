import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, canViewEmployee, ForbiddenError } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/** Skill Radar data (Architecture v3.0 §4 page 3, §8). */
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

    if (!latestPeriod) return { axes: [] };

    const { data: dims } = await supabase
      .from("kpi_result")
      .select("kpi_code, score_0_100, evidence_type, confidence_level, kpi_dictionary(kpi_name)")
      .eq("employee_id", employeeId)
      .eq("period_type", latestPeriod.period_type)
      .eq("period_key", latestPeriod.period_key)
      .like("kpi_code", "SKILL_DIM_%");

    // Peer median overlay per axis, from the employee's own (craft, skill_level)
    // peer group — same period.
    const axes = await Promise.all(
      (dims ?? []).map(async (d) => {
        const { data: peerBench } = await supabase
          .from("peer_benchmark")
          .select("p50")
          .eq("craft_code", employee.craft_code)
          .eq("skill_level_code", employee.skill_level_code)
          .eq("kpi_code", d.kpi_code.replace("SKILL_DIM_", "PERF_"))
          .eq("period_type", latestPeriod.period_type)
          .eq("period_key", latestPeriod.period_key)
          .maybeSingle();

        return {
          kpiCode: d.kpi_code,
          name: (d.kpi_dictionary as unknown as { kpi_name: string } | null)?.kpi_name ?? d.kpi_code,
          score: d.score_0_100,
          evidenceType: d.evidence_type,
          confidenceLevel: d.confidence_level,
          peerMedianPercentile: peerBench?.p50 ?? null,
        };
      })
    );

    return { periodType: latestPeriod.period_type, periodKey: latestPeriod.period_key, axes };
  });
}
