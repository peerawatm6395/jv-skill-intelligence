import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TeamDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Team Analysis" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: org } = await supabase.from("org_unit").select("*").eq("org_id", orgId).maybeSingle();
  const { data: employees } = await supabase
    .from("employee")
    .select("employee_id, display_name, craft_code")
    .eq("org_id", orgId)
    .eq("is_current", true);

  return (
    <AppShell>
      <PageHeader
        title={`Team — ${org?.team ?? org?.plant ?? "Unknown"}`}
        description={`${org?.company ?? ""} · ${org?.plant ?? ""} · ${org?.subplant ?? ""}`}
      />
      {!employees || employees.length === 0 ? (
        <EmptyState message="No employees in this team yet." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="pb-2">Employee</th>
                <th className="pb-2">Craft</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.employee_id} className="border-b border-gray-50">
                  <td className="py-2">
                    <Link href={`/employees/${e.employee_id}`} className="text-indigo-600 hover:underline">
                      {e.display_name}
                    </Link>
                  </td>
                  <td className="py-2 text-gray-600">{e.craft_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
