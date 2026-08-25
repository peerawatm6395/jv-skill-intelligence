import type { JobPlanCoverageType, MaintenanceClass } from "@/lib/types/domain";

/**
 * Job/WO Complexity normalization (Blueprint v2.0 §C.2).
 *
 * Honest finding from the source data: ~88–93% of all labor-confirmation
 * rows in every year use a single generic "CM01" job-plan catch-all code,
 * not a specific job template. JPNUM-based complexity tiering is only
 * reliable for the remaining ~7–12% of rows. This module implements BOTH
 * tiers rather than pretending JPNUM alone solves complexity normalization:
 *
 *  Tier A ("RELIABLE"): job_plan.coverage_type = 'SPECIFIC_TEMPLATE'
 *    — a specific, non-generic JPNUM with ≥ MIN_SAMPLE_SIZE historical
 *      observations. Peer comparisons use (craft, skill_level, complexity_tier).
 *
 *  Tier B ("LOW_COVERAGE"): everything else (including the generic
 *      catch-all codes). Peer comparisons fall back to the coarse but
 *      universally-available flags: maintenance_class, is_shutdown_turnaround,
 *      is_emergency.
 */

export const MIN_SPECIFIC_TEMPLATE_SAMPLE_SIZE = 10;

/** Known generic/catch-all job-plan codes observed in the source data. */
export const KNOWN_GENERIC_JOB_PLAN_CODES = new Set(["CM01"]);

export type ComplexityConfidence = "RELIABLE" | "LOW_COVERAGE" | "NOT_APPLICABLE";

export interface JobPlanObservation {
  jpnum: string | null;
  totalHrs: number;
  jobValue: number;
  craftCode: string;
}

export interface JobPlanStats {
  jpnum: string;
  coverageType: JobPlanCoverageType;
  sampleSize: number;
  medianHours: number;
  medianJobValue: number;
  hoursP10: number;
  hoursP90: number;
  complexityTier: number | null;
  typicalCraftMix: Record<string, number>;
}

/**
 * Classifies a JPNUM's coverage type given its historical observation
 * count, per the Tier A/B rule above.
 */
export function classifyJobPlanCoverage(
  jpnum: string | null,
  sampleSize: number
): JobPlanCoverageType {
  if (jpnum === null || jpnum === "") return "UNCODED";
  if (KNOWN_GENERIC_JOB_PLAN_CODES.has(jpnum)) return "GENERIC_BUCKET";
  if (sampleSize < MIN_SPECIFIC_TEMPLATE_SAMPLE_SIZE) return "GENERIC_BUCKET";
  return "SPECIFIC_TEMPLATE";
}

/**
 * Computes dim_job_complexity-equivalent statistics for one JPNUM from
 * its historical observations. Only meaningful when coverageType is
 * SPECIFIC_TEMPLATE — callers must check that before trusting complexityTier.
 */
export function computeJobPlanStats(
  jpnum: string,
  observations: JobPlanObservation[]
): JobPlanStats {
  const hours = observations.map((o) => o.totalHrs).sort((a, b) => a - b);
  const values = observations.map((o) => o.jobValue).sort((a, b) => a - b);
  const sampleSize = observations.length;
  const coverageType = classifyJobPlanCoverage(jpnum, sampleSize);

  const craftMix: Record<string, number> = {};
  for (const o of observations) {
    craftMix[o.craftCode] = (craftMix[o.craftCode] ?? 0) + 1;
  }

  const medianHours = percentile(hours, 0.5);
  const medianJobValue = percentile(values, 0.5);

  return {
    jpnum,
    coverageType,
    sampleSize,
    medianHours,
    medianJobValue,
    hoursP10: percentile(hours, 0.1),
    hoursP90: percentile(hours, 0.9),
    complexityTier:
      coverageType === "SPECIFIC_TEMPLATE"
        ? deriveComplexityTier(medianHours, medianJobValue)
        : null,
    typicalCraftMix: craftMix,
  };
}

/**
 * Derives a 1–5 complexity tier from a SPECIFIC_TEMPLATE job plan's
 * median hours and median job value. This is a statistical bucketing
 * of the org's own historical data, not a subjective difficulty rating —
 * higher typical hours/value maps to a higher tier.
 *
 * This bucketing threshold set is a starting default and, per
 * Architecture v3.0 §J item 6, is a candidate for engineering
 * refinement (e.g. once a validated complexity taxonomy exists).
 */
function deriveComplexityTier(medianHours: number, medianJobValue: number): number {
  // Combine both signals into a single relative-magnitude score.
  const score = medianHours * 0.5 + medianJobValue / 1000;
  if (score < 2) return 1;
  if (score < 5) return 2;
  if (score < 10) return 3;
  if (score < 20) return 4;
  return 5;
}

/**
 * The coarse, universally-available complexity/urgency stratification
 * (Tier B) used for the generic-bucket majority of rows. Every field
 * here exists on effectively 100% of labor_confirmation rows via
 * work_order, unlike JPNUM-specific tiering.
 */
export interface CoarseComplexityContext {
  maintenanceClass: MaintenanceClass;
  isShutdownTurnaround: boolean;
  isEmergency: boolean;
}

export function determineComplexityConfidence(
  coverageType: JobPlanCoverageType
): ComplexityConfidence {
  if (coverageType === "SPECIFIC_TEMPLATE") return "RELIABLE";
  if (coverageType === "GENERIC_BUCKET") return "LOW_COVERAGE";
  return "NOT_APPLICABLE";
}

/**
 * Percentage of an employee-period's total hours that fell on
 * RELIABLE (Tier A) complexity-tiered work vs. LOW_COVERAGE (Tier B).
 * Every Layer 2 output row must carry this so a complexity-adjusted
 * number never gets presented without disclosing how much of it rests
 * on coarse vs. specific normalization (Blueprint v2.0 §C.2 point 3).
 */
export function computeComplexityCoveragePct(
  records: { totalHrs: number; complexityConfidence: ComplexityConfidence }[]
): number {
  const totalHrs = records.reduce((sum, r) => sum + r.totalHrs, 0);
  if (totalHrs === 0) return 0;
  const reliableHrs = records
    .filter((r) => r.complexityConfidence === "RELIABLE")
    .reduce((sum, r) => sum + r.totalHrs, 0);
  return round2((reliableHrs / totalHrs) * 100);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedAsc[lower]!;
  const weight = idx - lower;
  return sortedAsc[lower]! * (1 - weight) + sortedAsc[upper]! * weight;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
