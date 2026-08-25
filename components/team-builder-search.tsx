"use client";

import { useState } from "react";
import Link from "next/link";

interface CandidateResult {
  employeeId: string;
  displayName: string;
  craft: string;
  skillLevel: string;
  overallScore: number;
  overallEvidenceType: string | null;
  overallConfidenceLevel: string | null;
  dimensionBreakdown: { kpi_code: string; score_0_100: number | null }[];
}

const EVIDENCE_LABEL: Record<string, string> = {
  SYSTEM_EVIDENCE_ONLY: "System Evidence Only",
  HUMAN_VALIDATED: "Human Validated",
  BLENDED: "Blended",
};

export function TeamBuilderSearch({ crafts }: { crafts: { craft_code: string; craft_name: string }[] }) {
  const [craftCode, setCraftCode] = useState(crafts[0]?.craft_code ?? "");
  const [minCmScore, setMinCmScore] = useState<number | "">("");
  const [excludeLowConfidence, setExcludeLowConfidence] = useState(true);
  const [headcount, setHeadcount] = useState(10);
  const [results, setResults] = useState<CandidateResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResults(null);

    const minScoresByDimension: Record<string, number> = {};
    if (minCmScore !== "") minScoresByDimension.SKILL_DIM_CM = Number(minCmScore);

    try {
      const res = await fetch("/api/team-builder/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftCode,
          minScoresByDimension,
          excludeLowConfidence,
          headcount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Search failed");
      } else {
        setResults(data.results);
      }
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSearch} className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Craft</label>
            <select
              value={craftCode}
              onChange={(e) => setCraftCode(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {crafts.map((c) => (
                <option key={c.craft_code} value={c.craft_code}>
                  {c.craft_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Min. CM Skill score</label>
            <input
              type="number"
              min="0"
              max="100"
              value={minCmScore}
              onChange={(e) => setMinCmScore(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="optional"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Headcount</label>
            <input
              type="number"
              min="1"
              value={headcount}
              onChange={(e) => setHeadcount(Number(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={excludeLowConfidence}
                onChange={(e) => setExcludeLowConfidence(e.target.checked)}
              />
              Exclude LOW confidence
            </label>
          </div>
        </div>
        <button
          type="submit"
          disabled={busy || !craftCode}
          className="mt-4 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Searching…" : "Search candidates"}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </form>

      {results && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            {results.length} candidate{results.length !== 1 ? "s" : ""} ranked by Overall Skill Rating
          </h2>
          {results.length === 0 ? (
            <p className="text-sm text-gray-500">No candidates matched the criteria.</p>
          ) : (
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={r.employeeId} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
                  <div>
                    <span className="mr-2 text-xs text-gray-400">#{i + 1}</span>
                    <Link href={`/employees/${r.employeeId}`} className="font-medium text-indigo-600 hover:underline">
                      {r.displayName}
                    </Link>
                    <span className="ml-2 text-xs text-gray-500">{r.skillLevel}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-gray-900">{r.overallScore}</div>
                    <div className="text-xs text-gray-400">
                      {r.overallEvidenceType ? EVIDENCE_LABEL[r.overallEvidenceType] : "—"} ·{" "}
                      {r.overallConfidenceLevel ?? "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
