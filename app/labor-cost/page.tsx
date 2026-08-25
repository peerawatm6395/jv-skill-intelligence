import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LaborCostPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Labor Cost" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: rows } = await supabase
    .from("v_labor_confirmation_safe")
    .select("line_cost, employee_job_value")
    .limit(5000);

  const totalCost = (rows ?? []).reduce((s, r) => s + (r.line_cost ?? 0), 0);
  const totalValue = (rows ?? []).reduce((s, r) => s + (r.employee_job_value ?? 0), 0);

  return (
    <AppShell>
      <PageHeader
        title="Labor Cost"
        description="Cost figures use line_cost (PAYRATE × TOTALHRS) exclusively — the only individual employee cost field in this system. The source ACTLABCOST field (a work-order-level total) does not exist anywhere in this schema and cannot be selected here."
      />
      {!rows || rows.length === 0 ? (
        <EmptyState message="No labor data loaded yet." />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Total Labor Cost (sample)" value={`฿${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <Stat label="Total Value Generated (sample)" value={`฿${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <Stat
            label="Cost Efficiency Ratio"
            value={totalCost > 0 ? (totalValue / totalCost).toFixed(2) : "—"}
          />
        </div>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
