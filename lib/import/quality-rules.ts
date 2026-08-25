import { computeLineCost, computeProfit, computeValuePerHour } from "@/lib/calc-engine/formulas";
import type { DataQualityFlag, DataQualityIssueType, IssueSeverity } from "@/lib/types/domain";

/**
 * Data Quality Check rules (Blueprint v2.0 §H, Architecture v3.0 §3.1
 * step 4). These are the business rules — not new rules invented here,
 * every one traces to a specific §H rule number in the comments.
 */

export interface QualityIssue {
  issueType: DataQualityIssueType;
  severity: IssueSeverity;
  fieldName: string | null;
  rawValue: string | null;
}

const FORMULA_MISMATCH_TOLERANCE = 0.5; // THB, small rounding tolerance observed in source data

/**
 * §H rule 1: ตัด != 'Use' rows are excluded from labor_confirmation.
 * Source values observed: 'Use', 'ตัด', 'Cut', '#DIV/0!', and missing
 * (2024 shape — treated as implicitly 'Use').
 */
export function mapSourceCutFlagToDataQualityFlag(sourceValue: unknown): DataQualityFlag {
  if (sourceValue === null || sourceValue === undefined || sourceValue === "") return "USE";
  const normalized = String(sourceValue).trim();
  if (normalized === "Use") return "USE";
  if (normalized === "#DIV/0!") return "ERROR";
  // 'ตัด' (Thai for "cut") and the English 'Cut' both mean excluded
  return "CUT";
}

/**
 * §H rule 2 / Architecture v3.0 §3.1 step 4: recompute line_cost, profit,
 * and value_per_hour from the verified formulas and compare to the
 * source-provided figures. A mismatch beyond tolerance raises
 * FORMULA_MISMATCH (WARNING, reviewable) rather than silently trusting
 * a possibly hand-edited source cell.
 */
export function checkFormulaConsistency(row: {
  payRate: number;
  totalHrs: number;
  employeeJobValue: number;
  sourceLineCost?: number | null;
  sourceProfit?: number | null;
  sourceValuePerHour?: number | null;
}): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const computedLineCost = computeLineCost(row.payRate, row.totalHrs);
  const computedProfit = computeProfit(row.employeeJobValue, computedLineCost);
  const computedValuePerHour = computeValuePerHour(row.employeeJobValue, row.totalHrs);

  if (
    row.sourceLineCost != null &&
    Math.abs(row.sourceLineCost - computedLineCost) > FORMULA_MISMATCH_TOLERANCE
  ) {
    issues.push({
      issueType: "FORMULA_MISMATCH",
      severity: "WARNING",
      fieldName: "line_cost",
      rawValue: String(row.sourceLineCost),
    });
  }

  if (
    row.sourceProfit != null &&
    Math.abs(row.sourceProfit - computedProfit) > FORMULA_MISMATCH_TOLERANCE
  ) {
    issues.push({
      issueType: "FORMULA_MISMATCH",
      severity: "WARNING",
      fieldName: "profit",
      rawValue: String(row.sourceProfit),
    });
  }

  if (
    row.sourceValuePerHour != null &&
    computedValuePerHour !== null &&
    Math.abs(row.sourceValuePerHour - computedValuePerHour) > FORMULA_MISMATCH_TOLERANCE
  ) {
    issues.push({
      issueType: "FORMULA_MISMATCH",
      severity: "WARNING",
      fieldName: "value_per_hour",
      rawValue: String(row.sourceValuePerHour),
    });
  }

  if (row.totalHrs === 0) {
    issues.push({
      issueType: "DIV_ZERO_ERROR",
      severity: "BLOCKING",
      fieldName: "total_hrs",
      rawValue: "0",
    });
  }

  return issues;
}

/**
 * §H rule 5/12: outlier detection for visibility (INFO), not automatic
 * exclusion — real loss-making jobs (negative profit/job value) are kept.
 * Only ตัด-flagged (CUT) rows are excluded from the conformed layer.
 */
export function flagOutlierIfExtreme(
  fieldName: string,
  value: number,
  peerP1: number,
  peerP99: number
): QualityIssue | null {
  if (value < peerP1 || value > peerP99) {
    return {
      issueType: "NEGATIVE_OUTLIER",
      severity: "INFO",
      fieldName,
      rawValue: String(value),
    };
  }
  return null;
}

/**
 * §H rule (unrecognized lookup codes): a new craft/work_type/jpnum not
 * yet in the lookup tables is flagged WARNING and auto-created as a
 * pending row (application code, not this pure function) — so a brand
 * new code next year doesn't require a source-code change, only an
 * admin review in /admin/data-quality.
 */
export function flagUnrecognizedCode(
  issueType: "UNRECOGNIZED_CRAFT" | "UNRECOGNIZED_WORKTYPE" | "UNRECOGNIZED_JPNUM",
  fieldName: string,
  rawValue: string
): QualityIssue {
  return { issueType, severity: "WARNING", fieldName, rawValue };
}
