import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, RoleCapabilities, ForbiddenError } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/**
 * User & role management (Architecture v3.0 §8, page /admin/users). ADMIN
 * only. Role assignment here is what RLS policies (0007_access_and_audit.sql)
 * and lib/auth/rbac.ts both key off of — this is the single place a
 * person's access level is set.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(["ADMIN"]);
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("app_user_profile")
      .select("*, org_unit(team, plant), employee(display_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { users: data ?? [] };
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(["ADMIN"]);
    if (!RoleCapabilities.canManageUsers(user.role)) {
      throw new ForbiddenError("Only ADMIN can manage users");
    }

    const body = (await req.json()) as {
      userId: string;
      role: "ADMIN" | "HRBP" | "MANAGER" | "SUPERVISOR" | "VIEWER";
      scopedOrgId?: string | null;
      linkedEmployeeId?: string | null;
      isActive?: boolean;
    };

    // Role/scope changes use the service-role client deliberately: an
    // ADMIN updating another user's role is exactly the case RLS's
    // self-row policy on app_user_profile would otherwise block.
    const service = createServiceRoleClient();
    const { data, error } = await service
      .from("app_user_profile")
      .update({
        role: body.role,
        scoped_org_id: body.scopedOrgId ?? null,
        linked_employee_id: body.linkedEmployeeId ?? null,
        is_active: body.isActive ?? true,
      })
      .eq("user_id", body.userId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ user: data });
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
