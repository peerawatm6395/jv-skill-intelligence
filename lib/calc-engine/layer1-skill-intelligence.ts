import type { ConfidenceLevel, EvidenceType } from "@/lib/types/domain";
import type { ComplexityConfidence } from "./complexity-engine";

/**
 * Layer 1 — Skill Intelligence (Blueprint v2.0 §C, §E).
 *
 * HARD RULES enforced by this module's function signatures (not just
 * comments — there is no parameter through which these could be smuggled in):
 *   - No function here accepts skill_level_code as a scoring input.
 *   - No function here accepts total_hrs or line_cost directly as a
 *     scoring input — only already-normalized Layer 2 percentiles.
 *   - Every score this module produces carries a mandatory evidenceType
 *     and confidenceLevel — there is no code path that returns a bare number.
 */

const MIN_EVIDENCE_HOURS = 20;
const MIN_EVIDENCE_WORK_ORDERS = 5;

export interface HumanValidationInput {
  ratingScore0To100: number;
  validatedAt: string;
  expiresAt: string | null;
}

export interface SkillDimensionScoreInput {
  performanceEvidencePercentile: number | null;
  humanValidation: HumanValidationInput | null;
  humanValidationBlendWeight: number | null; // from active weight_profile; null until HRBP decides
  recordCount: number;
  totalHours: number;
  complexityConfidence: ComplexityConfidence;
  isComplexitySensitiveDimension: boolean;
}

export interface SkillDimensionScoreResult {
  score0To100: number | null;
  evidenceType: EvidenceType;
  confidenceLevel: ConfidenceLevel;
}

/**
 * Computes one Skill Intelligence dimension score (Blueprint v2.0 §E steps 6-8).
 *
 * - No validation on file → SYSTEM_EVIDENCE_ONLY, score = performance evidence percentile.
 * - Validation on file → BLENDED, score = weight × validation + (1-weight) × evidence.
 * - Confidence is derived independently from evidence volume and complexity
 *   coverage, never inflated by the presence of a blend alone.
 */
export function computeSkillDimensionScore(
  input: SkillDimensionScoreInput
): SkillDimensionScoreResult {
  const isValidationCurrent =
    input.humanValidation !== null &&
    (input.humanValidation.expiresAt === null ||
      new Date(input.humanValidation.expiresAt) >= new Date());

  let score: number | null;
  let evidenceType: EvidenceType;

  if (isValidationCurrent && input.humanValidation) {
    const weight = input.humanValidationBlendWeight ?? 0.5; // default until HRBP sets one (§J item 4)
    if (input.performanceEvidencePercentile === null) {
      score = input.humanValidation.ratingScore0To100;
      evidenceType = "HUMAN_VALIDATED";
    } else {
      score =
        weight * input.humanValidation.ratingScore0To100 +
        (1 - weight) * input.performanceEvidencePercentile;
      evidenceType = "BLENDED";
    }
  } else {
    score = input.performanceEvidencePercentile;
    evidenceType = "SYSTEM_EVIDENCE_ONLY";
  }

  const confidenceLevel = deriveConfidenceLevel(input, evidenceType);

  return {
    score0To100: score === null ? null : round2(score),
    evidenceType,
    confidenceLevel,
  };
}

function deriveConfidenceLevel(
  input: SkillDimensionScoreInput,
  evidenceType: EvidenceType
): ConfidenceLevel {
  const hasEnoughEvidence =
    input.totalHours >= MIN_EVIDENCE_HOURS && input.recordCount >= MIN_EVIDENCE_WORK_ORDERS;

  const complexityOk =
    !input.isComplexitySensitiveDimension || input.complexityConfidence === "RELIABLE";

  if (evidenceType === "BLENDED" && hasEnoughEvidence) return "HIGH";
  if (!hasEnoughEvidence) return "LOW";
  if (!complexityOk) return "LOW";
  if (evidenceType === "SYSTEM_EVIDENCE_ONLY") return "MEDIUM";
  return "MEDIUM";
}

export interface OverallRatingInput {
  dimensionScores: {
    dimensionKpiCode: string;
    score: number | null;
    evidenceType: EvidenceType;
    confidenceLevel: ConfidenceLevel;
  }[];
  weights: Record<string, number>; // kpi_code -> weight, from active weight_profile.weights_json
}

export interface OverallRatingResult {
  overallScore: number | null;
  overallEvidenceType: EvidenceType;
  overallConfidenceLevel: ConfidenceLevel;
}

const EVIDENCE_TYPE_STRENGTH: Record<EvidenceType, number> = {
  SYSTEM_EVIDENCE_ONLY: 0,
  HUMAN_VALIDATED: 1,
  BLENDED: 2,
};
const CONFIDENCE_STRENGTH: Record<ConfidenceLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * Overall Skill Rating = Σ(weight_i × dimension_score_i) via an approved
 * weight_profile (Blueprint v2.0 §D.2.2). Its evidence_type/confidence
 * are set to the WEAKEST contributing dimension — never averaged up —
 * so the headline number can't imply more validation than actually exists.
 */
export function computeOverallRating(input: OverallRatingInput): OverallRatingResult {
  const scored = input.dimensionScores.filter((d) => d.score !== null);
  if (scored.length === 0) {
    return { overallScore: null, overallEvidenceType: "SYSTEM_EVIDENCE_ONLY", overallConfidenceLevel: "LOW" };
  }

  const totalWeight = scored.reduce(
    (s, d) => s + (input.weights[d.dimensionKpiCode] ?? 0),
    0
  );
  const weightedSum = scored.reduce(
    (s, d) => s + (input.weights[d.dimensionKpiCode] ?? 0) * (d.score as number),
    0
  );

  const overallScore = totalWeight > 0 ? round2(weightedSum / totalWeight) : null;

  const weakestEvidence = scored.reduce((weakest, d) =>
    EVIDENCE_TYPE_STRENGTH[d.evidenceType] < EVIDENCE_TYPE_STRENGTH[weakest] ? d.evidenceType : weakest
  , scored[0]!.evidenceType);

  const weakestConfidence = scored.reduce((weakest, d) =>
    CONFIDENCE_STRENGTH[d.confidenceLevel] < CONFIDENCE_STRENGTH[weakest] ? d.confidenceLevel : weakest
  , scored[0]!.confidenceLevel);

  return {
    overallScore,
    overallEvidenceType: weakestEvidence,
    overallConfidenceLevel: weakestConfidence,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
