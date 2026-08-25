import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { SetupNotice } from "@/components/ui/setup-notice";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { EvidenceBadge, MeasurabilityTag } from "@/components/ui/evidence-badge";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SkillIntelligencePage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Skill Intelligence" layerBadge="Layer 1" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();

  const { data: dimensionKpis } = await supabase
    .from("kpi_dictionary")
    .select("*")
    .eq("layer", "SKILL_INTELLIGENCE")
    .order("kpi_code");

  const { data: employees } = await supabase
    .from("employee")
    .select("employee_id, display_name, craft_code")
    .eq("is_current", true)
    .limit(25);

  return (
    <AppShell>
      <PageHeader
        title="Skill Intelligence"
        layerBadge="Layer 1"
        description="Blended Performance Evidence + Human Validation. Every score below carries an evidence-type badge — a plain gray badge means System Evidence Only, i.e. no supervisor has validated it yet."
      />

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Skill Dimensions Tracked</h2>
        <div className="grid grid-cols-2 gap-3">
          {(dimensionKpis ?? []).map((k) => (
            <div key={k.kpi_code} className="rounded border border-gray-100 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{k.kpi_name}</span>
                <MeasurabilityTag measurability={k.measurability} />
              </div>
              <p className="mt-1 text-xs text-gray-500">{k.business_question}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Employees</h2>
        {!employees || employees.length === 0 ? (
          <EmptyState message="No employees loaded yet. Upload JV data or run the demo seed script." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="pb-2">Employee</th>
                <th className="pb-2">Craft</th>
                <th className="pb-2">Overall Rating</th>
                <th className="pb-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {await Promise.all(
                employees.map(async (emp) => {
                  const { data: overall } = await supabase
                    .from("kpi_result")
                    .select("score_0_100, evidence_type, confidence_level")
                    .eq("employee_id", emp.employee_id)
                    .eq("kpi_code", "SKILL_OVERALL")
                    .order("calculated_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                  return (
                    <tr key={emp.employee_id} className="border-b border-gray-50">
                      <td className="py-2">
                        <Link href={`/employees/${emp.employee_id}`} className="text-indigo-600 hover:underline">
                          {emp.display_name}
                        </Link>
                      </td>
                      <td className="py-2 text-gray-600">{emp.craft_code}</td>
                      <td className="py-2 font-medium">{overall?.score_0_100 ?? "—"}</td>
                      <td className="py-2">
                        <EvidenceBadge
                          evidenceType={overall?.evidence_type ?? null}
                          confidenceLevel={overall?.confidence_level ?? null}
                          compact
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
