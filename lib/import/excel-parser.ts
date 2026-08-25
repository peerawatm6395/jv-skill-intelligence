import * as XLSX from "xlsx";
import type { ImportColumnMappingProfile } from "@/lib/types/domain";

/**
 * Excel parsing (Architecture v3.0 §3.1 step 2 "Validate" / step 3 "Staging").
 * Parses a workbook buffer into per-sheet rows of raw column->value pairs,
 * matched against sheet_name_pattern from the selected mapping profile.
 */

export interface ParsedSheetRow {
  sourceSheet: string;
  sourceRowNum: number; // 1-based, includes header row as row 1
  rawPayload: Record<string, unknown>;
}

export interface ParsedWorkbookResult {
  sheets: string[];
  matchedSheets: string[];
  rows: ParsedSheetRow[];
  headerBySheet: Record<string, string[]>;
}

export function parseWorkbook(
  fileBuffer: ArrayBuffer,
  mappingProfile: ImportColumnMappingProfile
): ParsedWorkbookResult {
  const workbook = XLSX.read(fileBuffer, { type: "array", cellDates: true });
  const pattern = mappingProfile.sheet_name_pattern
    ? globToRegExp(mappingProfile.sheet_name_pattern)
    : null;

  const matchedSheets = pattern
    ? workbook.SheetNames.filter((name) => pattern.test(name))
    : workbook.SheetNames;

  const rows: ParsedSheetRow[] = [];
  const headerBySheet: Record<string, string[]> = {};

  for (const sheetName of matchedSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });

    const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      range: 0,
    })[0] as unknown as string[] | undefined;
    headerBySheet[sheetName] = headerRow ?? [];

    json.forEach((row, idx) => {
      rows.push({
        sourceSheet: sheetName,
        sourceRowNum: idx + 2, // +1 for 0-index, +1 for header row
        rawPayload: row,
      });
    });
  }

  return { sheets: workbook.SheetNames, matchedSheets, rows, headerBySheet };
}

/** Converts a simple glob pattern like "JV%" into a RegExp (only '%' and '*' as wildcards). */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/[%*]/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}
