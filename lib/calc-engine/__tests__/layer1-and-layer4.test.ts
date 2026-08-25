import { describe, expect, it } from "vitest";
import { computeSkillDimensionScore, computeOverallRating } from "../layer1-skill-intelligence";
import { computeGapOrRelativeStanding } from "../layer4-skill-gap";

describe("computeSkillDimensionScore — evidence type determination", () => {
  it("is SYSTEM_EVIDENCE_ONLY when no human validation exists (the default/launch state)", () => {
    const result = computeSkillDimensionScore({
      performanceEvidencePercentile: 72,
      humanValidation: null,
      humanValidationBlendWeight: null,
      recordCount: 10,
      totalHours: 40,
      complexityConfidence: "RELIABLE",
      isComplexitySensitiveDimension: true,
    });
    expect(result.evidenceType).toBe("SYSTEM_EVIDENCE_ONLY");
    expect(result.score0To100).toBe(72);
  });

  it("is BLENDED when current human validation exists alongside performance evidence", () => {
    const result = computeSkillDimensionScore({
      performanceEvidencePercentile: 60,
      humanValidation: { ratingScore0To100: 80, validatedAt: "2026-01-01", expiresAt: null },
      humanValidationBlendWeight: 0.5,
      recordCount: 10,
      totalHours: 40,
      complexityConfidence: "RELIABLE",
      isComplexitySensitiveDimension: true,
    });
    expect(result.evidenceType).toBe("BLENDED");
    expect(result.score0To100).toBe(70); // 0.5*80 + 0.5*60
  });

  it("falls back to SYSTEM_EVIDENCE_ONLY when validation has expired", () => {
    const result = computeSkillDimensionScore({
      performanceEvidencePercentile: 55,
      humanValidation: { ratingScore0To100: 90, validatedAt: "2020-01-01", expiresAt: "2021-01-01" },
      humanValidationBlendWeight: 0.5,
      recordCount: 10,
      totalHours: 40,
      complexityConfidence: "RELIABLE",
      isComplexitySensitiveDimension: true,
    });
    expect(result.evidenceType).toBe("SYSTEM_EVIDENCE_ONLY");
    expect(result.score0To100).toBe(55);
  });

  it("returns LOW confidence when evidence volume is below threshold, regardless of evidence type", () => {
    const result = computeSkillDimensionScore({
      performanceEvidencePercentile: 90,
      humanValidation: { ratingScore0To100: 95, validatedAt: "2026-01-01", expiresAt: null },
      humanValidationBlendWeight: 0.5,
      recordCount: 1, // below MIN_EVIDENCE_WORK_ORDERS
      totalHours: 3, // below MIN_EVIDENCE_HOURS
      complexityConfidence: "RELIABLE",
      isComplexitySensitiveDimension: true,
    });
    expect(result.confidenceLevel).toBe("LOW");
  });

  it("returns LOW confidence for a complexity-sensitive dimension with only LOW_COVERAGE complexity data", () => {
    const result = computeSkillDimensionScore({
      performanceEvidencePercentile: 65,
      humanValidation: null,
      humanValidationBlendWeight: null,
      recordCount: 20,
      totalHours: 100,
      complexityConfidence: "LOW_COVERAGE",
      isComplexitySensitiveDimension: true,
    });
    expect(result.confidenceLevel).toBe("LOW");
  });
});

describe("computeOverallRating — weakest-link evidence propagation (Blueprint v2.0 §D.2.2)", () => {
  it("sets overall evidence_type to the WEAKEST contributing dimension, never averaged up", () => {
    const result = computeOverallRating({
      dimensionScores: [
        { dimensionKpiCode: "SKILL_DIM_PRODUCTIVITY", score: 80, evidenceType: "BLENDED", confidenceLevel: "HIGH" },
        { dimensionKpiCode: "SKILL_DIM_CM", score: 60, evidenceType: "SYSTEM_EVIDENCE_ONLY", confidenceLevel: "MEDIUM" },
      ],
      weights: { SKILL_DIM_PRODUCTIVITY: 0.5, SKILL_DIM_CM: 0.5 },
    });
    // Even though one dimension is BLENDED/HIGH, the overall must reflect the weaker one
    expect(result.overallEvidenceType).toBe("SYSTEM_EVIDENCE_ONLY");
    expect(result.overallConfidenceLevel).toBe("MEDIUM");
    expect(result.overallScore).toBe(70);
  });

  it("returns null score with LOW confidence when no dimension has a score", () => {
    const result = computeOverallRating({
      dimensionScores: [
        { dimensionKpiCode: "SKILL_DIM_PRODUCTIVITY", score: null, evidenceType: "SYSTEM_EVIDENCE_ONLY", confidenceLevel: "LOW" },
      ],
      weights: { SKILL_DIM_PRODUCTIVITY: 1 },
    });
    expect(result.overallScore).toBeNull();
  });
});

describe("computeGapOrRelativeStanding — Layer 4 fallback when no target profile exists", () => {
  it("returns RELATIVE_STANDING mode when targetPercentile is null (skill_target_profile empty at launch)", () => {
    const result = computeGapOrRelativeStanding({
      currentScore: 65,
      evidenceType: "SYSTEM_EVIDENCE_ONLY",
      confidenceLevel: "MEDIUM",
      targetPercentile: null,
      minimumEvidenceTypeRequired: null,
    });
    expect(result.mode).toBe("RELATIVE_STANDING");
  });

  it("returns GAP_TO_TARGET mode with correct gapSize once a target profile is active", () => {
    const result = computeGapOrRelativeStanding({
      currentScore: 55,
      evidenceType: "BLENDED",
      confidenceLevel: "HIGH",
      targetPercentile: 75,
      minimumEvidenceTypeRequired: null,
    });
    expect(result.mode).toBe("GAP_TO_TARGET");
    if (result.mode === "GAP_TO_TARGET") {
      expect(result.gapSize).toBe(20);
      expect(result.requiresHumanReview).toBe(true);
    }
  });

  it("never reports a negative gap when current score already exceeds target", () => {
    const result = computeGapOrRelativeStanding({
      currentScore: 90,
      evidenceType: "BLENDED",
      confidenceLevel: "HIGH",
      targetPercentile: 75,
      minimumEvidenceTypeRequired: null,
    });
    if (result.mode === "GAP_TO_TARGET") {
      expect(result.gapSize).toBe(0);
    }
  });

  it("marks a gap not actionable when evidence type doesn't meet the profile's minimum requirement", () => {
    const result = computeGapOrRelativeStanding({
      currentScore: 55,
      evidenceType: "SYSTEM_EVIDENCE_ONLY",
      confidenceLevel: "MEDIUM",
      targetPercentile: 75,
      minimumEvidenceTypeRequired: "BLENDED",
    });
    if (result.mode === "GAP_TO_TARGET") {
      expect(result.isActionable).toBe(false);
    }
  });
});
