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

const EVIDENCE_TYPES = ["", "SYSTEM_EVIDENCE_ONLY", "HUMAN_VALIDATED", "BLENDED"] as const;

export function TargetSkillProfileForm({ crafts }: { crafts: { craft_code: string; craft_name: string }[] }) {
  const [craftCode, setCraftCode] = useState(crafts[0]?.craft_code ?? "");
  const [skillDimension, setSkillDimension] = useState(DIMENSION_KPI_CODES[0]);
  const [targetPercentile, setTargetPercentile] = useState(75);
  const [minimumEvidenceType, setMinimumEvidenceType] = useState<string>("");
  const [activate, setActivate] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/target-skill-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftCode,
          skillDimension,
          targetPercentile,
          minimumEvidenceType: minimumEvidenceType || undefined,
          activate,
        }),
      });
      const data = await res.json();
      setStatus(res.ok ? `Target created for ${craftCode} / ${skillDimension}.` : `Failed: ${data.error}`);
    } catch {
      setStatus("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Craft</label>
          <select
            value={craftCode}
            onChange={(e) => setCraftCode(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {crafts.map((c) => (
              <option key={c.craft_code} value={c.craft_code}>
                {c.craft_name} ({c.craft_code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Skill dimension</label>
          <select
            value={skillDimension}
            onChange={(e) => setSkillDimension(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {DIMENSION_KPI_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Target percentile</label>
          <input
            type="number"
            min="0"
            max="100"
            value={targetPercentile}
            onChange={(e) => setTargetPercentile(Number(e.target.value))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Minimum evidence type required (optional)
          </label>
          <select
            value={minimumEvidenceType}
            onChange={(e) => setMinimumEvidenceType(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t || "(none — any evidence type is actionable)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        Activate immediately (deactivates any prior target for this craft/dimension)
      </label>

      <button
        type="submit"
        disabled={busy || !craftCode}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save target"}
      </button>
      {status && <p className="mt-3 text-sm text-gray-700">{status}</p>}
    </form>
  );
}
