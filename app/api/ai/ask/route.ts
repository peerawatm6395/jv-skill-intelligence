import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole, canViewEmployee } from "@/lib/auth/rbac";

/**
 * AI Workforce Assistant (Blueprint v2.0 — "explain, not replace the
 * calculation engine"). This endpoint NEVER computes a score itself —
 * it only assembles already-computed kpi_result rows (scoped to the
 * caller's RBAC access, same as every other route) as context for the
 * model, and requires the model to state which layer/evidence_type
 * every claim rests on.
 *
 * Requires ANTHROPIC_API_KEY to be set. Returns a clear 501 message
 * (not a crash) when it isn't configured, so the rest of the app
 * remains usable without it during early setup.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(["ADMIN", "HRBP", "MANAGER", "SUPERVISOR", "VIEWER"]);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "AI assistant is not configured. Set ANTHROPIC_API_KEY in your environment to enable it.",
        },
        { status: 501 }
      );
    }

    const body = (await req.json()) as { question: string; employeeId?: string };
    const supabase = await createServerSupabaseClient();

    let context = "";
    if (body.employeeId) {
      const { data: employee } = await supabase
        .from("employee")
        .select("employee_id, display_name, craft_code, skill_level_code, org_id")
        .eq("employee_id", body.employeeId)
        .eq("is_current", true)
        .maybeSingle();

      if (employee && canViewEmployee(user, { org_id: employee.org_id, employee_id: employee.employee_id })) {
        const { data: results } = await supabase
          .from("kpi_result")
          .select("kpi_code, score_0_100, evidence_type, confidence_level, kpi_dictionary(kpi_name, layer, limitation_notes)")
          .eq("employee_id", body.employeeId)
          .order("calculated_at", { ascending: false })
          .limit(30);

        context = JSON.stringify({ employee, results }, null, 2);
      }
    }

    const systemPrompt =
      "You are the JV Skill Intelligence workforce assistant. You explain pre-computed " +
      "KPI and Skill Intelligence data — you never calculate a new score yourself. " +
      "For every claim, state which layer it comes from (Performance Evidence, Skill " +
      "Intelligence, Labor Analytics, or Skill Gap) and its evidence_type " +
      "(SYSTEM_EVIDENCE_ONLY, HUMAN_VALIDATED, or BLENDED) and confidence_level. " +
      "If evidence_type is SYSTEM_EVIDENCE_ONLY, say so plainly rather than implying " +
      "supervisor validation exists. Never treat SKILLLEVEL, labor hours, or labor cost " +
      "as a skill measurement.";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: context
              ? `Context (pre-computed KPI data, scoped to my access level):\n${context}\n\nQuestion: ${body.question}`
              : body.question,
          },
        ],
      }),
    });

    const data = await response.json();
    return NextResponse.json({ answer: data });
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
