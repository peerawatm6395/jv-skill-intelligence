import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { WeightProfileForm } from "@/components/weight-profile-form";
import clsx from "clsx";

export const dynamic = "force-dynamic";

export default async function AdminWeightProfilesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Weight Profiles" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: profiles } = await supabase
    .from("weight_profile")
    .select("*")
    .order("approved_at", { ascending: false });

  return (
    <AppShell>
      <PageHeader
        title="Weight Profiles"
        description="Overall Skill Rating weights (Blueprint v2.0 §4.10) are never invented by the system — every profile here is created and approved by a named ADMIN/HRBP user. Exactly one profile can be active at a time (enforced by a database constraint)."
      />

      <div className="mb-6">
        <WeightProfileForm />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-900">Existing Profiles</h2>
      {!profiles || profiles.length === 0 ? (
        <EmptyState message="No weight profiles created yet. Overall Skill Rating cannot be computed until one is approved and activated." />
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <div key={p.weight_profile_id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{p.profile_name}</span>
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    p.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                  )}
                >
                  {p.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Approved by {p.approved_by} on {new Date(p.approved_at).toLocaleDateString()}
                {p.human_validation_blend_weight !== null && ` · Blend weight: ${p.human_validation_blend_weight}`}
              </div>
              <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
                {JSON.stringify(p.weights_json, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
