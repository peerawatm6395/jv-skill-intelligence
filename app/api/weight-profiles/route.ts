import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, RoleCapabilities, ForbiddenError } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/**
 * Weight profile governance (Architecture v3.0 §J item 10, page
 * /admin/weight-profiles). Weights are never invented by the system —
 * this endpoint only stores what ADMIN/HRBP explicitly approve.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(["ADMIN", "HRBP"]);
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("weight_profile")
      .select("*")
      .order("approved_at", { ascending: false });
    if (error) throw error;
    return { profiles: data ?? [] };
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(["ADMIN", "HRBP"]);
    if (!RoleCapabilities.canApproveWeightProfile(user.role)) {
      throw new ForbiddenError("Role cannot approve weight profiles");
    }

    const body = (await req.json()) as {
      profileName: string;
      weightsJson: Record<string, number>;
      humanValidationBlendWeight?: number;
      activate?: boolean;
    };

    const supabase = await createServerSupabaseClient();

    if (body.activate) {
      // Only one active profile at a time (enforced also by a DB unique
      // partial index — see 0005_kpi_engine.sql).
      await supabase.from("weight_profile").update({ is_active: false }).eq("is_active", true);
    }

    const { data, error } = await supabase
      .from("weight_profile")
      .insert({
        profile_name: body.profileName,
        approved_by: user.email,
        approved_at: new Date().toISOString(),
        weights_json: body.weightsJson,
        human_validation_blend_weight: body.humanValidationBlendWeight ?? null,
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
