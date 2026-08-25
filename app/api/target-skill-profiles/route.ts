import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, RoleCapabilities, ForbiddenError } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/**
 * Skill Target Profile governance (Blueprint v2.0 §B.5, Architecture v3.0
 * §J item 2). This table ships empty at launch — Layer 4 (Skill Gap) runs
 * in Relative Standing mode until HRBP populates it here. The system
 * never invents a target on its own.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(["ADMIN", "HRBP"]);
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("skill_target_profile")
      .select("*, craft(craft_name)")
      .order("craft_code")
      .order("skill_dimension");
    if (error) throw error;
    return { profiles: data ?? [] };
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(["ADMIN", "HRBP"]);
    if (!RoleCapabilities.canApproveTargetSkillProfile(user.role)) {
      throw new ForbiddenError("Role cannot approve target skill profiles");
    }

    const body = (await req.json()) as {
      craftCode: string;
      roleLevel?: string;
      skillDimension: string;
      targetPercentile: number;
      minimumEvidenceType?: "SYSTEM_EVIDENCE_ONLY" | "HUMAN_VALIDATED" | "BLENDED";
      activate?: boolean;
    };

    if (body.targetPercentile < 0 || body.targetPercentile > 100) {
      return NextResponse.json({ error: "targetPercentile must be between 0 and 100" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    if (body.activate) {
      // Deactivate any prior profile for the same (craft, dimension) so
      // exactly one target is active per craft/dimension at a time.
      await supabase
        .from("skill_target_profile")
        .update({ is_active: false })
        .eq("craft_code", body.craftCode)
        .eq("skill_dimension", body.skillDimension);
    }

    const { data, error } = await supabase
      .from("skill_target_profile")
      .insert({
        craft_code: body.craftCode,
        role_level: body.roleLevel ?? null,
        skill_dimension: body.skillDimension,
        target_percentile: body.targetPercentile,
        minimum_evidence_type: body.minimumEvidenceType ?? null,
        approved_by: user.email,
        approved_at: new Date().toISOString(),
        is_active: body.activate ?? false,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ profile: data });
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
