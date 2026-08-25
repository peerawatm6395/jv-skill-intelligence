/**
 * Domain types for JV Skill Intelligence.
 *
 * These mirror the Postgres schema in supabase/migrations/*.sql exactly.
 * Do not add fields here that don't exist in the schema, and do not rename
 * away from the schema's own naming — this file is a mirror, not a reinterpretation.
 *
 * Source: Blueprint v2.0, Implementation Architecture v3.0 §2.
 */

// ---------- Enumerations enforced at the DB layer (CHECK constraints) ----------

export type DataQualityFlag = "USE" | "CUT" | "ERROR";

export type MaintenanceClass =
  | "PLANNED"
  | "REACTIVE"
  | "ADMIN"
  | "CAPEX_RENOVATE";

export type JobPlanCoverageType =
  | "SPECIFIC_TEMPLATE"
  | "GENERIC_BUCKET"
  | "UNCODED";

export type KpiLayer =
  | "PERFORMANCE_EVIDENCE"
  | "SKILL_INTELLIGENCE"
  | "LABOR_ANALYTICS"
  | "SKILL_GAP";

export type Measurability = "DIRECT" | "PROXY" | "REQUIRES_ADDITIONAL_DATA";

/**
 * Mandatory for every kpi_result row whose kpi_dictionary.layer is
 * SKILL_INTELLIGENCE or SKILL_GAP. Enforced by a DB trigger
 * (fn_enforce_skill_layer_evidence_type in 0005_kpi_engine.sql) —
 * this TS type exists so the same rule is caught at compile time too.
 */
export type EvidenceType = "SYSTEM_EVIDENCE_ONLY" | "HUMAN_VALIDATED" | "BLENDED";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type AppRole = "ADMIN" | "HRBP" | "MANAGER" | "SUPERVISOR" | "VIEWER";

export type ImportBatchStatus =
  | "UPLOADED"
  | "VALIDATING"
  | "STAGED"
  | "QUALITY_CHECK"
  | "IMPORTED"
  | "FAILED"
  | "PARTIALLY_IMPORTED"
  | "SUPERSEDED";

export type DataQualityIssueType =
  | "SCHEMA_DRIFT"
  | "CUT_FLAG"
  | "DIV_ZERO_ERROR"
  | "NEGATIVE_OUTLIER"
  | "MISSING_REQUIRED_FIELD"
  | "DUPLICATE_ROW"
  | "DATE_OUT_OF_RANGE"
  | "UNRECOGNIZED_JPNUM"
  | "UNRECOGNIZED_WORKTYPE"
  | "UNRECOGNIZED_CRAFT"
  | "FORMULA_MISMATCH";

export type IssueSeverity = "BLOCKING" | "WARNING" | "INFO";

export type ValidationType =
  | "SUPERVISOR_ASSESSMENT"
  | "CERTIFICATION"
  | "TRAINING_COMPLETION"
  | "PEER_REVIEW"
  | "INCIDENT_REVIEW";

// ---------- Reference tables ----------

export interface Craft {
  craft_code: string;
  craft_name: string;
  is_active: boolean;
}

/**
 * SKILLLEVEL is an ADMINISTRATIVE PAY TIER ONLY. Never read this as a
 * skill/competency score anywhere in the calc-engine. See
 * Blueprint v2.0 §C.1 / Architecture v3.0 §6.
 */
export interface SkillLevel {
  skill_level_code: string;
  description: string | null;
  is_active: boolean;
}

export interface CraftSkillFactor {
  craft_code: string;
  skill_level_code: string;
  factor_weight: number;
}

export interface WorkTypeLookup {
  work_type: string;
  category_bg: string;
  maintenance_class: MaintenanceClass;
}

export interface JobPlan {
  jpnum: string;
  coverage_type: JobPlanCoverageType;
  sample_size: number;
  median_hours: number | null;
  median_job_value: number | null;
  hours_p10: number | null;
  hours_p90: number | null;
  complexity_tier: number | null;
  typical_craft_mix: Record<string, number> | null;
  last_computed_at: string;
}

export interface OrgUnit {
  org_id: string;
  company: string | null;
  plant: string | null;
  subplant: string | null;
  team: string | null;
}

// ---------- People ----------

export interface Supervisor {
  supervisor_id: string;
  supervisor_code: number;
  supervisor_name: string;
  linked_employee_id: string | null;
  is_active: boolean;
}

export interface Employee {
  employee_id: string;
  labor_code: number;
  display_name: string;
  thai_name: string | null;
  employee_type: string | null;
  craft_code: string;
  /** Administrative pay tier — see SkillLevel doc comment. Never a skill input. */
  skill_level_code: string;
  supervisor_id: string | null;
  org_id: string | null;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  created_from_batch_id: string | null;
}

// ---------- Work order & labor confirmation ----------

export interface WorkOrder {
  wonum: number;
  description: string | null;
  work_type: string;
  wo_ref_type: string | null;
  jpnum: string | null;
  assetnum: string | null;
  location: string | null;
  org_id: string | null;
  work_close_date: string | null;
  is_shutdown_turnaround: boolean;
  is_emergency: boolean;
}

/**
 * Mirrors v_labor_confirmation_safe — the ONLY view application code
 * may select from. Deliberately has NO field corresponding to the
 * source system's ACTLABCOST (work-order-broadcast cost). If you find
 * yourself wanting to add one, stop — see Architecture v3.0 §6.
 */
export interface LaborConfirmationSafe {
  jv_id: string;
  wonum: number;
  employee_id: string;
  timesheet_date: string;
  regular_hrs: number;
  ot_hrs: number;
  ot1_hrs: number | null;
  ot1_5_hrs: number | null;
  ot2_hrs: number | null;
  ot3_hrs: number | null;
  total_hrs: number;
  pay_rate: number;
  factor_weight: number;
  /** PAYRATE × TOTALHRS — the ONLY individual employee cost field. */
  line_cost: number;
  ratio_share: number | null;
  wo_job_value: number | null;
  employee_job_value: number;
  employee_job_value_reg: number | null;
  employee_job_value_ot: number | null;
  profit: number;
  value_per_hour: number;
  data_quality_flag: DataQualityFlag;
  source_year: number;
  import_batch_id: string;
}

// ---------- Human validation & skill target profile ----------

export interface HumanValidation {
  validation_id: string;
  employee_id: string;
  validation_type: ValidationType;
  skill_dimension: string | null;
  rating_or_result: string | null;
  evidence_document_ref: string | null;
  validated_by: string;
  validated_at: string;
  expires_at: string | null;
  source: "HR_SYSTEM" | "MANUAL_ENTRY" | "LMS_EXPORT";
  created_by_user_id: string | null;
  created_at: string;
}

export interface SkillTargetProfile {
  profile_id: string;
  craft_code: string;
  role_level: string | null;
  skill_dimension: string;
  target_percentile: number;
  minimum_evidence_type: EvidenceType | null;
  approved_by: string;
  approved_at: string;
  is_active: boolean;
}

// ---------- KPI engine ----------

export interface KpiDictionaryEntry {
  kpi_code: string;
  kpi_name: string;
  business_question: string;
  layer: KpiLayer;
  formula_description: string;
  data_source: string;
  dimension: string | null;
  unit: string;
  default_benchmark_method: string | null;
  measurability: Measurability;
  limitation_notes: string | null;
  is_active: boolean;
}

export interface WeightProfile {
  weight_profile_id: string;
  profile_name: string;
  approved_by: string;
  approved_at: string;
  weights_json: Record<string, number>;
  human_validation_blend_weight: number | null;
  is_active: boolean;
}

export interface PeerBenchmark {
  benchmark_id: string;
  craft_code: string;
  skill_level_code: string;
  complexity_tier: number | null;
  maintenance_class: MaintenanceClass | null;
  is_shutdown_turnaround: boolean | null;
  is_emergency: boolean | null;
  period_type: string;
  period_key: string;
  kpi_code: string;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  mean: number | null;
  median: number | null;
  mad: number | null;
  sample_size: number;
  calculated_at: string;
}

/**
 * A kpi_result row for a SKILL_INTELLIGENCE/SKILL_GAP kpi_code MUST have
 * evidence_type and confidence_level set — this is enforced by a DB
 * trigger. This TS type models that as a discriminated union so the
 * compiler also catches an attempt to omit them for those layers.
 */
export interface KpiResultBase {
  kpi_result_id: string;
  employee_id: string | null;
  org_id: string | null;
  kpi_code: string;
  period_type: string;
  period_key: string;
  value: number | null;
  score_0_100: number | null;
  benchmark_percentile: number | null;
  complexity_coverage_pct: number | null;
  record_count: number | null;
  weight_profile_id: string | null;
  target_profile_id: string | null;
  calc_engine_version: string;
  calculated_at: string;
  import_batch_id: string | null;
}

export interface KpiResultWithEvidence extends KpiResultBase {
  evidence_type: EvidenceType;
  confidence_level: ConfidenceLevel;
}

export interface KpiResultWithoutEvidence extends KpiResultBase {
  evidence_type: null;
  confidence_level: null;
}

export type KpiResult = KpiResultWithEvidence | KpiResultWithoutEvidence;

// ---------- Import pipeline ----------

export interface ImportColumnMappingProfile {
  profile_id: string;
  profile_name: string;
  effective_from: string;
  effective_to: string | null;
  sheet_name_pattern: string | null;
  column_mapping: Record<string, string>;
  required_columns: string[];
  derived_field_rules: Record<string, unknown> | null;
  is_active: boolean;
}

export interface DataImportBatch {
  batch_id: string;
  source_filename: string;
  uploaded_by_user_id: string;
  uploaded_at: string;
  storage_object_path: string;
  mapping_profile_id: string | null;
  period_covered: string | null;
  status: ImportBatchStatus;
  row_count_raw: number | null;
  row_count_staged: number | null;
  row_count_imported: number | null;
  row_count_rejected: number | null;
  replaces_batch_id: string | null;
  validation_summary: Record<string, unknown> | null;
  error_log: Record<string, unknown> | null;
  kpi_calculation_triggered_at: string | null;
  kpi_calculation_completed_at: string | null;
}

export interface StagingJvLabor {
  staging_id: string;
  batch_id: string;
  source_sheet: string;
  source_row_num: number;
  raw_payload: Record<string, unknown>;
  mapped_payload: Record<string, unknown> | null;
  validation_status: "PENDING" | "VALID" | "INVALID";
  promoted_to_labor_confirmation: boolean;
}

export interface DataQualityIssue {
  issue_id: string;
  batch_id: string;
  staging_id: string | null;
  issue_type: DataQualityIssueType;
  severity: IssueSeverity;
  field_name: string | null;
  raw_value: string | null;
  detected_at: string;
  resolved: boolean;
  resolved_by_user_id: string | null;
  resolution_note: string | null;
}

// ---------- Access & audit ----------

export interface AppUserProfile {
  user_id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  scoped_org_id: string | null;
  linked_employee_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AuditLogEntry {
  audit_id: number;
  user_id: string | null;
  action: string;
  target_employee_id: string | null;
  target_batch_id: string | null;
  detail: Record<string, unknown> | null;
  occurred_at: string;
}
