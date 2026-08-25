import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, RoleCapabilities, ForbiddenError } from "@/lib/auth/rbac";

/**
 * Team Builder / Best Employee Recommendation (Blueprint v2.0 §13).
 * Reuses the same active weight_profile mechanism as Overall Rating —
 * does not invent its own separate scoring logic. Excludes LOW-confidence
 * scores by default (overridable) and always returns the per-axis
 * contribution so the ranking is explainable, not a black box.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(["ADMIN", "HRBP", "MANAGER"]);
    if (!RoleCapabilities.canUseTeamBuilder(user.role)) {
      throw new ForbiddenError("Role cannot use Team Builder");
    }

    const body = (await req.json()) as {
      craftCode: string;
      minScoresByDimension?: Record<string, number>; // e.g. { SKILL_DIM_CM: 70 }
      excludeLowConfidence?: boolean;
      orgScope?: string;
      headcount?: number;
    };

    const supabase = await createServerSupabaseClient();
    const excludeLow = body.excludeLowConfidence ?? true;

    let employeeQuery = supabase
      .from("employee")
      .select("employee_id, display_name, craft_code, skill_level_code, org_id")
      .eq("is_current", true)
      .eq("craft_code", body.craftCode);

    if (body.orgScope) employeeQuery = employeeQuery.eq("org_id", body.orgScope);
    if (!RoleCapabilities.canViewOrgWide(user.role) && user.scoped_org_id) {
      employeeQuery = employeeQuery.eq("org_id", user.scoped_org_id);
    }

    const { data: candidates } = await employeeQuery;
    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const { data: activeWeightProfile } = await supabase
      .from("weight_profile")
      .select("weight_profile_id, weights_json")
      .eq("is_active", true)
      .maybeSingle();

    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const { data: latestPeriod } = await supabase
          .from("kpi_result")
          .select("period_key")
          .eq("employee_id", candidate.employee_id)
          .eq("kpi_code", "SKILL_OVERALL")
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestPeriod) return null;

        const { data: dims } = await supabase
          .from("kpi_result")
          .select("kpi_code, score_0_100, evidence_type, confidence_level")
          .eq("employee_id", candidate.employee_id)
          .eq("period_key", latestPeriod.period_key)
          .like("kpi_code", "SKILL_DIM_%");

        const { data: overall } = await supabase
          .from("kpi_result")
          .select("score_0_100, evidence_type, confidence_level")
          .eq("employee_id", candidate.employee_id)
          .eq("kpi_code", "SKILL_OVERALL")
          .eq("period_key", latestPeriod.period_key)
          .maybeSingle();

        if (!overall || overall.score_0_100 === null) return null;
        if (excludeLow && overall.confidence_level === "LOW") return null;

        const thresholds = body.minScoresByDimension ?? {};
        for (const [kpiCode, minScore] of Object.entries(thresholds)) {
          const d = (dims ?? []).find((x) => x.kpi_code === kpiCode);
          if (!d || d.score_0_100 === null || d.score_0_100 < minScore) return null;
        }

        return {
          employeeId: candidate.employee_id,
          displayName: candidate.display_name,
          craft: candidate.craft_code,
          skillLevel: candidate.skill_level_code,
          overallScore: overall.score_0_100,
          overallEvidenceType: overall.evidence_type,
          overallConfidenceLevel: overall.confidence_level,
          dimensionBreakdown: dims ?? [],
        };
      })
    );

    const ranked = results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
      .slice(0, body.headcount ?? 20);

    return NextResponse.json({
      weightProfileId: activeWeightProfile?.weight_profile_id ?? null,
      results: ranked,
    });
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
