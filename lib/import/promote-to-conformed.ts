import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeLineCost,
  computeProfit,
  computeValuePerHour,
} from "@/lib/calc-engine/formulas";
import { mapSourceCutFlagToDataQualityFlag } from "./quality-rules";
import { deriveCategoryBgFromWorkType } from "./column-mapper";

/**
 * Promotion step (Architecture v3.0 §3.1 step 5 "Import"). Runs against
 * the service-role Supabase client (bypasses RLS by design — this is
 * server-only pipeline code, never a per-user request path). Handles:
 *
 *  - employee SCD2: if craft/skill_level differ from the current version,
 *    close the old version (effective_to) and open a new one.
 *  - work_order upsert (and work_type_lookup auto-insert for a new,
 *    previously-unseen work_type — flagged for admin review rather than
 *    requiring a code change).
 *  - labor_confirmation insert with the recomputed (not blindly trusted)
 *    line_cost / profit / value_per_hour.
 *
 * NOTE: this module never reads or writes anything resembling the
 * source's ACTLABCOST field — there is no parameter for it anywhere
 * in this pipeline (Architecture v3.0 §6).
 */

export interface MappedStagingRow {
  staging_id: string;
  batch_id: string;
  labor_code: number;
  display_name: string;
  thai_name: string | null;
  employee_type: string | null;
  craft_code: string;
  skill_level_code: string;
  supervisor_code: number | null;
  supervisor_name: string | null;
  company: string | null;
  plant: string | null;
  subplant: string | null;
  team: string | null;
  wonum: number;
  description: string | null;
  work_type: string;
  wo_ref_type: string | null;
  jpnum: string | null;
  assetnum: string | null;
  location: string | null;
  timesheet_date: string;
  work_close_date: string | null;
  regular_hrs: number;
  ot_hrs: number;
  ot1_hrs: number | null;
  ot1_5_hrs: number | null;
  ot2_hrs: number | null;
  ot3_hrs: number | null;
  total_hrs: number;
  pay_rate: number;
  factor_weight: number;
  wo_job_value: number | null;
  ratio_share: number | null;
  employee_job_value: number;
  employee_job_value_reg: number | null;
  employee_job_value_ot: number | null;
  emer_plant: string | null;
  source_year: number;
  data_quality_flag_source: unknown;
  category_bg_source: string | null;
}

export interface PromotionResult {
  promotedCount: number;
  blockedCount: number;
  newCraftCodesSeen: string[];
  newWorkTypesSeen: string[];
}

export async function promoteStagingBatch(
  supabase: SupabaseClient,
  batchId: string,
  rows: MappedStagingRow[]
): Promise<PromotionResult> {
  const newCraftCodesSeen = new Set<string>();
  const newWorkTypesSeen = new Set<string>();
  let promotedCount = 0;
  let blockedCount = 0;

  // Pre-load known lookups once for the whole batch.
  const { data: knownCrafts } = await supabase.from("craft").select("craft_code");
  const knownCraftSet = new Set((knownCrafts ?? []).map((c: { craft_code: string }) => c.craft_code));

  const { data: knownWorkTypes } = await supabase.from("work_type_lookup").select("work_type");
  const knownWorkTypeSet = new Set(
    (knownWorkTypes ?? []).map((w: { work_type: string }) => w.work_type)
  );

  for (const row of rows) {
    // Auto-create unrecognized craft (flagged elsewhere as UNRECOGNIZED_CRAFT for review).
    if (!knownCraftSet.has(row.craft_code)) {
      await supabase
        .from("craft")
        .upsert({ craft_code: row.craft_code, craft_name: row.craft_code, is_active: true }, { onConflict: "craft_code" });
      knownCraftSet.add(row.craft_code);
      newCraftCodesSeen.add(row.craft_code);
    }

    // Auto-create unrecognized work_type similarly.
    if (!knownWorkTypeSet.has(row.work_type)) {
      const categoryBg =
        row.category_bg_source ?? deriveCategoryBgFromWorkType(row.work_type, row.wo_ref_type);
      await supabase.from("work_type_lookup").upsert(
        { work_type: row.work_type, category_bg: categoryBg, maintenance_class: "ADMIN" },
        { onConflict: "work_type" }
      );
      knownWorkTypeSet.add(row.work_type);
      newWorkTypesSeen.add(row.work_type);
    }

    const employeeId = await upsertEmployeeScd2(supabase, row);
    if (!employeeId) {
      blockedCount++;
      continue;
    }

    await upsertWorkOrder(supabase, row);

    const lineCost = computeLineCost(row.pay_rate, row.total_hrs);
    const profit = computeProfit(row.employee_job_value, lineCost);
    const valuePerHour = computeValuePerHour(row.employee_job_value, row.total_hrs);
    const dataQualityFlag = mapSourceCutFlagToDataQualityFlag(row.data_quality_flag_source);

    if (valuePerHour === null) {
      // total_hrs = 0 — cannot compute value_per_hour; treat as ERROR quality flag
      // rather than inserting a row with a fabricated value.
      blockedCount++;
      continue;
    }

    const { error: insertError } = await supabase.from("labor_confirmation").insert({
      wonum: row.wonum,
      employee_id: employeeId,
      timesheet_date: row.timesheet_date,
      regular_hrs: row.regular_hrs,
      ot_hrs: row.ot_hrs,
      ot1_hrs: row.ot1_hrs,
      ot1_5_hrs: row.ot1_5_hrs,
      ot2_hrs: row.ot2_hrs,
      ot3_hrs: row.ot3_hrs,
      total_hrs: row.total_hrs,
      pay_rate: row.pay_rate,
      factor_weight: row.factor_weight,
      line_cost: lineCost,
      ratio_share: row.ratio_share,
      wo_job_value: row.wo_job_value,
      employee_job_value: row.employee_job_value,
      employee_job_value_reg: row.employee_job_value_reg,
      employee_job_value_ot: row.employee_job_value_ot,
      profit,
      value_per_hour: valuePerHour,
      data_quality_flag: dataQualityFlag,
      source_year: row.source_year,
      import_batch_id: batchId,
      raw_staging_ref: row.staging_id,
    });

    if (insertError) {
      blockedCount++;
      continue;
    }

    await supabase
      .from("staging_jv_labor")
      .update({ promoted_to_labor_confirmation: true, validation_status: "VALID" })
      .eq("staging_id", row.staging_id);

    promotedCount++;
  }

  return {
    promotedCount,
    blockedCount,
    newCraftCodesSeen: [...newCraftCodesSeen],
    newWorkTypesSeen: [...newWorkTypesSeen],
  };
}

/**
 * SCD Type 2 employee upsert. If the employee is new, inserts a first
 * version. If craft_code or skill_level_code differ from the current
 * version, closes the old version (effective_to) and opens a new one.
 * Otherwise reuses the existing current version's employee_id.
 */
async function upsertEmployeeScd2(
  supabase: SupabaseClient,
  row: MappedStagingRow
): Promise<string | null> {
  const { data: current } = await supabase
    .from("employee")
    .select("employee_id, craft_code, skill_level_code")
    .eq("labor_code", row.labor_code)
    .eq("is_current", true)
    .maybeSingle();

  if (!current) {
    const { data: inserted, error } = await supabase
      .from("employee")
      .insert({
        labor_code: row.labor_code,
        display_name: row.display_name,
        thai_name: row.thai_name,
        employee_type: row.employee_type,
        craft_code: row.craft_code,
        skill_level_code: row.skill_level_code,
        effective_from: row.timesheet_date,
        is_current: true,
        created_from_batch_id: row.batch_id,
      })
      .select("employee_id")
      .single();

    if (error) return null;
    return inserted.employee_id as string;
  }

  const craftOrSkillChanged =
    current.craft_code !== row.craft_code || current.skill_level_code !== row.skill_level_code;

  if (!craftOrSkillChanged) {
    return current.employee_id as string;
  }

  // Close the old version, open a new one — history preserved for
  // historical labor_confirmation rows to link against (Architecture
  // v3.0 §H rule 8).
  await supabase
    .from("employee")
    .update({ is_current: false, effective_to: row.timesheet_date })
    .eq("employee_id", current.employee_id);

  const { data: newVersion, error } = await supabase
    .from("employee")
    .insert({
      labor_code: row.labor_code,
      display_name: row.display_name,
      thai_name: row.thai_name,
      employee_type: row.employee_type,
      craft_code: row.craft_code,
      skill_level_code: row.skill_level_code,
      effective_from: row.timesheet_date,
      is_current: true,
      created_from_batch_id: row.batch_id,
    })
    .select("employee_id")
    .single();

  if (error) return null;
  return newVersion.employee_id as string;
}

async function upsertWorkOrder(supabase: SupabaseClient, row: MappedStagingRow): Promise<void> {
  await supabase.from("work_order").upsert(
    {
      wonum: row.wonum,
      description: row.description,
      work_type: row.work_type,
      wo_ref_type: row.wo_ref_type,
      jpnum: row.jpnum,
      assetnum: row.assetnum,
      location: row.location,
      work_close_date: row.work_close_date,
      is_shutdown_turnaround: row.wo_ref_type !== null && row.wo_ref_type !== "NORMAL",
      is_emergency: row.emer_plant !== null && row.emer_plant !== "",
    },
    { onConflict: "wonum" }
  );
}
