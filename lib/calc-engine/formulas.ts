/**
 * Verified core formulas (Blueprint v1.0 §0 / v2.0 §C.1).
 *
 * These were reverse-engineered from the real JV export and confirmed to
 * match to the cent against source rows. They are the ONLY place these
 * calculations may be implemented — every other module in the calc-engine
 * must call these functions rather than re-deriving the arithmetic.
 *
 * DO NOT change these formulas without a new approved Blueprint revision.
 * See Implementation Architecture v3.0, "ห้ามเปลี่ยนสูตร KPI จาก Blueprint v2.0".
 */

/**
 * Individual employee's labor cost for one labor-confirmation line.
 * Verified exact: LINECOST = PAYRATE × TOTALHRS.
 *
 * This is the ONLY per-employee cost figure in the system. The source
 * field ACTLABCOST is a work-order-level total broadcast across every
 * labor line on that WO and must never be used here or anywhere else
 * as an individual cost (Blueprint v1.0 §0, Architecture v3.0 §6).
 */
export function computeLineCost(payRate: number, totalHrs: number): number {
  return round2(payRate * totalHrs);
}

/**
 * Individual employee's profit for one labor-confirmation line.
 * Verified exact: PROFIT = employee_job_value − line_cost.
 */
export function computeProfit(employeeJobValue: number, lineCost: number): number {
  return round2(employeeJobValue - lineCost);
}

/**
 * Value generated per hour worked.
 * Verified exact: value_per_hour = employee_job_value ÷ total_hrs.
 * Returns null when total_hrs is 0 (division by zero — such rows are
 * exactly the class of anomaly the source ตัด/'ตัด'/'#DIV/0!' flag
 * exists to catch; see lib/import/quality-rules.ts).
 */
export function computeValuePerHour(
  employeeJobValue: number,
  totalHrs: number
): number | null {
  if (totalHrs === 0) return null;
  return round2(employeeJobValue / totalHrs);
}

/**
 * Skill-weighted effective hours for one labor line, used to compute
 * an employee's share of a multi-worker work order.
 * Verified: factor_hrs = factor_weight × total_hrs.
 *
 * factor_weight comes from craft_skill_factor — a deterministic
 * administrative pay-weighting lookup keyed on (craft, skill_level).
 * It is NOT a performance or competency signal; it exists only to
 * correctly reconstruct this distribution math.
 */
export function computeFactorHrs(factorWeight: number, totalHrs: number): number {
  return factorWeight * totalHrs;
}

/**
 * An employee's proportional share of a work order's total job value,
 * based on their skill-weighted hour contribution relative to all
 * labor lines on that WO.
 * Verified: ratio_share = factor_hrs ÷ Σ(factor_hrs across the WO).
 */
export function computeRatioShare(factorHrs: number, sumFactorHrsOnWo: number): number | null {
  if (sumFactorHrsOnWo === 0) return null;
  return round4(factorHrs / sumFactorHrsOnWo);
}

/**
 * An employee's distributed share of a work order's total job value.
 * Verified: employee_job_value ≈ wo_job_value × ratio_share
 * (small rounding deltas observed in source data, <1%).
 */
export function computeDistributedJobValue(
  woJobValue: number,
  ratioShare: number
): number {
  return round2(woJobValue * ratioShare);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
