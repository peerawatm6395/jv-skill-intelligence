import type { DataQualityIssueType, IssueSeverity } from "@/lib/types/domain";

/**
 * Validation step (Architecture v3.0 §3.1 step 2 "Validate" and step 4
 * "Data Quality Check"). Pure functions over already-parsed/mapped rows —
 * no DB or file I/O here, so these are independently testable and the
 * orchestration in app/api/admin/import/* stays thin.
 */

export interface ValidationIssue {
  issueType: DataQualityIssueType;
  severity: IssueSeverity;
  fieldName: string | null;
  rawValue: string | null;
}

const REQUIRED_NUMERIC_FIELDS = [
  "regular_hrs",
  "ot_hrs",
  "total_hrs",
  "pay_rate",
  "factor_weight",
  "wo_job_value",
  "ratio_share",
  "employee_job_value",
];

const REQUIRED_NON_NULL_FIELDS = [
  "labor_code",
  "craft_code",
  "skill_level_code",
  "wonum",
  "work_type",
  "timesheet_date",
];

export function validateMappedRow(mapped: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of REQUIRED_NON_NULL_FIELDS) {
    const value = mapped[field];
    if (value === null || value === undefined || value === "") {
      issues.push({
        issueType: "MISSING_REQUIRED_FIELD",
        severity: "BLOCKING",
        fieldName: field,
        rawValue: null,
      });
    }
  }

  for (const field of REQUIRED_NUMERIC_FIELDS) {
    const value = mapped[field];
    if (value !== null && value !== undefined && value !== "" && typeof value !== "number") {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        issues.push({
          issueType: "MISSING_REQUIRED_FIELD",
          severity: "WARNING",
          fieldName: field,
          rawValue: String(value),
        });
      }
    }
  }

  const timesheetDate = mapped.timesheet_date;
  if (timesheetDate) {
    const date = timesheetDate instanceof Date ? timesheetDate : new Date(String(timesheetDate));
    if (Number.isNaN(date.getTime())) {
      issues.push({
        issueType: "DATE_OUT_OF_RANGE",
        severity: "BLOCKING",
        fieldName: "timesheet_date",
        rawValue: String(timesheetDate),
      });
    } else {
      const year = date.getFullYear();
      if (year < 2020 || year > 2035) {
        issues.push({
          issueType: "DATE_OUT_OF_RANGE",
          severity: "WARNING",
          fieldName: "timesheet_date",
          rawValue: String(timesheetDate),
        });
      }
    }
  }

  return issues;
}

/**
 * Duplicate detection key: same (wonum, labor_code, timesheet_date) plus
 * a content hash of the numeric fields, so a genuinely repeated row is
 * flagged without false-positiving on an employee legitimately logging
 * two different lines against the same WO on the same day.
 */
export function computeRowDedupeKey(mapped: Record<string, unknown>): string {
  const parts = [
    mapped.wonum,
    mapped.labor_code,
    mapped.timesheet_date,
    mapped.total_hrs,
    mapped.employee_job_value,
  ];
  return parts.map((p) => String(p ?? "")).join("|");
}

export function detectDuplicates(
  rows: { dedupeKey: string; rowIndex: number }[]
): number[] /* rowIndex values that are duplicates of an earlier row */ {
  const seen = new Set<string>();
  const duplicateRowIndexes: number[] = [];
  for (const row of rows) {
    if (seen.has(row.dedupeKey)) {
      duplicateRowIndexes.push(row.rowIndex);
    } else {
      seen.add(row.dedupeKey);
    }
  }
  return duplicateRowIndexes;
}
