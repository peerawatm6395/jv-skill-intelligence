import type { ConfidenceLevel, EvidenceType } from "@/lib/types/domain";

/**
 * Layer 4 — Skill Gap & Development (Blueprint v2.0 §F).
 *
 * skill_target_profile ships empty at launch. Until HRBP populates it,
 * this module runs in "Relative Standing" mode (percentile vs peers,
 * no gap-to-target number) rather than fabricating a target — see
 * computeGapOrRelativeStanding below.
 */

export interface SkillGapInput {
  currentScore: number;
  evidenceType: EvidenceType;
  confidenceLevel: ConfidenceLevel;
  targetPercentile: number | null; // null when no active skill_target_profile exists for this dimension
  minimumEvidenceTypeRequired: EvidenceType | null;
}

export type SkillGapOutput =
  | {
      mode: "GAP_TO_TARGET";
      gapSize: number;
      targetPercentile: number;
      currentScore: number;
      evidenceType: EvidenceType;
      confidenceLevel: ConfidenceLevel;
      requiresHumanReview: true;
      isActionable: boolean; // false if evidence doesn't meet minimumEvidenceTypeRequired
    }
  | {
      mode: "RELATIVE_STANDING";
      currentScore: number;
      evidenceType: EvidenceType;
      confidenceLevel: ConfidenceLevel;
    };

const EVIDENCE_TYPE_STRENGTH: Record<EvidenceType, number> = {
  SYSTEM_EVIDENCE_ONLY: 0,
  HUMAN_VALIDATED: 1,
  BLENDED: 2,
};

export function computeGapOrRelativeStanding(input: SkillGapInput): SkillGapOutput {
  if (input.targetPercentile === null) {
    return {
      mode: "RELATIVE_STANDING",
      currentScore: input.currentScore,
      evidenceType: input.evidenceType,
      confidenceLevel: input.confidenceLevel,
    };
  }

  const gapSize = round2(Math.max(0, input.targetPercentile - input.currentScore));

  const isActionable =
    input.minimumEvidenceTypeRequired === null ||
    EVIDENCE_TYPE_STRENGTH[input.evidenceType] >=
      EVIDENCE_TYPE_STRENGTH[input.minimumEvidenceTypeRequired];

  return {
    mode: "GAP_TO_TARGET",
    gapSize,
    targetPercentile: input.targetPercentile,
    currentScore: input.currentScore,
    evidenceType: input.evidenceType,
    confidenceLevel: input.confidenceLevel,
    requiresHumanReview: true, // Blueprint v2.0 §F point 3 — always true until a reviewer confirms
    isActionable,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
