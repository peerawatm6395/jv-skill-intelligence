import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AssistantChat } from "@/components/assistant-chat";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="AI Workforce Assistant" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: employees } = await supabase
    .from("employee")
    .select("employee_id, display_name")
    .eq("is_current", true)
    .limit(50);

  return (
    <AppShell>
      <PageHeader
        title="AI Workforce Assistant"
        description="Explains and analyzes already-computed KPI/Skill Intelligence data — it never calculates a new score itself. Every answer is scoped to your role's access level and states which layer and evidence type it rests on. Requires ANTHROPIC_API_KEY to be configured."
      />
      {!employees ? (
        <EmptyState message="Could not load employee list." />
      ) : (
        <AssistantChat employees={employees} />
      )}
    </AppShell>
  );
}
