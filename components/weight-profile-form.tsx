"use client";

import { useState } from "react";

const DIMENSION_KPI_CODES = [
  "SKILL_DIM_PRODUCTIVITY",
  "SKILL_DIM_COST_EFFICIENCY",
  "SKILL_DIM_PM",
  "SKILL_DIM_CM",
  "SKILL_DIM_TECHNICAL",
  "SKILL_DIM_BREADTH",
];

export function WeightProfileForm() {
  const [profileName, setProfileName] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(DIMENSION_KPI_CODES.map((c) => [c, 0]))
  );
  const [blendWeight, setBlendWeight] = useState<number>(0.5);
  const [activate, setActivate] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/weight-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileName,
          weightsJson: weights,
          humanValidationBlendWeight: blendWeight,
          activate,
        }),
      });
      const data = await res.json();
      setStatus(res.ok ? `Created profile "${data.profile.profile_name}" (active: ${data.profile.is_active}).` : `Failed: ${data.error}`);
    } catch {
      setStatus("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">Profile name</label>
        <input
          type="text"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="e.g. 2026 Q3 HRBP-approved weights"
        />
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Dimension weights (must sum to 1.0 — currently {totalWeight.toFixed(2)})
        </label>
        <div className="space-y-2">
          {DIMENSION_KPI_CODES.map((code) => (
            <div key={code} className="flex items-center gap-3">
              <span className="w-56 text-xs text-gray-600">{code}</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={weights[code]}
                onChange={(e) => setWeights({ ...weights, [code]: Number(e.target.value) })}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
          ))}
        </div>
        {Math.abs(totalWeight - 1) > 0.001 && (
          <p className="mt-1 text-xs text-amber-600">Weights don&apos;t sum to 1.0 — this is allowed but unusual. Confirm with HRBP before activating.</p>
        )}
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Human validation blend weight (Architecture v3.0 §J item 4)
        </label>
        <input
          type="number"
          step="0.1"
          min="0"
          max="1"
          value={blendWeight}
          onChange={(e) => setBlendWeight(Number(e.target.value))}
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <p className="mt-1 text-xs text-gray-400">
          Only takes effect once human_validation records exist for an employee/dimension —
          otherwise every score stays SYSTEM_EVIDENCE_ONLY regardless of this value.
        </p>
      </div>

      <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        Activate immediately (deactivates any currently active profile)
      </label>

      <button
        type="submit"
        disabled={busy || !profileName}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save weight profile"}
      </button>
      {status && <p className="mt-3 text-sm text-gray-700">{status}</p>}
    </form>
  );
}
