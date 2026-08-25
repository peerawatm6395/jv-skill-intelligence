import type { ImportColumnMappingProfile } from "@/lib/types/domain";
import type { ParsedSheetRow } from "./excel-parser";

/**
 * Column mapping (Architecture v3.0 §3.2 — the mechanism that avoids a
 * source-code change when a new month's file has a different column
 * shape, e.g. the observed 2026 drop of TYPE_BG / addition of
 * EMPLOYEETYPE). Applies mapping_profile.column_mapping to translate
 * source headers to conformed field names, and applies
 * derived_field_rules for fields absent from a given year's shape.
 */

export interface MappingCheckResult {
  ok: boolean;
  missingRequiredColumns: string[];
}

export function checkRequiredColumns(
  headerRow: string[],
  mappingProfile: ImportColumnMappingProfile
): MappingCheckResult {
  const present = new Set(headerRow);
  const missing = mappingProfile.required_columns.filter((col) => !present.has(col));
  return { ok: missing.length === 0, missingRequiredColumns: missing };
}

export function applyColumnMapping(
  row: ParsedSheetRow,
  mappingProfile: ImportColumnMappingProfile
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [sourceCol, targetField] of Object.entries(mappingProfile.column_mapping)) {
    if (sourceCol in row.rawPayload) {
      mapped[targetField] = row.rawPayload[sourceCol];
    }
  }
  return mapped;
}

/**
 * Derives category_bg/maintenance_class from work_type + wo_ref_type when
 * the source shape has no TYPE_BG column (the 2026 schema-drift case),
 * using the crosswalk verified in Blueprint v1.0 §0 and seeded into
 * work_type_lookup (supabase/seed.sql).
 */
export function deriveCategoryBgFromWorkType(
  workType: string,
  woRefType: string | null
): string {
  // Mirrors the verified crosswalk (Blueprint v1.0 §0). Shutdown reference
  // types take precedence over the base work_type mapping, matching the
  // observed source data (e.g. CM + MSD/ANSD/WWSD => "Shutdown").
  const shutdownTypes = new Set(["MSD", "ANSD", "WWSD"]);
  if (woRefType && shutdownTypes.has(woRefType)) return "Shutdown";
  if (woRefType === "FSD") return "Break Down";
  if (woRefType === "CAPEX") return "Capex";

  switch (workType) {
    case "CM":
    case "ADM":
      return "Corrective Maintenance";
    case "PM":
    case "IN":
    case "PDM":
      return "Preventive Maintenance";
    case "BD":
      return "Break Down";
    case "RVM":
    case "RVG":
      return "Renovate";
    case "CPM":
    case "CPO":
      return "Capex";
    default:
      return "Corrective Maintenance"; // conservative default, flagged via SCHEMA_DRIFT if unseen
  }
}
