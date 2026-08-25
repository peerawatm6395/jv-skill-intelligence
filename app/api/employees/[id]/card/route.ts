import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, canViewEmployee } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";
import { ForbiddenError } from "@/lib/auth/rbac";

/**
 * Employee Player Card (Architecture v3.0 §4 page 3, §14).
 * Reads ONLY from kpi_result — never recomputes a score inline.
 * Every SKILL_INTELLIGENCE-layer entry is returned with its mandatory
 * evidence_type/confidence_level, per §6 enforcement.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: employeeId } = await params;

  return withApiErrorHandling(async () => {
    const user = await requireRole(["ADMIN", "HRBP", "MANAGER", "SUPERVISOR", "VIEWER"]);
    const supabase = await createServerSupabaseClient();

    const { data: employee, error: employeeError } = await supabase
      .from("employee")
      .select("employee_id, display_name, craft_code, skill_level_code, org_id, is_current")
      .eq("employee_id", employeeId)
      .eq("is_current", true)
      .maybeSingle();

    if (employeeError || !employee) {
      throw new ForbiddenError("Employee not found or not visible to this account");
    }

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

    if (!latestPeriod) {
      return {
        employee,
        periodType: null,
        periodKey: null,
        overall: null,
        dimensions: [],
        message: "No KPI results calculated yet for this employee.",
      };
    }

    interface CardKpiRow {
      kpi_code: string;
      score_0_100: number | null;
      benchmark_percentile: number | null;
      evidence_type: string | null;
      confidence_level: string | null;
      complexity_coverage_pct: number | null;
      record_count: number | null;
      kpi_dictionary: { kpi_name: string; layer: string; measurability: string; limitation_notes: string | null } | null;
    }

    const { data: resultsRaw } = await supabase
      .from("kpi_result")
      .select(
        "kpi_code, score_0_100, benchmark_percentile, evidence_type, confidence_level, " +
          "complexity_coverage_pct, record_count, kpi_dictionary(kpi_name, layer, measurability, limitation_notes)"
      )
      .eq("employee_id", employeeId)
      .eq("period_type", latestPeriod.period_type)
      .eq("period_key", latestPeriod.period_key);

    const results = (resultsRaw ?? []) as unknown as CardKpiRow[];

    const overall = results.find((r) => r.kpi_code === "SKILL_OVERALL") ?? null;
    const dimensions = results.filter(
      (r) => r.kpi_code !== "SKILL_OVERALL" && r.kpi_code.startsWith("SKILL_DIM_")
    );

    return {
      employee,
      periodType: latestPeriod.period_type,
      periodKey: latestPeriod.period_key,
      overall,
      dimensions,
    };
  });
}
