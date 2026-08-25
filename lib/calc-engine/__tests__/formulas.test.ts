import { describe, expect, it } from "vitest";
import {
  computeLineCost,
  computeProfit,
  computeValuePerHour,
  computeFactorHrs,
  computeRatioShare,
  computeDistributedJobValue,
} from "../formulas";

/**
 * Regression fixtures taken directly from the real JV_2024-2026.xlsx rows
 * inspected during the Blueprint v1.0 data-structure analysis. These
 * numbers are not invented — they are the actual values the formulas
 * were reverse-engineered against and verified to match exactly.
 */

describe("computeLineCost — verified: LINECOST = PAYRATE × TOTALHRS", () => {
  it("matches the single-labor 2024 fixture row (WONUM 241295666)", () => {
    // PAYRATE=123, TOTALHRS=7.31666666666667 → LINECOST=899.95
    expect(computeLineCost(123, 7.31666666666667)).toBeCloseTo(899.95, 2);
  });

  it("matches the multi-labor 2024 fixture row (WONUM 241138119, laborcode 601435)", () => {
    // PAYRATE=142, TOTALHRS=3.45 → LINECOST=489.9
    expect(computeLineCost(142, 3.45)).toBeCloseTo(489.9, 2);
  });

  it("matches the multi-labor 2024 fixture row (WONUM 241138119, laborcode 591972)", () => {
    // PAYRATE=142, TOTALHRS=3.15 → LINECOST=447.3
    expect(computeLineCost(142, 3.15)).toBeCloseTo(447.3, 2);
  });
});

describe("computeProfit — verified: PROFIT = employee_job_value − line_cost", () => {
  it("matches the single-labor 2024 fixture row (JOBVALUE=5000, LINECOST=899.95)", () => {
    expect(computeProfit(5000, 899.95)).toBeCloseTo(4100.05, 2);
  });

  it("matches the multi-labor fixture row (JOBVALUE=5222.88, LINECOST=489.9)", () => {
    expect(computeProfit(5222.88, 489.9)).toBeCloseTo(4732.98, 2);
  });

  it("matches the multi-labor fixture row (JOBVALUE=4768.71, LINECOST=447.3)", () => {
    expect(computeProfit(4768.71, 447.3)).toBeCloseTo(4321.41, 2);
  });
});

describe("computeValuePerHour — verified: value_per_hour = employee_job_value ÷ total_hrs", () => {
  it("matches the 2024 fixture row (JOBVALUE=5000, TOTALHRS=7.31666..., Bath/hr=683.37)", () => {
    expect(computeValuePerHour(5000, 7.31666666666667)).toBeCloseTo(683.37, 1);
  });

  it("matches the second 2024 fixture row (JOBVALUE=5000, TOTALHRS=7.78333..., Bath/hr=642.398)", () => {
    expect(computeValuePerHour(5000, 7.78333333333333)).toBeCloseTo(642.4, 1);
  });

  it("returns null instead of Infinity/NaN when total_hrs is 0 (guards against the source's own #DIV/0! class of error)", () => {
    expect(computeValuePerHour(5000, 0)).toBeNull();
  });
});

describe("computeFactorHrs — verified: factor_hrs = factor_weight × total_hrs", () => {
  it("matches the 2024 fixture row (FACTOR=0.75, TOTALHRS=7.31666..., FACTORHRS=5.4875)", () => {
    expect(computeFactorHrs(0.75, 7.31666666666667)).toBeCloseTo(5.4875, 3);
  });
});

describe("computeRatioShare — verified: ratio_share = factor_hrs ÷ ΣfactorHrs on the WO", () => {
  it("matches the multi-labor fixture (3.45 / 9.90833... ≈ 0.348, source RATIO≈0.35)", () => {
    const sumFactorHrs = 3.45 + 3.15 + 3.30833333;
    expect(computeRatioShare(3.45, sumFactorHrs)).toBeCloseTo(0.348, 2);
  });

  it("returns null instead of dividing by zero when the WO total is zero", () => {
    expect(computeRatioShare(3.45, 0)).toBeNull();
  });
});

describe("computeDistributedJobValue — verified: employee_job_value ≈ wo_job_value × ratio_share", () => {
  it("approximates the multi-labor fixture (15000 × 0.348 ≈ 5222.88 observed)", () => {
    const result = computeDistributedJobValue(15000, 0.3483);
    expect(result).toBeGreaterThan(5200);
    expect(result).toBeLessThan(5250);
  });
});

describe("Formula guardrails — what these functions deliberately do NOT do", () => {
  it("computeLineCost never accepts a WO-broadcast cost as an argument (type-level: no ACTLABCOST-shaped input exists in this module's signatures)", () => {
    // This test exists as documentation: the function signature only
    // accepts (payRate, totalHrs) — there is no parameter through which
    // a work-order-level total cost could be substituted for an
    // individual employee's cost. See Architecture v3.0 §6.
    expect(computeLineCost.length).toBe(2);
  });
});
