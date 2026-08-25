import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TeamsIndexPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Supervisor / Team Analysis" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: orgs } = await supabase.from("org_unit").select("org_id, team, plant, company").limit(50);

  return (
    <AppShell>
      <PageHeader title="Supervisor / Team Analysis" description="Team rollups for people managers." />
      {!orgs || orgs.length === 0 ? (
        <EmptyState message="No org units loaded yet." />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {orgs.map((org) => (
            <Link
              key={org.org_id}
              href={`/teams/${org.org_id}`}
              className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="font-medium text-gray-900">{org.team ?? org.plant ?? "—"}</div>
              <div className="text-xs text-gray-500">
                {org.company} · {org.plant}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
