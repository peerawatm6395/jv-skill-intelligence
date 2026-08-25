/**
 * Synthetic demo data generator (Architecture v3.0 — "seed/demo data
 * for testing UI without real employee data").
 *
 * Generates FICTIONAL employees, work orders, and labor confirmations
 * using the same schema and the same verified formulas as production,
 * then runs the KPI Engine over them so every dashboard page has
 * something real to render. None of the names, IDs, or figures here
 * correspond to any real person or company — labor codes start at
 * 900000 (well outside any real range) and names are generated from a
 * fixed fictional name list.
 *
 * Usage: npm run seed  (requires .env.local with a Supabase project
 * already migrated via `supabase/migrations/*.sql` and seeded via
 * `supabase/seed.sql`)
 */
import { createClient } from "@supabase/supabase-js";
import {
  computeLineCost,
  computeProfit,
  computeValuePerHour,
  computeFactorHrs,
} from "../lib/calc-engine/formulas";
import { percentileRank, computePeerDistributionStats } from "../lib/calc-engine/benchmark-engine";
import {
  computeSkillDimensionScore,
  computeOverallRating,
} from "../lib/calc-engine/layer1-skill-intelligence";
import { aggregatePerformanceEvidence } from "../lib/calc-engine/layer2-performance-evidence";
import { aggregateLaborAnalytics } from "../lib/calc-engine/layer3-labor-analytics";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in your environment. " +
      "Copy .env.example to .env.local, fill in your Supabase project values, and re-run."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const FICTIONAL_FIRST_NAMES = [
  "Anong", "Boonmee", "Chai", "Dara", "Ekasit", "Farida", "Grit", "Hansa",
  "Isara", "Jinda", "Kamon", "Ladda", "Manop", "Niran", "Orapin", "Pichai",
];
const FICTIONAL_LAST_NAMES = [
  "Suksawat", "Charoen", "Wattana", "Rungrueang", "Thongdee", "Prasert",
  "Kanchana", "Somboon", "Piyawat", "Chaiyaporn",
];

const CRAFTS = [
  { code: "AAH-MECH", name: "Mechanical" },
  { code: "AAH-ELEC", name: "Electrical" },
  { code: "AAH-AUTO", name: "Automation" },
  { code: "AAH-SPEC", name: "Specialist" },
];
const SKILL_LEVELS = ["LV1", "LV2", "LV3"];
const FACTOR_BY_LEVEL: Record<string, number> = { LV1: 1, LV2: 1.5, LV3: 2 };
const WORK_TYPES = ["CM", "PM", "IN", "BD"];
const CALC_ENGINE_VERSION = "demo-seed-v1";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function main() {
  console.log("Seeding synthetic demo data (no real employee/JV data)...");

  // ---- Org units ----
  const { data: org } = await supabase
    .from("org_unit")
    .upsert(
      { company: "DEMO", plant: "DEMO-PLANT-1", subplant: null, team: "Demo Maintenance Team" },
      { onConflict: "company,plant,subplant,team" }
    )
    .select()
    .single();

  // ---- Employees (30 synthetic) ----
  const employees: { employee_id: string; craft_code: string; skill_level_code: string }[] = [];
  for (let i = 0; i < 30; i++) {
    const craft = pick(CRAFTS);
    const skillLevel = pick(SKILL_LEVELS);
    const laborCode = 900000 + i;

    const { data: existing } = await supabase
      .from("employee")
      .select("employee_id")
      .eq("labor_code", laborCode)
      .eq("is_current", true)
      .maybeSingle();

    if (existing) {
      employees.push({ employee_id: existing.employee_id, craft_code: craft.code, skill_level_code: skillLevel });
      continue;
    }

    const { data: inserted, error } = await supabase
      .from("employee")
      .insert({
        labor_code: laborCode,
        display_name: `${pick(FICTIONAL_FIRST_NAMES)} ${pick(FICTIONAL_LAST_NAMES)} (Demo)`,
        craft_code: craft.code,
        skill_level_code: skillLevel,
        org_id: org?.org_id ?? null,
        effective_from: "2026-01-01",
        is_current: true,
      })
      .select("employee_id")
      .single();

    if (error) {
      console.error("Failed to insert demo employee:", error.message);
      continue;
    }
    employees.push({ employee_id: inserted.employee_id, craft_code: craft.code, skill_level_code: skillLevel });
  }
  console.log(`Upserted ${employees.length} synthetic employees.`);

  // ---- Work orders (60 synthetic) ----
  const workOrders: { wonum: number; work_type: string }[] = [];
  for (let i = 0; i < 60; i++) {
    const wonum = 990000000 + i;
    const workType = pick(WORK_TYPES);
    await supabase.from("work_order").upsert(
      {
        wonum,
        description: "Demo work order (synthetic)",
        work_type: workType,
        wo_ref_type: "NORMAL",
        jpnum: "CM01",
        is_shutdown_turnaround: false,
        is_emergency: Math.random() < 0.1,
      },
      { onConflict: "wonum" }
    );
    workOrders.push({ wonum, work_type: workType });
  }
  console.log(`Upserted ${workOrders.length} synthetic work orders.`);

  // ---- Labor confirmations (using the SAME verified formulas as production) ----
  const { data: batch } = await supabase
    .from("data_import_batch")
    .insert({
      source_filename: "demo-seed-synthetic-data.xlsx",
      uploaded_by_user_id: (await getOrCreateSystemUserId()),
      storage_object_path: "demo/synthetic",
      status: "IMPORTED",
      period_covered: "2026-01",
      row_count_imported: 0,
    })
    .select()
    .single();

  let insertedCount = 0;
  const periodKey = "2026-01";

  for (const emp of employees) {
    const numRecords = Math.floor(randomBetween(8, 20));
    for (let r = 0; r < numRecords; r++) {
      const wo = pick(workOrders);
      const payRate = Math.floor(randomBetween(100, 250));
      const totalHrs = Math.round(randomBetween(2, 10) * 100) / 100;
      const factorWeight = FACTOR_BY_LEVEL[emp.skill_level_code] ?? 1;
      const factorHrs = computeFactorHrs(factorWeight, totalHrs);
      const employeeJobValue = Math.floor(randomBetween(1500, 8000));
      const lineCost = computeLineCost(payRate, totalHrs);
      const profit = computeProfit(employeeJobValue, lineCost);
      const valuePerHour = computeValuePerHour(employeeJobValue, totalHrs);

      const { error } = await supabase.from("labor_confirmation").insert({
        wonum: wo.wonum,
        employee_id: emp.employee_id,
        timesheet_date: `2026-01-${String(Math.floor(randomBetween(1, 28))).padStart(2, "0")}`,
        regular_hrs: totalHrs,
        ot_hrs: 0,
        total_hrs: totalHrs,
        pay_rate: payRate,
        factor_weight: factorWeight,
        line_cost: lineCost,
        ratio_share: 1,
        wo_job_value: employeeJobValue,
        employee_job_value: employeeJobValue,
        profit,
        value_per_hour: valuePerHour,
        data_quality_flag: "USE",
        source_year: 2026,
        import_batch_id: batch!.batch_id,
      });

      if (!error) insertedCount++;
      void factorHrs; // computed for parity with production pipeline; ratio_share fixed at 1 for single-labor demo WOs
    }
  }
  console.log(`Inserted ${insertedCount} synthetic labor_confirmation rows.`);

  await supabase
    .from("data_import_batch")
    .update({ row_count_imported: insertedCount })
    .eq("batch_id", batch!.batch_id);

  // ---- Run the KPI Engine over the synthetic data (Layer 2 -> Layer 1 -> Layer 3) ----
  await runKpiEngineForDemoData(employees, periodKey);

  console.log("Demo data seed complete.");
}

async function getOrCreateSystemUserId(): Promise<string> {
  // For local/demo use only: the service-role client bypasses auth, so we
  // just need any valid app_user_profile row to satisfy the FK. In a real
  // deployment, uploaded_by_user_id always comes from an authenticated session.
  const { data: existing } = await supabase.from("app_user_profile").select("user_id").limit(1).maybeSingle();
  if (existing) return existing.user_id;
  throw new Error(
    "No app_user_profile exists yet. Create at least one Supabase Auth user and a matching " +
      "app_user_profile row (role=ADMIN) before running the demo seed script."
  );
}

async function runKpiEngineForDemoData(
  employees: { employee_id: string; craft_code: string; skill_level_code: string }[],
  periodKey: string
) {
  console.log("Running KPI Engine (Layer 2 -> Layer 1 -> Layer 3) over demo data...");

  const { data: activeWeightProfile } = await supabase
    .from("weight_profile")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();

  const weightProfileId =
    activeWeightProfile?.weight_profile_id ??
    (
      await supabase
        .from("weight_profile")
        .insert({
          profile_name: "Demo default weights",
          approved_by: "demo-seed-script",
          approved_at: new Date().toISOString(),
          weights_json: {
            SKILL_DIM_PRODUCTIVITY: 0.2,
            SKILL_DIM_COST_EFFICIENCY: 0.2,
            SKILL_DIM_PM: 0.15,
            SKILL_DIM_CM: 0.15,
            SKILL_DIM_TECHNICAL: 0.1,
            SKILL_DIM_BREADTH: 0.2,
          },
          is_active: true,
        })
        .select()
        .single()
    ).data!.weight_profile_id;

  // Layer 2: aggregate performance evidence per employee, per craft peer group
  const perfByEmployee = new Map<string, ReturnType<typeof aggregatePerformanceEvidence>>();
  const peerGroups = new Map<string, { employeeId: string; valuePerHour: number }[]>();

  for (const emp of employees) {
    const { data: rows } = await supabase
      .from("v_labor_confirmation_safe")
      .select("total_hrs, line_cost, employee_job_value, value_per_hour")
      .eq("employee_id", emp.employee_id);

    if (!rows || rows.length === 0) continue;

    const evidenceRecords = rows.map((r) => ({
      employeeId: emp.employee_id,
      totalHrs: r.total_hrs,
      lineCost: r.line_cost,
      employeeJobValue: r.employee_job_value,
      maintenanceClass: "REACTIVE" as const,
      isEmergency: false,
      complexityConfidence: "LOW_COVERAGE" as const,
      assetnum: null,
      workType: "CM",
      plant: "DEMO-PLANT-1",
    }));

    const evidence = aggregatePerformanceEvidence(emp.employee_id, evidenceRecords);
    perfByEmployee.set(emp.employee_id, evidence);

    const peerKey = `${emp.craft_code}|${emp.skill_level_code}`;
    if (!peerGroups.has(peerKey)) peerGroups.set(peerKey, []);
    if (evidence.valuePerHourRaw !== null) {
      peerGroups.get(peerKey)!.push({ employeeId: emp.employee_id, valuePerHour: evidence.valuePerHourRaw });
    }

    await supabase.from("kpi_result").upsert(
      {
        employee_id: emp.employee_id,
        kpi_code: "PERF_PRODUCTIVITY_ADJ",
        period_type: "MONTH",
        period_key: periodKey,
        value: evidence.valuePerHourRaw,
        record_count: evidence.recordCount,
        complexity_coverage_pct: evidence.complexityCoveragePct,
        calc_engine_version: CALC_ENGINE_VERSION,
      },
      { onConflict: "employee_id,org_id,kpi_code,period_type,period_key,weight_profile_id" }
    );
  }

  // Peer benchmark stats per (craft, skill_level)
  for (const [peerKey, values] of peerGroups) {
    const [craftCode, skillLevelCode] = peerKey.split("|");
    const stats = computePeerDistributionStats(values.map((v) => v.valuePerHour));
    if (!stats) continue; // below MIN_PEER_GROUP_SAMPLE_SIZE — honestly skipped, not fabricated

    await supabase.from("peer_benchmark").upsert(
      {
        craft_code: craftCode,
        skill_level_code: skillLevelCode,
        period_type: "MONTH",
        period_key: periodKey,
        kpi_code: "PERF_PRODUCTIVITY_ADJ",
        p10: stats.p10, p25: stats.p25, p50: stats.p50, p75: stats.p75, p90: stats.p90,
        mean: stats.mean, median: stats.median, mad: stats.mad, sample_size: stats.sampleSize,
      },
      { onConflict: "craft_code,skill_level_code,complexity_tier,maintenance_class,is_shutdown_turnaround,is_emergency,period_type,period_key,kpi_code" }
    );
  }

  // Layer 1: percentile-rank each employee, then blend (SYSTEM_EVIDENCE_ONLY —
  // no human_validation exists for demo data, exactly matching the honest
  // launch state described in Blueprint v2.0).
  for (const emp of employees) {
    const evidence = perfByEmployee.get(emp.employee_id);
    if (!evidence || evidence.valuePerHourRaw === null) continue;

    const peerValues = (peerGroups.get(`${emp.craft_code}|${emp.skill_level_code}`) ?? []).map((v) => v.valuePerHour);
    const percentile = percentileRank(evidence.valuePerHourRaw, peerValues);

    const dimensionResult = computeSkillDimensionScore({
      performanceEvidencePercentile: percentile,
      humanValidation: null,
      humanValidationBlendWeight: null,
      recordCount: evidence.recordCount,
      totalHours: evidence.totalHours,
      complexityConfidence: "LOW_COVERAGE",
      isComplexitySensitiveDimension: true,
    });

    await supabase.from("kpi_result").upsert(
      {
        employee_id: emp.employee_id,
        kpi_code: "SKILL_DIM_PRODUCTIVITY",
        period_type: "MONTH",
        period_key: periodKey,
        score_0_100: dimensionResult.score0To100,
        evidence_type: dimensionResult.evidenceType,
        confidence_level: dimensionResult.confidenceLevel,
        weight_profile_id: weightProfileId,
        calc_engine_version: CALC_ENGINE_VERSION,
      },
      { onConflict: "employee_id,org_id,kpi_code,period_type,period_key,weight_profile_id" }
    );

    const overall = computeOverallRating({
      dimensionScores: [
        {
          dimensionKpiCode: "SKILL_DIM_PRODUCTIVITY",
          score: dimensionResult.score0To100,
          evidenceType: dimensionResult.evidenceType,
          confidenceLevel: dimensionResult.confidenceLevel,
        },
      ],
      weights: { SKILL_DIM_PRODUCTIVITY: 1 },
    });

    await supabase.from("kpi_result").upsert(
      {
        employee_id: emp.employee_id,
        kpi_code: "SKILL_OVERALL",
        period_type: "MONTH",
        period_key: periodKey,
        score_0_100: overall.overallScore,
        evidence_type: overall.overallEvidenceType,
        confidence_level: overall.overallConfidenceLevel,
        weight_profile_id: weightProfileId,
        calc_engine_version: CALC_ENGINE_VERSION,
      },
      { onConflict: "employee_id,org_id,kpi_code,period_type,period_key,weight_profile_id" }
    );
  }

  // Layer 3: labor analytics (independent of skill scoring, by design)
  for (const emp of employees) {
    const { data: rows } = await supabase
      .from("v_labor_confirmation_safe")
      .select("total_hrs, ot_hrs, ot1_hrs, ot1_5_hrs, ot2_hrs, ot3_hrs")
      .eq("employee_id", emp.employee_id);

    if (!rows || rows.length === 0) continue;

    const analytics = aggregateLaborAnalytics(
      rows.map((r) => ({
        totalHrs: r.total_hrs,
        otHrs: r.ot_hrs,
        ot1Hrs: r.ot1_hrs,
        ot15Hrs: r.ot1_5_hrs,
        ot2Hrs: r.ot2_hrs,
        ot3Hrs: r.ot3_hrs,
        isEmergency: false,
        maintenanceClass: "REACTIVE",
      }))
    );

    await supabase.from("kpi_result").upsert(
      {
        employee_id: emp.employee_id,
        kpi_code: "LABOR_OT_RATIO",
        period_type: "MONTH",
        period_key: periodKey,
        value: analytics.otRatio,
        calc_engine_version: CALC_ENGINE_VERSION,
      },
      { onConflict: "employee_id,org_id,kpi_code,period_type,period_key,weight_profile_id" }
    );
  }

  console.log("KPI Engine run complete for demo data.");
}

main().catch((err) => {
  console.error("Demo seed failed:", err);
  process.exit(1);
});
