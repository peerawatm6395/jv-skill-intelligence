import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/** Peer benchmark transparency data (Architecture v3.0 §4, /methodology/complexity page). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ craft: string; level: string }> }
) {
  const { craft, level } = await params;

  return withApiErrorHandling(async () => {
    await requireRole(["ADMIN", "HRBP", "MANAGER", "SUPERVISOR", "VIEWER"]);
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from("peer_benchmark")
      .select("*")
      .eq("craft_code", craft)
      .eq("skill_level_code", level)
      .order("period_key", { ascending: false })
      .limit(50);

    if (error) throw error;
    return { craft, level, benchmarks: data ?? [] };
  });
}
