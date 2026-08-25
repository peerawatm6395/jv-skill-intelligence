import { AppShell, PageHeader } from "@/components/ui/app-shell";
import { SetupNotice } from "@/components/ui/setup-notice";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function loadExecutiveSummary() {
  const supabase = await createServerSupabaseClient();

  const [{ count: employeeCount }, { data: latestBatch }, { data: skillResults }] =
    await Promise.all([
      supabase.from("employee").select("*", { count: "exact", head: true }).eq("is_current", true),
      supabase
        .from("data_import_batch")
        .select("*")
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("kpi_result")
        .select("evidence_type")
        .eq("kpi_code", "SKILL_OVERALL"),
    ]);

  const evidenceCounts = { SYSTEM_EVIDENCE_ONLY: 0, HUMAN_VALIDATED: 0, BLENDED: 0 };
  for (const r of skillResults ?? []) {
    if (r.evidence_type && r.evidence_type in evidenceCounts) {
      evidenceCounts[r.evidence_type as keyof typeof evidenceCounts]++;
    }
  }

  return { employeeCount: employeeCount ?? 0, latestBatch, evidenceCounts };
}

export default async function ExecutiveDashboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Executive Dashboard" description="Org-wide health at a glance" />
        <SetupNotice />
      </AppShell>
    );
  }

  const { employeeCount, latestBatch, evidenceCounts } = await loadExecutiveSummary();
  const totalScored = evidenceCounts.SYSTEM_EVIDENCE_ONLY + evidenceCounts.HUMAN_VALIDATED + evidenceCounts.BLENDED;

  return (
    <AppShell>
      <PageHeader
        title="Executive Dashboard"
        description="Org-wide health across all four layers: Skill Intelligence, Performance Evidence, Labor Analytics, Skill Gap"
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Active Employees" value={String(employeeCount)} />
        <StatCard
          label="Last Import"
          value={latestBatch ? latestBatch.period_covered ?? latestBatch.source_filename : "None yet"}
          sub={latestBatch ? `Status: ${latestBatch.status}` : "Upload a file to get started"}
        />
        <StatCard
          label="Skill Intelligence Coverage"
          value={totalScored > 0 ? `${Math.round(((evidenceCounts.BLENDED + evidenceCounts.HUMAN_VALIDATED) / totalScored) * 100)}% validated` : "No scores yet"}
          sub={`${evidenceCounts.SYSTEM_EVIDENCE_ONLY} system-evidence-only · ${evidenceCounts.BLENDED} blended`}
        />
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900">About this dashboard</h2>
        <p className="mt-2 text-sm text-gray-600">
          This system is built on four hard-separated layers (Blueprint v2.0). Performance
          Evidence (Layer 2) is computed directly from JV labor data and complexity-normalized —
          it is never itself labeled a &quot;skill&quot;. Skill Intelligence (Layer 1) blends that
          evidence with Human Validation when available; until supervisors begin entering
          assessments, Skill Intelligence scores are labeled{" "}
          <span className="font-medium">System Evidence Only</span>. Labor Analytics (Layer 3,
          e.g. overtime ratios) is workforce-planning data, not a skill measurement. Skill Gap
          (Layer 4) runs in Relative Standing mode until HRBP defines target competency profiles.
        </p>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}
