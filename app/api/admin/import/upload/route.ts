import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, RoleCapabilities, ForbiddenError } from "@/lib/auth/rbac";
import { parseWorkbook } from "@/lib/import/excel-parser";
import { checkRequiredColumns, applyColumnMapping } from "@/lib/import/column-mapper";
import { validateMappedRow } from "@/lib/import/validation-rules";
import type { ImportColumnMappingProfile } from "@/lib/types/domain";

/**
 * Upload → Validate → Staging (Architecture v3.0 §3.1 steps 1-3).
 * ADMIN/HRBP only. The original file is written to Supabase Storage
 * (audit trail) before anything is parsed.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(["ADMIN", "HRBP"]);
    if (!RoleCapabilities.canUploadImport(user.role)) {
      throw new ForbiddenError("Role cannot upload imports");
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mappingProfileId = formData.get("mappingProfileId") as string | null;
    const periodCovered = formData.get("periodCovered") as string | null;
    const replacesBatchId = formData.get("replacesBatchId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!mappingProfileId) {
      return NextResponse.json({ error: "mappingProfileId is required" }, { status: 400 });
    }

    // service-role client: the import pipeline writes across staging/
    // conformed tables that don't yet have a per-row RBAC context.
    const service = createServiceRoleClient();
    const userScoped = await createServerSupabaseClient();

    const { data: mappingProfile, error: mpError } = await service
      .from("import_column_mapping_profile")
      .select("*")
      .eq("profile_id", mappingProfileId)
      .single();

    if (mpError || !mappingProfile) {
      return NextResponse.json({ error: "Mapping profile not found" }, { status: 400 });
    }

    const storagePath = `${new Date().getFullYear()}/${Date.now()}-${file.name}`;
    const fileBuffer = await file.arrayBuffer();

    const { error: storageError } = await service.storage
      .from("raw-uploads")
      .upload(storagePath, fileBuffer, { contentType: file.type });

    if (storageError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${storageError.message}` },
        { status: 500 }
      );
    }

    const { data: authData } = await userScoped.auth.getUser();

    const { data: batch, error: batchError } = await service
      .from("data_import_batch")
      .insert({
        source_filename: file.name,
        uploaded_by_user_id: authData.user!.id,
        storage_object_path: storagePath,
        mapping_profile_id: mappingProfileId,
        period_covered: periodCovered,
        replaces_batch_id: replacesBatchId,
        status: "UPLOADED",
      })
      .select()
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Failed to create import batch" }, { status: 500 });
    }

    // ---- Validate ----
    await service.from("data_import_batch").update({ status: "VALIDATING" }).eq("batch_id", batch.batch_id);

    const parsed = parseWorkbook(fileBuffer, mappingProfile as ImportColumnMappingProfile);

    const missingBySheet: Record<string, string[]> = {};
    for (const sheet of parsed.matchedSheets) {
      const header = parsed.headerBySheet[sheet] ?? [];
      const check = checkRequiredColumns(header, mappingProfile as ImportColumnMappingProfile);
      if (!check.ok) missingBySheet[sheet] = check.missingRequiredColumns;
    }

    if (Object.keys(missingBySheet).length > 0) {
      await service
        .from("data_import_batch")
        .update({
          status: "FAILED",
          error_log: { missingRequiredColumns: missingBySheet },
        })
        .eq("batch_id", batch.batch_id);

      return NextResponse.json(
        {
          batchId: batch.batch_id,
          status: "FAILED",
          error: "Required columns missing — check the selected mapping profile matches this file's shape.",
          missingBySheet,
        },
        { status: 422 }
      );
    }

    // ---- Staging ----
    const stagingRows = parsed.rows.map((row) => {
      const mapped = applyColumnMapping(row, mappingProfile as ImportColumnMappingProfile);
      const issues = validateMappedRow(mapped);
      return {
        batch_id: batch.batch_id,
        source_sheet: row.sourceSheet,
        source_row_num: row.sourceRowNum,
        raw_payload: row.rawPayload,
        mapped_payload: mapped,
        validation_status: issues.some((i) => i.severity === "BLOCKING") ? "INVALID" : "VALID",
      };
    });

    // Insert in chunks to stay within request payload limits.
    const CHUNK_SIZE = 500;
    for (let i = 0; i < stagingRows.length; i += CHUNK_SIZE) {
      await service.from("staging_jv_labor").insert(stagingRows.slice(i, i + CHUNK_SIZE));
    }

    await service
      .from("data_import_batch")
      .update({
        status: "STAGED",
        row_count_raw: parsed.rows.length,
        row_count_staged: stagingRows.length,
      })
      .eq("batch_id", batch.batch_id);

    return NextResponse.json({
      batchId: batch.batch_id,
      status: "STAGED",
      rowCountRaw: parsed.rows.length,
      rowCountStaged: stagingRows.length,
      nextStep: `POST /api/admin/import/${batch.batch_id}/quality-check`,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "UnauthorizedError") {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof Error && err.name === "ForbiddenError") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
