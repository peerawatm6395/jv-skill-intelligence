"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ImportColumnMappingProfile } from "@/lib/types/domain";

export function ImportUploadForm() {
  const [profiles, setProfiles] = useState<ImportColumnMappingProfile[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [profileId, setProfileId] = useState("");
  const [periodCovered, setPeriodCovered] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("import_column_mapping_profile")
      .select("*")
      .eq("is_active", true)
      .then(({ data }) => setProfiles((data ?? []) as ImportColumnMappingProfile[]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !profileId) return;
    setBusy(true);
    setStatus(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mappingProfileId", profileId);
    formData.append("periodCovered", periodCovered);

    try {
      const res = await fetch("/api/admin/import/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Failed: ${data.error ?? "Unknown error"}`);
      } else {
        setStatus(
          `Batch ${data.batchId}: ${data.status}. ${data.rowCountStaged ?? 0} rows staged.`
        );
      }
    } catch {
      setStatus("Upload failed — check your connection and Supabase configuration.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">Excel file (.xlsx)</label>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">Column mapping profile</label>
        <select
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select a profile…</option>
          {profiles.map((p) => (
            <option key={p.profile_id} value={p.profile_id}>
              {p.profile_name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">
          If this month&apos;s file has a different column shape than any existing profile, add a
          new one in /admin/import-mapping first — no code change needed.
        </p>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">Period covered (e.g. 2026-07)</label>
        <input
          type="text"
          value={periodCovered}
          onChange={(e) => setPeriodCovered(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="2026-07"
        />
      </div>
      <button
        type="submit"
        disabled={busy || !file || !profileId}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload"}
      </button>
      {status && <p className="mt-3 text-sm text-gray-700">{status}</p>}
    </form>
  );
}
