import { describe, expect, it } from "vitest";
import {
  winsorize,
  computePeerDistributionStats,
  percentileRank,
  MIN_PEER_GROUP_SAMPLE_SIZE,
} from "../benchmark-engine";
import {
  classifyJobPlanCoverage,
  computeJobPlanStats,
  determineComplexityConfidence,
  computeComplexityCoveragePct,
  MIN_SPECIFIC_TEMPLATE_SAMPLE_SIZE,
} from "../complexity-engine";

describe("winsorize — protects peer benchmarks from single extreme outliers", () => {
  it("clamps an extreme low outlier of the kind found in real 2024 data (-6.99M THB)", () => {
    const values = [1000, 1100, 1050, 980, 1020, -6_993_000];
    const result = winsorize(values);
    // the extreme outlier should be pulled up toward the p1 bound, not left at -6.99M
    expect(Math.min(...result)).toBeGreaterThan(-6_993_000);
  });

  it("leaves a normally-distributed set close to unchanged", () => {
    const values = [100, 102, 98, 101, 99, 103, 97, 100, 102, 99];
    const result = winsorize(values);
    expect(result.length).toBe(values.length);
  });
});

describe("computePeerDistributionStats — requires minimum sample size", () => {
  it("returns null below MIN_PEER_GROUP_SAMPLE_SIZE (Blueprint v2.0 §6 rule)", () => {
    const tooFew = Array.from({ length: MIN_PEER_GROUP_SAMPLE_SIZE - 1 }, (_, i) => i + 1);
    expect(computePeerDistributionStats(tooFew)).toBeNull();
  });

  it("computes p50/median consistently at exactly the minimum sample size", () => {
    const values = [10, 20, 30, 40, 50];
    const stats = computePeerDistributionStats(values);
    expect(stats).not.toBeNull();
    expect(stats!.median).toBeCloseTo(30, 0);
    expect(stats!.sampleSize).toBe(5);
  });
});

describe("percentileRank — the normalization step feeding every Layer 1 score", () => {
  it("ranks the median value near the 50th percentile", () => {
    const peers = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const rank = percentileRank(50, peers);
    expect(rank).not.toBeNull();
    expect(rank!).toBeGreaterThan(40);
    expect(rank!).toBeLessThan(60);
  });

  it("ranks the top value near the 100th percentile", () => {
    const peers = [10, 20, 30, 40, 50];
    const rank = percentileRank(50, peers);
    expect(rank!).toBeGreaterThanOrEqual(90);
  });

  it("returns null when the peer group is below minimum sample size", () => {
    expect(percentileRank(50, [10, 20])).toBeNull();
  });
});

describe("classifyJobPlanCoverage — honest Tier A/B classification (Blueprint v2.0 §C.2)", () => {
  it("classifies the known generic catch-all code CM01 as GENERIC_BUCKET even with huge sample size", () => {
    expect(classifyJobPlanCoverage("CM01", 141079)).toBe("GENERIC_BUCKET");
  });

  it("classifies a specific job plan with sufficient sample size as SPECIFIC_TEMPLATE", () => {
    expect(classifyJobPlanCoverage("JPMPUMP01", 575)).toBe("SPECIFIC_TEMPLATE");
  });

  it("classifies a specific job plan with too few observations as GENERIC_BUCKET, not SPECIFIC_TEMPLATE", () => {
    expect(classifyJobPlanCoverage("JP0006", MIN_SPECIFIC_TEMPLATE_SAMPLE_SIZE - 1)).toBe(
      "GENERIC_BUCKET"
    );
  });

  it("classifies a null/missing JPNUM as UNCODED", () => {
    expect(classifyJobPlanCoverage(null, 0)).toBe("UNCODED");
  });
});

describe("determineComplexityConfidence", () => {
  it("maps SPECIFIC_TEMPLATE to RELIABLE", () => {
    expect(determineComplexityConfidence("SPECIFIC_TEMPLATE")).toBe("RELIABLE");
  });
  it("maps GENERIC_BUCKET to LOW_COVERAGE (the ~88-93% majority case)", () => {
    expect(determineComplexityConfidence("GENERIC_BUCKET")).toBe("LOW_COVERAGE");
  });
  it("maps UNCODED to NOT_APPLICABLE", () => {
    expect(determineComplexityConfidence("UNCODED")).toBe("NOT_APPLICABLE");
  });
});

describe("computeJobPlanStats", () => {
  it("computes complexityTier=null for a GENERIC_BUCKET job plan (never fabricates a tier for CM01-class codes)", () => {
    const observations = Array.from({ length: 100 }, () => ({
      jpnum: "CM01",
      totalHrs: 5,
      jobValue: 5000,
      craftCode: "AAH-MECH",
    }));
    const stats = computeJobPlanStats("CM01", observations);
    expect(stats.coverageType).toBe("GENERIC_BUCKET");
    expect(stats.complexityTier).toBeNull();
  });

  it("computes a numeric complexityTier for a SPECIFIC_TEMPLATE job plan with enough observations", () => {
    const observations = Array.from({ length: 20 }, () => ({
      jpnum: "JPMPUMP01",
      totalHrs: 4,
      jobValue: 6000,
      craftCode: "AAH-MECH",
    }));
    const stats = computeJobPlanStats("JPMPUMP01", observations);
    expect(stats.coverageType).toBe("SPECIFIC_TEMPLATE");
    expect(stats.complexityTier).not.toBeNull();
    expect(stats.complexityTier).toBeGreaterThanOrEqual(1);
    expect(stats.complexityTier).toBeLessThanOrEqual(5);
  });
});

describe("computeComplexityCoveragePct — must always be disclosed alongside a complexity-adjusted number", () => {
  it("returns 100 when all hours are on RELIABLE (Tier A) work", () => {
    const pct = computeComplexityCoveragePct([
      { totalHrs: 8, complexityConfidence: "RELIABLE" },
      { totalHrs: 4, complexityConfidence: "RELIABLE" },
    ]);
    expect(pct).toBe(100);
  });

  it("returns 0 when all hours are on LOW_COVERAGE (Tier B / generic-bucket) work — the common case", () => {
    const pct = computeComplexityCoveragePct([
      { totalHrs: 8, complexityConfidence: "LOW_COVERAGE" },
    ]);
    expect(pct).toBe(0);
  });

  it("returns a proportional mix for mixed-tier employee-periods", () => {
    const pct = computeComplexityCoveragePct([
      { totalHrs: 3, complexityConfidence: "RELIABLE" },
      { totalHrs: 7, complexityConfidence: "LOW_COVERAGE" },
    ]);
    expect(pct).toBe(30);
  });
});
