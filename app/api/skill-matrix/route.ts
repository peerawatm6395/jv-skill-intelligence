import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, RoleCapabilities } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/** Org-wide Skill Matrix (Architecture v3.0 §4 page, Blueprint v2.0 §10). */
export async function GET(req: NextRequest) {
  const craftFilter = req.nextUrl.searchParams.get("craft");
  const periodType = req.nextUrl.searchParams.get("periodType") ?? "MONTH";

  return withApiErrorHandling(async () => {
    const user = await requireRole(["ADMIN", "HRBP", "MANAGER"]);
    const supabase = await createServerSupabaseClient();

    let employeeQuery = supabase
      .from("employee")
      .select("employee_id, display_name, craft_code, skill_level_code, org_id")
      .eq("is_current", true);

    if (!RoleCapabilities.canViewOrgWide(user.role) && user.scoped_org_id) {
      employeeQuery = employeeQuery.eq("org_id", user.scoped_org_id);
    }
    if (craftFilter) {
      employeeQuery = employeeQuery.eq("craft_code", craftFilter);
    }

    const { data: employees } = await employeeQuery;
    if (!employees || employees.length === 0) return { rows: [] };

    const { data: latestPeriodRow } = await supabase
      .from("kpi_result")
      .select("period_key")
      .eq("period_type", periodType)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestPeriodRow) return { rows: [] };

    const employeeIds = employees.map((e) => e.employee_id);
    const { data: allDims } = await supabase
      .from("kpi_result")
      .select("employee_id, kpi_code, score_0_100, evidence_type, confidence_level")
      .in("employee_id", employeeIds)
      .eq("period_type", periodType)
      .eq("period_key", latestPeriodRow.period_key)
      .like("kpi_code", "SKILL_DIM_%");

    const rows = employees.map((emp) => ({
      employeeId: emp.employee_id,
      displayName: emp.display_name,
      craft: emp.craft_code,
      skillLevel: emp.skill_level_code,
      dimensions: (allDims ?? []).filter((d) => d.employee_id === emp.employee_id),
    }));

    return { periodType, periodKey: latestPeriodRow.period_key, rows };
  });
}
