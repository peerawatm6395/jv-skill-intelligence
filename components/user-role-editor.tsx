"use client";

import { useState } from "react";
import type { AppRole } from "@/lib/types/domain";

const ROLES: AppRole[] = ["ADMIN", "HRBP", "MANAGER", "SUPERVISOR", "VIEWER"];

export function UserRoleEditor({
  userId,
  currentRole,
  orgs,
}: {
  userId: string;
  currentRole: AppRole;
  orgs: { org_id: string; label: string }[];
}) {
  const [role, setRole] = useState<AppRole>(currentRole);
  const [scopedOrgId, setScopedOrgId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          role,
          scopedOrgId: scopedOrgId || null,
        }),
      });
      const data = await res.json();
      setStatus(res.ok ? "Saved." : `Failed: ${data.error}`);
    } catch {
      setStatus("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as AppRole)}
        className="rounded border border-gray-300 px-2 py-1 text-xs"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {(role === "MANAGER" || role === "SUPERVISOR") && (
        <select
          value={scopedOrgId}
          onChange={(e) => setScopedOrgId(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">No org scope</option>
          {orgs.map((o) => (
            <option key={o.org_id} value={o.org_id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={save}
        disabled={busy}
        className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? "…" : "Save"}
      </button>
      {status && <span className="text-xs text-gray-500">{status}</span>}
    </div>
  );
}
