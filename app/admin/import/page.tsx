import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImportUploadForm } from "@/components/import-upload-form";
import clsx from "clsx";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  UPLOADED: "bg-gray-100 text-gray-700",
  VALIDATING: "bg-blue-100 text-blue-700",
  STAGED: "bg-blue-100 text-blue-700",
  QUALITY_CHECK: "bg-amber-100 text-amber-700",
  IMPORTED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
  PARTIALLY_IMPORTED: "bg-amber-100 text-amber-700",
  SUPERSEDED: "bg-gray-100 text-gray-500",
};

export default async function AdminImportPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Excel Upload / Import History" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: batches } = await supabase
    .from("data_import_batch")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(20);

  return (
    <AppShell>
      <PageHeader
        title="Excel Upload / Import History"
        description="Upload → Validate → Staging → Data Quality Check → Import → KPI Calculation. New monthly files with a different column shape are handled via mapping profiles, not code changes."
      />

      <div className="mb-6">
        <ImportUploadForm />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-900">Recent Batches</h2>
      {!batches || batches.length === 0 ? (
        <EmptyState message="No import batches yet." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="p-2">File</th>
                <th className="p-2">Period</th>
                <th className="p-2">Status</th>
                <th className="p-2">Raw</th>
                <th className="p-2">Staged</th>
                <th className="p-2">Imported</th>
                <th className="p-2">Rejected</th>
                <th className="p-2">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batch_id} className="border-b border-gray-50">
                  <td className="p-2">{b.source_filename}</td>
                  <td className="p-2 text-gray-600">{b.period_covered ?? "—"}</td>
                  <td className="p-2">
                    <span className={clsx("rounded px-1.5 py-0.5 text-xs", STATUS_COLOR[b.status])}>
                      {b.status}
                    </span>
                  </td>
                  <td className="p-2">{b.row_count_raw ?? "—"}</td>
                  <td className="p-2">{b.row_count_staged ?? "—"}</td>
                  <td className="p-2">{b.row_count_imported ?? "—"}</td>
                  <td className="p-2">{b.row_count_rejected ?? "—"}</td>
                  <td className="p-2 text-gray-500">{new Date(b.uploaded_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
