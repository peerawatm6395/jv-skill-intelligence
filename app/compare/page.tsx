import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { EvidenceBadge } from "@/components/ui/evidence-badge";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Compare Employees" layerBadge="Layer 1" />
        <SetupNotice />
      </AppShell>
    );
  }

  const employeeIds = ids ? ids.split(",").filter(Boolean).slice(0, 3) : [];

  if (employeeIds.length < 2) {
    return (
      <AppShell>
        <PageHeader
          title="Compare Employees"
          layerBadge="Layer 1"
          description="FC Online-style 2-3 employee comparison. Pass ?ids=<id1>,<id2> to compare."
        />
        <EmptyState message="Select 2-3 employees to compare (e.g. append ?ids=<employeeId1>,<employeeId2> to this URL)." />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();

  const employees = await Promise.all(
    employeeIds.map(async (id) => {
      const { data: employee } = await supabase
        .from("employee")
        .select("employee_id, display_name, craft_code, skill_level_code")
        .eq("employee_id", id)
        .eq("is_current", true)
        .maybeSingle();
      if (!employee) return null;

      const { data: latestPeriod } = await supabase
        .from("kpi_result")
        .select("period_key")
        .eq("employee_id", id)
        .order("calculated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: dims } = latestPeriod
        ? await supabase
            .from("kpi_result")
            .select("kpi_code, score_0_100, evidence_type, confidence_level, kpi_dictionary(kpi_name)")
            .eq("employee_id", id)
            .eq("period_key", latestPeriod.period_key)
            .like("kpi_code", "SKILL_DIM_%")
        : { data: [] };

      return { employee, dims: dims ?? [] };
    })
  );

  const validEmployees = employees.filter((e): e is NonNullable<typeof e> => e !== null);
  const allDimCodes = [...new Set(validEmployees.flatMap((e) => e.dims.map((d) => d.kpi_code)))];

  return (
    <AppShell>
      <PageHeader
        title="Compare Employees"
        layerBadge="Layer 1"
        description="Each employee's peer group is shown explicitly — a percentile score means something different across peer groups."
      />

      <div className="mb-4 grid gap-4" style={{ gridTemplateColumns: `repeat(${validEmployees.length}, 1fr)` }}>
        {validEmployees.map(({ employee }) => (
          <div key={employee.employee_id} className="rounded-lg border border-gray-200 bg-white p-4 text-center">
            <div className="font-semibold text-gray-900">{employee.display_name}</div>
            <div className="text-xs text-gray-500">
              Peer group: {employee.craft_code} / {employee.skill_level_code}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="pb-2">Dimension</th>
              {validEmployees.map(({ employee }) => (
                <th key={employee.employee_id} className="pb-2">
                  {employee.display_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allDimCodes.map((code) => (
              <tr key={code} className="border-b border-gray-50">
                <td className="py-2 text-gray-700">
                  {(validEmployees[0]?.dims.find((d) => d.kpi_code === code)?.kpi_dictionary as unknown as { kpi_name: string } | null)?.kpi_name ?? code}
                </td>
                {validEmployees.map(({ employee, dims }) => {
                  const d = dims.find((x) => x.kpi_code === code);
                  return (
                    <td key={employee.employee_id} className="py-2">
                      <span className="mr-2 font-medium">{d?.score_0_100 ?? "—"}</span>
                      <EvidenceBadge evidenceType={d?.evidence_type ?? null} confidenceLevel={d?.confidence_level ?? null} compact />
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
