/**
 * Layer 3 — Productivity / Labor Analytics (Blueprint v2.0 §D.3).
 *
 * Deliberately produces NO evidence_type/confidence_level and NO
 * 0-100 "score" — these are workload/scheduling descriptive metrics,
 * not skill claims. This module has no import from layer1-skill-
 * intelligence.ts and no function here returns anything resembling a
 * skill score, by design (Architecture v3.0 §A structural rule 3).
 */

export interface LaborAnalyticsInputRecord {
  totalHrs: number;
  otHrs: number;
  ot1Hrs: number | null;
  ot15Hrs: number | null;
  ot2Hrs: number | null;
  ot3Hrs: number | null;
  isEmergency: boolean;
  maintenanceClass: "PLANNED" | "REACTIVE" | "ADMIN" | "CAPEX_RENOVATE";
}

export interface LaborAnalyticsResult {
  totalHours: number;
  regularHours: number;
  otHours: number;
  otRatio: number | null;
  otTierMix: { ot1: number; ot1_5: number; ot2: number; ot3: number };
  emergencyHours: number;
  emergencyRatio: number | null;
  plannedVsReactiveMix: { plannedHours: number; reactiveHours: number };
}

export function aggregateLaborAnalytics(records: LaborAnalyticsInputRecord[]): LaborAnalyticsResult {
  const totalHours = sum(records, (r) => r.totalHrs);
  const otHours = sum(records, (r) => r.otHrs);
  const regularHours = round2(totalHours - otHours);
  const emergencyHours = round2(sum(records.filter((r) => r.isEmergency), (r) => r.totalHrs));

  return {
    totalHours: round2(totalHours),
    regularHours,
    otHours: round2(otHours),
    otRatio: totalHours > 0 ? round4(otHours / totalHours) : null,
    otTierMix: {
      ot1: round2(sum(records, (r) => r.ot1Hrs ?? 0)),
      ot1_5: round2(sum(records, (r) => r.ot15Hrs ?? 0)),
      ot2: round2(sum(records, (r) => r.ot2Hrs ?? 0)),
      ot3: round2(sum(records, (r) => r.ot3Hrs ?? 0)),
    },
    emergencyHours,
    emergencyRatio: totalHours > 0 ? round4(emergencyHours / totalHours) : null,
    plannedVsReactiveMix: {
      plannedHours: round2(sum(records.filter((r) => r.maintenanceClass === "PLANNED"), (r) => r.totalHrs)),
      reactiveHours: round2(sum(records.filter((r) => r.maintenanceClass === "REACTIVE"), (r) => r.totalHrs)),
    },
  };
}

function sum<T>(items: T[], f: (item: T) => number): number {
  return items.reduce((s, item) => s + f(item), 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
