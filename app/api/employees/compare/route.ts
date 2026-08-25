import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, canViewEmployee, RoleCapabilities, ForbiddenError } from "@/lib/auth/rbac";

/**
 * Employee comparison, 2-3 employees, "FC Online" style
 * (Architecture v3.0 §4 page, Blueprint v2.0 §9).
 * Every employee's peer group is labeled explicitly since a percentile
 * score means something different across peer groups (§9 rule).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(["ADMIN", "HRBP", "MANAGER", "SUPERVISOR"]);
    if (!RoleCapabilities.canCompareEmployees(user.role)) {
      throw new ForbiddenError("This role cannot use the comparison feature");
    }

    const body = (await req.json()) as { employeeIds: string[]; periodType?: string };
    if (!body.employeeIds || body.employeeIds.length < 2 || body.employeeIds.length > 3) {
      return NextResponse.json({ error: "Provide 2-3 employeeIds" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const periodType = body.periodType ?? "MONTH";

    const results = await Promise.all(
      body.employeeIds.map(async (employeeId) => {
        const { data: employee } = await supabase
          .from("employee")
          .select("employee_id, display_name, craft_code, skill_level_code, org_id")
          .eq("employee_id", employeeId)
          .eq("is_current", true)
          .maybeSingle();

        if (!employee) return { employeeId, error: "Not found" };
        if (!canViewEmployee(user, { org_id: employee.org_id, employee_id: employee.employee_id })) {
          return { employeeId, error: "Not authorized" };
        }

        const { data: latestPeriod } = await supabase
          .from("kpi_result")
          .select("period_key")
          .eq("employee_id", employeeId)
          .eq("period_type", periodType)
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: dims } = latestPeriod
          ? await supabase
              .from("kpi_result")
              .select("kpi_code, score_0_100, evidence_type, confidence_level")
              .eq("employee_id", employeeId)
              .eq("period_type", periodType)
              .eq("period_key", latestPeriod.period_key)
              .like("kpi_code", "SKILL_DIM_%")
          : { data: [] };

        return {
          employeeId,
          displayName: employee.display_name,
          peerGroup: { craft: employee.craft_code, skillLevel: employee.skill_level_code },
          periodKey: latestPeriod?.period_key ?? null,
          dimensions: dims ?? [],
        };
      })
    );

    return NextResponse.json({ periodType, results });
  } catch (err) {
    if (err instanceof Error && err.name === "UnauthorizedError") {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof Error && err.name === "ForbiddenError") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
