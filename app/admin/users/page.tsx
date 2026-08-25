import { AppShell, PageHeader, EmptyState } from "@/components/ui/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config-check";
import { SetupNotice } from "@/components/ui/setup-notice";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { UserRoleEditor } from "@/components/user-role-editor";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Users & Roles" />
        <SetupNotice />
      </AppShell>
    );
  }

  const supabase = await createServerSupabaseClient();

  interface UserRow {
    user_id: string;
    email: string;
    full_name: string | null;
    role: "ADMIN" | "HRBP" | "MANAGER" | "SUPERVISOR" | "VIEWER";
    is_active: boolean;
    created_at: string;
    org_unit: { team: string | null; plant: string | null } | null;
    employee: { display_name: string } | null;
  }

  const { data: usersRaw } = await supabase
    .from("app_user_profile")
    .select("*, org_unit(team, plant), employee(display_name)")
    .order("created_at", { ascending: false });

  const users = (usersRaw ?? []) as unknown as UserRow[];

  const { data: orgsRaw } = await supabase.from("org_unit").select("org_id, team, plant");
  const orgs = (orgsRaw ?? []).map((o) => ({ org_id: o.org_id, label: o.team ?? o.plant ?? o.org_id }));

  return (
    <AppShell>
      <PageHeader
        title="Users & Roles"
        description="RBAC roles (Architecture v3.0 §8): ADMIN (org-wide, manages everything), HRBP (org-wide read + governance), MANAGER/SUPERVISOR (scoped to their org unit), VIEWER (self only). Role changes here are what Row-Level Security policies key off — they take effect immediately."
      />
      {users.length === 0 ? (
        <EmptyState message="No user profiles yet. Users are created automatically on first Supabase Auth sign-in; an existing ADMIN must then assign them a role here." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="p-2">Email</th>
                <th className="p-2">Name</th>
                <th className="p-2">Linked Employee</th>
                <th className="p-2">Role / Scope</th>
                <th className="p-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-b border-gray-50">
                  <td className="p-2">{u.email}</td>
                  <td className="p-2 text-gray-600">{u.full_name ?? "—"}</td>
                  <td className="p-2 text-gray-600">{u.employee?.display_name ?? "—"}</td>
                  <td className="p-2">
                    <UserRoleEditor userId={u.user_id} currentRole={u.role} orgs={orgs} />
                  </td>
                  <td className="p-2">{u.is_active ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
