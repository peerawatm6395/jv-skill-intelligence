import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MeasurabilityTag } from "@/components/ui/evidence-badge";

export const dynamic = "force-dynamic";

const LAYER_LABEL: Record<string, string> = {
  PERFORMANCE_EVIDENCE: "Layer 2 — Performance Evidence",
  SKILL_INTELLIGENCE: "Layer 1 — Skill Intelligence",
  LABOR_ANALYTICS: "Layer 3 — Labor Analytics",
  SKILL_GAP: "Layer 4 — Skill Gap",
};

export default async function KpiDictionaryPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="KPI Dictionary" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: kpis } = await supabase
    .from("kpi_dictionary")
    .select("*")
    .eq("is_active", true)
    .order("layer")
    .order("kpi_code");

  if (!kpis || kpis.length === 0) {
    return (
      <AppShell>
        <PageHeader title="KPI Dictionary" />
        <EmptyState message="KPI Dictionary is empty — run supabase/seed.sql." />
      </AppShell>
    );
  }

  const byLayer = kpis.reduce<Record<string, typeof kpis>>((acc, k) => {
    (acc[k.layer] ??= []).push(k);
    return acc;
  }, {});

  return (
    <AppShell>
      <PageHeader
        title="KPI Dictionary"
        description="Every KPI in this system, straight from the database — no hardcoded copy. Every formula here is the same one approved in Blueprint v2.0 §D; nothing here has been changed by the application."
      />
      {Object.entries(byLayer).map(([layer, items]) => (
        <div key={layer} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">{LAYER_LABEL[layer] ?? layer}</h2>
          <div className="space-y-3">
            {items.map((k) => (
              <div key={k.kpi_code} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-gray-900">{k.kpi_name}</div>
                    <div className="text-xs text-gray-500">{k.kpi_code}</div>
                  </div>
                  <MeasurabilityTag measurability={k.measurability} />
                </div>
                <p className="mt-2 text-sm text-gray-700">{k.business_question}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <Field label="Formula" value={k.formula_description} mono />
                  <Field label="Data Source" value={k.data_source} />
                  <Field label="Dimension" value={k.dimension ?? "—"} />
                  <Field label="Unit" value={k.unit} />
                  <Field label="Benchmark" value={k.default_benchmark_method ?? "—"} />
                </dl>
                {k.limitation_notes && (
                  <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
                    <span className="font-medium">Limitation: </span>
                    {k.limitation_notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </AppShell>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-gray-400">{label}</dt>
      <dd className={mono ? "font-mono text-gray-700" : "text-gray-700"}>{value}</dd>
    </div>
  );
}
