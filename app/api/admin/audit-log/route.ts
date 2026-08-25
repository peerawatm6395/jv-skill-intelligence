import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/rbac";
import { withApiErrorHandling } from "@/lib/api-helpers";

/** Audit log (Architecture v3.0 §8.2, page /admin/audit-log). ADMIN/HRBP only. */
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");

  return withApiErrorHandling(async () => {
    await requireRole(["ADMIN", "HRBP"]);
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(Math.min(limit, 200));
    if (error) throw error;
    return { entries: data ?? [] };
  });
}
