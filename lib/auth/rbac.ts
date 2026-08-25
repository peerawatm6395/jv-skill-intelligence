import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole, AppUserProfile } from "@/lib/types/domain";

/**
 * RBAC (Implementation Architecture v3.0 §8). This is the SECOND layer of
 * defense — Row-Level Security (0007_access_and_audit.sql) is the first
 * and holds even if a route handler has a bug. Every API route and every
 * server-rendered dashboard page must call requireRole()/getCurrentUser()
 * before querying anything employee-scoped.
 */

export class UnauthorizedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not authorized for this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Fetches the current session's app_user_profile row, or null if unauthenticated. */
export async function getCurrentUser(): Promise<AppUserProfile | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("app_user_profile")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !profile) return null;
  return profile as AppUserProfile;
}

/** Throws UnauthorizedError if not logged in, ForbiddenError if role not permitted. */
export async function requireRole(allowedRoles: AppRole[]): Promise<AppUserProfile> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  if (!allowedRoles.includes(user.role)) {
    throw new ForbiddenError(
      `Role ${user.role} is not permitted. Allowed: ${allowedRoles.join(", ")}`
    );
  }
  return user;
}

/**
 * Role capability matrix (Architecture v3.0 §8.1), expressed as helper
 * predicates so route handlers read declaratively rather than re-deriving
 * the rules inline.
 */
export const RoleCapabilities = {
  canUploadImport: (role: AppRole) => role === "ADMIN" || role === "HRBP",
  canManageMappingProfiles: (role: AppRole) => role === "ADMIN",
  canResolveDataQualityIssue: (role: AppRole) => role === "ADMIN",
  canApproveWeightProfile: (role: AppRole) => role === "ADMIN" || role === "HRBP",
  canApproveTargetSkillProfile: (role: AppRole) => role === "ADMIN" || role === "HRBP",
  canViewOrgWide: (role: AppRole) => role === "ADMIN" || role === "HRBP",
  canManageUsers: (role: AppRole) => role === "ADMIN",
  canViewAuditLog: (role: AppRole) => role === "ADMIN" || role === "HRBP",
  canEnterHumanValidation: (role: AppRole) =>
    role === "ADMIN" || role === "HRBP" || role === "SUPERVISOR",
  canReviewSkillGap: (role: AppRole) =>
    role === "ADMIN" || role === "HRBP" || role === "SUPERVISOR",
  canUseTeamBuilder: (role: AppRole) =>
    role === "ADMIN" || role === "HRBP" || role === "MANAGER",
  canCompareEmployees: (role: AppRole) => role !== "VIEWER",
} as const;

/**
 * Determines whether `viewer` is allowed to see data for `targetEmployeeId`
 * given its org_id, mirroring the RLS policy logic in
 * 0007_access_and_audit.sql (kept in application code too, for clear
 * 403 messaging rather than relying solely on RLS returning an empty set).
 */
export function canViewEmployee(
  viewer: AppUserProfile,
  target: { org_id: string | null; employee_id: string }
): boolean {
  if (viewer.role === "ADMIN" || viewer.role === "HRBP") return true;
  if (viewer.role === "MANAGER" || viewer.role === "SUPERVISOR") {
    return viewer.scoped_org_id !== null && viewer.scoped_org_id === target.org_id;
  }
  if (viewer.role === "VIEWER") {
    return viewer.linked_employee_id === target.employee_id;
  }
  return false;
}
