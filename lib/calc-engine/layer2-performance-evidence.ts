import type { MaintenanceClass } from "@/lib/types/domain";
import type { ComplexityConfidence } from "./complexity-engine";
import { computeComplexityCoveragePct } from "./complexity-engine";
import { percentileRank } from "./benchmark-engine";

/**
 * Layer 2 — Performance Evidence (Blueprint v2.0 §D.1).
 *
 * Computes "what did the system observe this employee do, relative to
 * peers doing comparably complex work" — deliberately NOT a skill claim.
 * Output feeds Layer 1 (skill-intelligence.ts) as SYSTEM_EVIDENCE_ONLY
 * input; it never writes a SKILL_INTELLIGENCE-layer kpi_result itself.
 */

export interface EvidenceInputRecord {
  employeeId: string;
  totalHrs: number;
  lineCost: number;
  employeeJobValue: number;
  maintenanceClass: MaintenanceClass;
  isEmergency: boolean;
  complexityConfidence: ComplexityConfidence;
  assetnum: string | null;
  workType: string;
  plant: string | null;
}

export interface PerformanceEvidenceResult {
  employeeId: string;
  totalHours: number;
  totalValueGenerated: number;
  totalCost: number;
  valuePerHourRaw: number | null;
  costEfficiencyRatio: number | null;
  pmHours: number;
  pmValuePerHour: number | null;
  cmHours: number;
  cmValuePerHour: number | null;
  distinctWorkTypes: number;
  distinctAssets: number;
  distinctPlants: number;
  emergencyHours: number;
  recordCount: number;
  complexityCoveragePct: number;
}

/** Aggregates raw labor-confirmation-derived records into one employee-period's Performance Evidence. */
export function aggregatePerformanceEvidence(
  employeeId: string,
  records: EvidenceInputRecord[]
): PerformanceEvidenceResult {
  const totalHours = sum(records, (r) => r.totalHrs);
  const totalValueGenerated = sum(records, (r) => r.employeeJobValue);
  const totalCost = sum(records, (r) => r.lineCost);

  const planned = records.filter((r) => r.maintenanceClass === "PLANNED");
  const reactive = records.filter((r) => r.maintenanceClass === "REACTIVE");

  return {
    employeeId,
    totalHours: round2(totalHours),
    totalValueGenerated: round2(totalValueGenerated),
    totalCost: round2(totalCost),
    valuePerHourRaw: safeDiv(totalValueGenerated, totalHours),
    costEfficiencyRatio: safeDiv(totalValueGenerated, totalCost),
    pmHours: round2(sum(planned, (r) => r.totalHrs)),
    pmValuePerHour: safeDiv(sum(planned, (r) => r.employeeJobValue), sum(planned, (r) => r.totalHrs)),
    cmHours: round2(sum(reactive, (r) => r.totalHrs)),
    cmValuePerHour: safeDiv(
      sum(reactive, (r) => r.employeeJobValue),
      sum(reactive, (r) => r.totalHrs)
    ),
    distinctWorkTypes: new Set(records.map((r) => r.workType)).size,
    distinctAssets: new Set(records.map((r) => r.assetnum).filter(Boolean)).size,
    distinctPlants: new Set(records.map((r) => r.plant).filter(Boolean)).size,
    emergencyHours: round2(sum(records.filter((r) => r.isEmergency), (r) => r.totalHrs)),
    recordCount: records.length,
    complexityCoveragePct: computeComplexityCoveragePct(
      records.map((r) => ({ totalHrs: r.totalHrs, complexityConfidence: r.complexityConfidence }))
    ),
  };
}

/**
 * PERF_TECHNICAL_RANGE (Blueprint v2.0 §D.1.5) — explicitly a proxy.
 * Composite percentile of (CM value efficiency) + (breadth) + (emergency
 * participation rate). Must be presented in the UI labeled "proxy".
 */
export function computeTechnicalRangeProxyScore(
  cmValuePerHourPercentile: number | null,
  breadthPercentile: number | null,
  emergencyParticipationRatePercentile: number | null
): number | null {
  const components = [
    cmValuePerHourPercentile,
    breadthPercentile,
    emergencyParticipationRatePercentile,
  ].filter((v): v is number => v !== null);

  if (components.length === 0) return null;
  return round2(components.reduce((s, v) => s + v, 0) / components.length);
}

/** Converts a raw evidence metric to a 0-100 percentile score against its peer group. */
export function normalizePerformanceMetric(
  rawValue: number | null,
  peerValues: number[]
): number | null {
  if (rawValue === null) return null;
  return percentileRank(rawValue, peerValues);
}

function sum<T>(items: T[], f: (item: T) => number): number {
  return items.reduce((s, item) => s + f(item), 0);
}

function safeDiv(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return round2(numerator / denominator);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
