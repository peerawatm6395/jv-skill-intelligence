import { describe, expect, it } from "vitest";
import { validateMappedRow, computeRowDedupeKey, detectDuplicates } from "../validation-rules";
import {
  mapSourceCutFlagToDataQualityFlag,
  checkFormulaConsistency,
  flagOutlierIfExtreme,
} from "../quality-rules";

describe("mapSourceCutFlagToDataQualityFlag — §H rule 1", () => {
  it("maps 'Use' to USE", () => {
    expect(mapSourceCutFlagToDataQualityFlag("Use")).toBe("USE");
  });
  it("maps missing/null (2024 shape) to USE", () => {
    expect(mapSourceCutFlagToDataQualityFlag(null)).toBe("USE");
    expect(mapSourceCutFlagToDataQualityFlag(undefined)).toBe("USE");
  });
  it("maps Thai 'ตัด' and English 'Cut' to CUT", () => {
    expect(mapSourceCutFlagToDataQualityFlag("ตัด")).toBe("CUT");
    expect(mapSourceCutFlagToDataQualityFlag("Cut")).toBe("CUT");
  });
  it("maps '#DIV/0!' to ERROR", () => {
    expect(mapSourceCutFlagToDataQualityFlag("#DIV/0!")).toBe("ERROR");
  });
});

describe("checkFormulaConsistency — recomputes and cross-checks against source", () => {
  it("raises no issues when source figures match the verified formulas", () => {
    const issues = checkFormulaConsistency({
      payRate: 123,
      totalHrs: 7.31666666666667,
      employeeJobValue: 5000,
      sourceLineCost: 899.95,
      sourceProfit: 4100.05,
      sourceValuePerHour: 683.37,
    });
    expect(issues.filter((i) => i.issueType === "FORMULA_MISMATCH")).toHaveLength(0);
  });

  it("flags FORMULA_MISMATCH when a source figure diverges beyond tolerance", () => {
    const issues = checkFormulaConsistency({
      payRate: 123,
      totalHrs: 7.31666666666667,
      employeeJobValue: 5000,
      sourceLineCost: 5000, // clearly wrong / hand-edited
    });
    expect(issues.some((i) => i.issueType === "FORMULA_MISMATCH" && i.fieldName === "line_cost")).toBe(
      true
    );
  });

  it("flags DIV_ZERO_ERROR as BLOCKING when total_hrs is 0", () => {
    const issues = checkFormulaConsistency({ payRate: 100, totalHrs: 0, employeeJobValue: 500 });
    const divZero = issues.find((i) => i.issueType === "DIV_ZERO_ERROR");
    expect(divZero).toBeDefined();
    expect(divZero!.severity).toBe("BLOCKING");
  });
});

describe("flagOutlierIfExtreme — INFO only, never auto-excludes real loss-making jobs", () => {
  it("flags a value outside the peer p1/p99 band as INFO", () => {
    const issue = flagOutlierIfExtreme("profit", -6_993_000, -5000, 40000);
    expect(issue).not.toBeNull();
    expect(issue!.severity).toBe("INFO");
  });

  it("does not flag a value inside the band", () => {
    expect(flagOutlierIfExtreme("profit", 3000, -5000, 40000)).toBeNull();
  });
});

describe("validateMappedRow", () => {
  it("flags MISSING_REQUIRED_FIELD as BLOCKING when a required field is null", () => {
    const issues = validateMappedRow({ craft_code: "AAH-MECH", timesheet_date: "2026-01-01" });
    const missing = issues.filter((i) => i.issueType === "MISSING_REQUIRED_FIELD");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]!.severity).toBe("BLOCKING");
  });

  it("passes a fully-populated row with no issues", () => {
    const issues = validateMappedRow({
      labor_code: 1001,
      craft_code: "AAH-MECH",
      skill_level_code: "LV1",
      wonum: 241295666,
      work_type: "CM",
      timesheet_date: new Date("2026-01-15"),
      regular_hrs: 7.3,
      ot_hrs: 0,
      total_hrs: 7.3,
      pay_rate: 123,
      factor_weight: 1,
      wo_job_value: 5000,
      ratio_share: 1,
      employee_job_value: 5000,
    });
    expect(issues).toHaveLength(0);
  });
});

describe("detectDuplicates", () => {
  it("flags the second occurrence of an identical dedupe key as a duplicate", () => {
    const key = computeRowDedupeKey({
      wonum: 1,
      labor_code: 100,
      timesheet_date: "2026-01-01",
      total_hrs: 8,
      employee_job_value: 5000,
    });
    const duplicates = detectDuplicates([
      { dedupeKey: key, rowIndex: 1 },
      { dedupeKey: key, rowIndex: 2 },
    ]);
    expect(duplicates).toEqual([2]);
  });

  it("does not flag two different rows with different values", () => {
    const rows = [
      { dedupeKey: computeRowDedupeKey({ wonum: 1, labor_code: 100, timesheet_date: "2026-01-01", total_hrs: 8, employee_job_value: 5000 }), rowIndex: 1 },
      { dedupeKey: computeRowDedupeKey({ wonum: 1, labor_code: 100, timesheet_date: "2026-01-01", total_hrs: 4, employee_job_value: 2500 }), rowIndex: 2 },
    ];
    expect(detectDuplicates(rows)).toEqual([]);
  });
});
