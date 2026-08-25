import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, RoleCapabilities, ForbiddenError } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/**
 * Import mapping profile management (Architecture v3.0 §3.2 — the
 * mechanism that lets a new monthly Excel shape be handled by adding a
 * row here, never by changing source code).
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(["ADMIN", "HRBP"]);
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("import_column_mapping_profile")
      .select("*")
      .eq("is_active", true)
      .order("effective_from", { ascending: false });
    if (error) throw error;
    return { profiles: data ?? [] };
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(["ADMIN"]);
    if (!RoleCapabilities.canManageMappingProfiles(user.role)) {
      throw new ForbiddenError("Only ADMIN can manage mapping profiles");
    }

    const body = (await req.json()) as {
      profileName: string;
      effectiveFrom: string;
      sheetNamePattern?: string;
      columnMapping: Record<string, string>;
      requiredColumns: string[];
      derivedFieldRules?: Record<string, unknown>;
    };

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("import_column_mapping_profile")
      .insert({
        profile_name: body.profileName,
        effective_from: body.effectiveFrom,
        sheet_name_pattern: body.sheetNamePattern ?? null,
        column_mapping: body.columnMapping,
        required_columns: body.requiredColumns,
        derived_field_rules: body.derivedFieldRules ?? null,
        is_active: true,
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
