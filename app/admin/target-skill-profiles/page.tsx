import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TargetSkillProfileForm } from "@/components/target-skill-profile-form";
import clsx from "clsx";

export const dynamic = "force-dynamic";

export default async function AdminTargetSkillProfilesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Target Skill Profiles" layerBadge="Layer 4" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: crafts } = await supabase.from("craft").select("craft_code, craft_name").eq("is_active", true);

  interface TargetProfileRow {
    profile_id: string;
    craft_code: string;
    skill_dimension: string;
    target_percentile: number;
    minimum_evidence_type: string | null;
    approved_by: string;
    approved_at: string;
    is_active: boolean;
    craft: { craft_name: string } | null;
  }

  const { data: profilesRaw } = await supabase
    .from("skill_target_profile")
    .select("*, craft(craft_name)")
    .order("craft_code")
    .order("skill_dimension");

  const profiles = (profilesRaw ?? []) as unknown as TargetProfileRow[];

  return (
    <AppShell>
      <PageHeader
        title="Target Skill Profiles"
        layerBadge="Layer 4"
        description="HRBP-approved competency targets per craft/dimension (Blueprint v2.0 §B.5, §J item 2). Until a target exists for a craft/dimension, that employee's Skill Gap page shows Relative Standing (percentile vs. peers) instead of a fabricated gap-to-target."
      />

      {!crafts || crafts.length === 0 ? (
        <EmptyState message="No crafts loaded yet — upload JV data or run the demo seed script first." />
      ) : (
        <div className="mb-6">
          <TargetSkillProfileForm crafts={crafts} />
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-gray-900">Existing Targets</h2>
      {profiles.length === 0 ? (
        <EmptyState message="No target skill profiles defined yet. All employees currently see Relative Standing mode on their Skill Gap page." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="p-2">Craft</th>
                <th className="p-2">Dimension</th>
                <th className="p-2">Target (p)</th>
                <th className="p-2">Min. Evidence</th>
                <th className="p-2">Status</th>
                <th className="p-2">Approved By</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.profile_id} className="border-b border-gray-50">
                  <td className="p-2">{p.craft?.craft_name ?? p.craft_code}</td>
                  <td className="p-2 text-gray-600">{p.skill_dimension}</td>
                  <td className="p-2 font-medium">{p.target_percentile}</td>
                  <td className="p-2 text-gray-500">{p.minimum_evidence_type ?? "—"}</td>
                  <td className="p-2">
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        p.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                      )}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="p-2 text-gray-500">{p.approved_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
