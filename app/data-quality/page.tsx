import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import clsx from "clsx";

export const dynamic = "force-dynamic";

const SEVERITY_COLOR: Record<string, string> = {
  BLOCKING: "bg-red-100 text-red-800",
  WARNING: "bg-amber-100 text-amber-800",
  INFO: "bg-gray-100 text-gray-600",
};

export default async function DataQualityPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Data Quality" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: issues } = await supabase
    .from("data_quality_issue")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(100);

  const { data: cutStats } = await supabase
    .from("labor_confirmation")
    .select("data_quality_flag");

  const cutCount = (cutStats ?? []).filter((r) => r.data_quality_flag !== "USE").length;
  const totalCount = cutStats?.length ?? 0;

  return (
    <AppShell>
      <PageHeader
        title="Data Quality"
        description="Operational trust page: open issues by severity, unrecognized-code review queue, excluded-row counts."
      />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Total Labor Rows" value={String(totalCount)} />
        <Stat label="Excluded (CUT/ERROR)" value={`${cutCount} (${totalCount > 0 ? Math.round((cutCount / totalCount) * 100) : 0}%)`} />
        <Stat label="Open Issues" value={String((issues ?? []).filter((i) => !i.resolved).length)} />
      </div>

      {!issues || issues.length === 0 ? (
        <EmptyState message="No data quality issues recorded yet." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="p-2">Type</th>
                <th className="p-2">Severity</th>
                <th className="p-2">Field</th>
                <th className="p-2">Value</th>
                <th className="p-2">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.issue_id} className="border-b border-gray-50">
                  <td className="p-2">{issue.issue_type}</td>
                  <td className="p-2">
                    <span className={clsx("rounded px-1.5 py-0.5 text-xs", SEVERITY_COLOR[issue.severity])}>
                      {issue.severity}
                    </span>
                  </td>
                  <td className="p-2 text-gray-600">{issue.field_name ?? "—"}</td>
                  <td className="p-2 text-gray-600">{issue.raw_value ?? "—"}</td>
                  <td className="p-2">{issue.resolved ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
