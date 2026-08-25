import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function GapReviewQueuePage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Skill Gap & Development — Review Queue" layerBadge="Layer 4" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { count: activeProfileCount } = await supabase
    .from("skill_target_profile")
    .select("profile_id", { count: "exact", head: true })
    .eq("is_active", true);

  return (
    <AppShell>
      <PageHeader
        title="Skill Gap & Development — Review Queue"
        layerBadge="Layer 4"
        description="Supervisor/HRBP workflow: confirm, adjust, or dismiss system-suggested gaps before they become visible recommendations or feed Team Builder eligibility. No gap is actionable until reviewed here."
      />
      {!activeProfileCount || activeProfileCount === 0 ? (
        <EmptyState message="No active skill_target_profile exists yet for any craft. HRBP must define target competency percentiles per craft/dimension in /admin/target-skill-profiles before this queue has gap-to-target items to review. Individual employees' Relative Standing is still visible on their Skill Gap page." />
      ) : (
        <EmptyState message="No pending gap reviews. (Gap generation runs as part of the scheduled KPI Calculation job once target profiles are active.)" />
      )}
    </AppShell>
  );
}
