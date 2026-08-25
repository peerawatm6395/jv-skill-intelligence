import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/**
 * KPI Dictionary (Architecture v3.0 §4 page 12). All roles can read this —
 * it is the self-service methodology transparency page and requires zero
 * hardcoded copy: every field comes straight from kpi_dictionary.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(["ADMIN", "HRBP", "MANAGER", "SUPERVISOR", "VIEWER"]);
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from("kpi_dictionary")
      .select("*")
      .eq("is_active", true)
      .order("layer")
      .order("kpi_code");

    if (error) throw error;
    return { kpis: data ?? [] };
  });
}
