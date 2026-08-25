import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, canViewEmployee, ForbiddenError } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/**
 * Trend Analysis data for one employee (Architecture v3.0 §4 page 9, §12).
 * No smoothing/interpolation — periods with no qualifying data are
 * returned as explicit gaps, never interpolated (Blueprint v2.0 §12).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: employeeId } = await params;
  const kpiCode = req.nextUrl.searchParams.get("kpiCode") ?? "SKILL_OVERALL";
  const periodType = req.nextUrl.searchParams.get("periodType") ?? "MONTH";

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

    const { data: series } = await supabase
      .from("kpi_result")
      .select("period_key, score_0_100, evidence_type, confidence_level, calculated_at")
      .eq("employee_id", employeeId)
      .eq("kpi_code", kpiCode)
      .eq("period_type", periodType)
      .order("period_key", { ascending: true });

    const { data: peerSeries } = await supabase
      .from("peer_benchmark")
      .select("period_key, p50")
      .eq("craft_code", employee.craft_code)
      .eq("skill_level_code", employee.skill_level_code)
      .eq("kpi_code", kpiCode.replace("SKILL_DIM_", "PERF_").replace("SKILL_OVERALL", "PERF_PRODUCTIVITY_ADJ"))
      .eq("period_type", periodType)
      .order("period_key", { ascending: true });

    return {
      kpiCode,
      periodType,
      employeeSeries: series ?? [],
      peerMedianSeries: peerSeries ?? [],
    };
  });
}
