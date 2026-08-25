import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TeamBuilderSearch } from "@/components/team-builder-search";

export const dynamic = "force-dynamic";

export default async function TeamBuilderPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Team Builder" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: crafts } = await supabase.from("craft").select("craft_code, craft_name").eq("is_active", true);

  return (
    <AppShell>
      <PageHeader
        title="Team Builder / Best Employee Recommendation"
        description="Filters on CONFIRMED evidence, reuses the same active weight profile as Overall Skill Rating — does not invent its own scoring logic (Blueprint v2.0 §13). Every ranked result is explainable: click through to an employee's profile to see the full evidence-tagged breakdown behind their rank."
      />
      {!crafts || crafts.length === 0 ? (
        <EmptyState message="No crafts loaded yet — upload JV data or run the demo seed script first." />
      ) : (
        <TeamBuilderSearch crafts={crafts} />
      )}
    </AppShell>
  );
}
