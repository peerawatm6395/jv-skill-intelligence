import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";
import clsx from "clsx";

export const dynamic = "force-dynamic";

function cellColor(score: number | null): string {
  if (score === null) return "bg-gray-50 text-gray-300";
  if (score >= 75) return "bg-emerald-100 text-emerald-800";
  if (score >= 50) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

export default async function SkillMatrixPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Skill Matrix" layerBadge="Layer 1" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: employees } = await supabase
    .from("employee")
    .select("employee_id, display_name, craft_code")
    .eq("is_current", true)
    .limit(50);

  const { data: dimensionKpis } = await supabase
    .from("kpi_dictionary")
    .select("kpi_code, kpi_name")
    .eq("layer", "SKILL_INTELLIGENCE")
    .neq("kpi_code", "SKILL_OVERALL")
    .order("kpi_code");

  if (!employees || employees.length === 0) {
    return (
      <AppShell>
        <PageHeader title="Skill Matrix" layerBadge="Layer 1" />
        <EmptyState message="No employees loaded yet." />
      </AppShell>
    );
  }

  const employeeIds = employees.map((e) => e.employee_id);
  const { data: allResults } = await supabase
    .from("kpi_result")
    .select("employee_id, kpi_code, score_0_100")
    .in("employee_id", employeeIds)
    .like("kpi_code", "SKILL_DIM_%");

  return (
    <AppShell>
      <PageHeader
        title="Skill Matrix"
        layerBadge="Layer 1"
        description="Org-wide heatmap. Cells shaded by score — hover for exact value. Colors are a visual aid only; open an employee's profile for the evidence-type badge behind any number."
      />
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="p-2">Employee</th>
              <th className="p-2">Craft</th>
              {(dimensionKpis ?? []).map((k) => (
                <th key={k.kpi_code} className="p-2 text-center">
                  {k.kpi_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.employee_id} className="border-b border-gray-50">
                <td className="p-2">
                  <Link href={`/employees/${emp.employee_id}`} className="text-indigo-600 hover:underline">
                    {emp.display_name}
                  </Link>
                </td>
                <td className="p-2 text-gray-600">{emp.craft_code}</td>
                {(dimensionKpis ?? []).map((k) => {
                  const result = (allResults ?? []).find(
                    (r) => r.employee_id === emp.employee_id && r.kpi_code === k.kpi_code
                  );
                  return (
                    <td key={k.kpi_code} className="p-1 text-center">
                      <span className={clsx("inline-block w-12 rounded py-1 font-medium", cellColor(result?.score_0_100 ?? null))}>
                        {result?.score_0_100 ?? "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
