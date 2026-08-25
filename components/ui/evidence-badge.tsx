import clsx from "clsx";
import type { ConfidenceLevel, EvidenceType } from "@/lib/types/domain";

/**
 * Renders next to EVERY Skill Intelligence / Skill Gap number. Per
 * Architecture v3.0 §6: "every dashboard card showing a Layer 1 or
 * Layer 4 number is required to render the evidence badge adjacent to
 * the number, never the number alone."
 */

const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  SYSTEM_EVIDENCE_ONLY: "System Evidence Only",
  HUMAN_VALIDATED: "Human Validated",
  BLENDED: "Blended",
};

const EVIDENCE_COLOR: Record<EvidenceType, string> = {
  SYSTEM_EVIDENCE_ONLY: "bg-gray-100 text-gray-700 border-gray-300",
  HUMAN_VALIDATED: "bg-blue-100 text-blue-700 border-blue-300",
  BLENDED: "bg-emerald-100 text-emerald-700 border-emerald-300",
};

const CONFIDENCE_COLOR: Record<ConfidenceLevel, string> = {
  HIGH: "bg-emerald-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-red-500",
};

export function EvidenceBadge({
  evidenceType,
  confidenceLevel,
  compact = false,
}: {
  evidenceType: EvidenceType | null;
  confidenceLevel: ConfidenceLevel | null;
  compact?: boolean;
}) {
  if (!evidenceType || !confidenceLevel) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">
        No evidence yet
      </span>
    );
  }

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        EVIDENCE_COLOR[evidenceType]
      )}
      title={`Evidence: ${EVIDENCE_LABEL[evidenceType]} · Confidence: ${confidenceLevel}`}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", CONFIDENCE_COLOR[confidenceLevel])} />
      {EVIDENCE_LABEL[evidenceType]}
      {!compact && <span className="opacity-70">· {confidenceLevel}</span>}
    </span>
  );
}

/** A proxy-measurability disclosure tag, e.g. for Technical Skill (Indicator — proxy). */
export function MeasurabilityTag({
  measurability,
}: {
  measurability: "DIRECT" | "PROXY" | "REQUIRES_ADDITIONAL_DATA";
}) {
  const label =
    measurability === "DIRECT"
      ? "Directly measurable"
      : measurability === "PROXY"
        ? "Proxy — not a direct measurement"
        : "Requires additional data";

  const color =
    measurability === "DIRECT"
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : measurability === "PROXY"
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-red-700 bg-red-50 border-red-200";

  return (
    <span className={clsx("inline-block rounded border px-2 py-0.5 text-xs", color)}>
      {label}
    </span>
  );
}
