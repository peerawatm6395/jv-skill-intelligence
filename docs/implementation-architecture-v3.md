# JV Skill Intelligence — Implementation Architecture v3.0
**Base: Blueprint v2.0 (approved in principle).** This document turns v2.0 into a buildable system: concrete DB schema, Excel import pipeline, dashboard page specs, KPI Engine table, RBAC, repo structure, and a phased roadmap.

**Status: DRAFT FOR REVIEW. No application code and no dashboard UI have been built.** Per your instruction, this stops here and waits for your approval before implementation begins.

**Rule carried forward unchanged from v2.0, and now enforced at the schema/API level, not just in prose:** no KPI formula in §5 is new — every formula is copied from Blueprint v2.0 §D. Where this document adds a field ("Business Question," "Dimension," "Filter," "Unit"), that is presentation metadata for the dashboard, not a new calculation.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  GitHub  (peerawatm6395/jv-skill-intelligence)                            │
│  Source code only — no Excel files, no .env, no employee data (§9)         │
└───────────────────────────┬──────────────────────────────────────────────┘
                             │ CI/CD (GitHub Actions → Vercel)
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Vercel (Next.js 15 + TypeScript, App Router)                              │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │ Dashboard UI   │  │ API Route Handlers │  │ Scheduled Jobs (Vercel Cron) │  │
│  │ (read-only vs   │  │ (typed, RBAC-       │  │ - KPI recalculation           │  │
│  │  KPI tables)     │  │  scoped, never       │  │ - Peer benchmark refresh      │  │
│  │                  │  │  computes scores)     │  │ - Complexity dim refresh       │  │
│  └──────────────┘  └──────────────────┘  └────────────────────────────┘  │
└───────────────────────────┬──────────────────────────────────────────────┘
                             │ Supabase client (service role for server-side,
                             │ anon key + RLS for any client-side reads)
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Supabase                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │ PostgreSQL DB  │  │ Storage buckets    │  │ Auth (email/SSO)              │  │
│  │ (schema §2)     │  │ - raw-uploads       │  │ users → app_user_profile      │  │
│  │ Row-Level        │  │   (.xlsx originals,  │  │ (role: ADMIN/HRBP/MANAGER/     │  │
│  │ Security (§8)    │  │   retained for audit)│  │  SUPERVISOR/VIEWER)             │  │
│  └──────────────┘  └──────────────────┘  └────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Edge Function / Postgres Function: Excel Import Pipeline (§3)         │  │
│  │ staging_jv_labor → validate → data_quality_issue → labor_confirmation  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

**Why Supabase specifically (not just "a Postgres somewhere"):**
- **Storage** holds the original monthly `.xlsx` files (audit trail — "what exactly was uploaded") separately from parsed data, without needing a separate file-hosting service.
- **Auth** gives the 5 roles (§8) a managed identity provider with no custom auth code to maintain.
- **Row-Level Security (RLS)** enforces the RBAC scoping (a Manager's queries physically cannot return another team's rows) at the database layer, so it holds even if an API route has a bug — defense in depth, not just an `if` statement in the route handler.
- **Postgres functions / triggers** can run the deterministic parts of the KPI Engine (aggregation, percentile calculation) close to the data, reducing what has to round-trip through a serverless function with a time limit.

**Monthly-upload-without-code-changes principle** (central to this whole document, detailed in §3): every part of the pipeline that could otherwise require a code change when a new month's file arrives with a slightly different shape (as 2026 already did — dropping `TYPE_BG`, adding `EMPLOYEETYPE`) is instead driven by **data** — a configurable column-mapping profile stored in the database — not by editing TypeScript.

---

## 2. Database Schema

Implementation-level schema, consistent with Blueprint v2.0's conceptual model, normalized into the specific tables you asked for. UUID primary keys (Supabase convention) unless a natural key is clearly better.

### 2.1 Reference / Lookup tables

```sql
CREATE TABLE craft (
  craft_code        TEXT PRIMARY KEY,             -- e.g. 'AAH-MECH'
  craft_name        TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE skill_level (
  skill_level_code  TEXT PRIMARY KEY,             -- 'LV1'..'LV4'
  description        TEXT,
  -- COMMENT enforced: this table is an HR PAY TIER, not a competency measure.
  is_active          BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE skill_level IS
  'Administrative pay/weighting tier only (verified deterministic driver of factor_weight in craft_skill_factor). MUST NEVER be read as a skill/competency score by any KPI or Skill Intelligence calculation. See Blueprint v2.0 §C.1.';

CREATE TABLE craft_skill_factor (
  craft_code        TEXT NOT NULL REFERENCES craft(craft_code),
  skill_level_code  TEXT NOT NULL REFERENCES skill_level(skill_level_code),
  factor_weight      NUMERIC(4,2) NOT NULL,        -- verified deterministic pay-weighting factor
  PRIMARY KEY (craft_code, skill_level_code)
);

CREATE TABLE work_type_lookup (
  work_type          TEXT PRIMARY KEY,              -- CM, PM, IN, BD, ADM, RVM, RVG, CPM, PDM, CPO
  category_bg         TEXT NOT NULL,                 -- crosswalked TYPE_BG label
  maintenance_class     TEXT NOT NULL                 -- 'PLANNED'|'REACTIVE'|'ADMIN'|'CAPEX_RENOVATE'
);

CREATE TABLE job_plan (                              -- dim_job_complexity from v2.0 §B.2
  jpnum               TEXT PRIMARY KEY,
  coverage_type         TEXT NOT NULL,                -- 'SPECIFIC_TEMPLATE'|'GENERIC_BUCKET'|'UNCODED'
  sample_size            INTEGER NOT NULL DEFAULT 0,
  median_hours            NUMERIC(8,2),
  median_job_value          NUMERIC(12,2),
  hours_p10                 NUMERIC(8,2),
  hours_p90                  NUMERIC(8,2),
  complexity_tier              SMALLINT,               -- 1-5, NULL if coverage_type != 'SPECIFIC_TEMPLATE'
  typical_craft_mix              JSONB,
  last_computed_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_unit (
  org_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company              TEXT,
  plant                 TEXT,
  subplant                TEXT,
  team                     TEXT,
  UNIQUE (company, plant, subplant, team)
);
```

### 2.2 People

```sql
CREATE TABLE supervisor (
  supervisor_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_code        BIGINT NOT NULL,             -- source SUPERVISOR code
  supervisor_name          TEXT NOT NULL,               -- source SUP_NAME
  linked_employee_id         UUID,                       -- nullable FK to employee.employee_id if the
                                                          -- supervisor is also tracked as an employee
                                                          -- (added as FK once employee table below exists)
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (supervisor_code)
);

CREATE TABLE employee (                                -- SCD Type 2
  employee_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  labor_code              BIGINT NOT NULL,               -- natural key, source LABORCODE
  display_name             TEXT NOT NULL,
  thai_name                  TEXT,
  employee_type               TEXT,                       -- 'M'|'D', 2026+ only
  craft_code                   TEXT NOT NULL REFERENCES craft(craft_code),
  skill_level_code               TEXT NOT NULL REFERENCES skill_level(skill_level_code),
  supervisor_id                   UUID REFERENCES supervisor(supervisor_id),
  org_id                            UUID REFERENCES org_unit(org_id),
  effective_from                     DATE NOT NULL,
  effective_to                        DATE,               -- NULL = current version
  is_current                           BOOLEAN NOT NULL DEFAULT TRUE,
  created_from_batch_id                  UUID,             -- FK to data_import_batch, added after §2.5
  UNIQUE (labor_code, effective_from)
);
CREATE INDEX idx_employee_current ON employee (labor_code) WHERE is_current;
CREATE INDEX idx_employee_craft_skill ON employee (craft_code, skill_level_code) WHERE is_current;

ALTER TABLE supervisor
  ADD CONSTRAINT fk_supervisor_employee
  FOREIGN KEY (linked_employee_id) REFERENCES employee(employee_id);
```

### 2.3 Work Order & Labor Confirmation (the JV fact, normalized)

```sql
CREATE TABLE work_order (
  wonum                 BIGINT PRIMARY KEY,             -- source WONUM
  description             TEXT,
  work_type                 TEXT NOT NULL REFERENCES work_type_lookup(work_type),
  wo_ref_type                 TEXT,                        -- NORMAL/MSD/ANSD/FSD/WWSD/CAPEX
  jpnum                         TEXT REFERENCES job_plan(jpnum),
  assetnum                       TEXT,
  location                        TEXT,
  org_id                            UUID REFERENCES org_unit(org_id),
  work_close_date                    DATE,
  is_shutdown_turnaround                BOOLEAN NOT NULL DEFAULT FALSE,  -- wo_ref_type != 'NORMAL'
  is_emergency                            BOOLEAN NOT NULL DEFAULT FALSE   -- EMER_PLANT not null
);

CREATE TABLE labor_confirmation (                        -- the conformed jv_labor_fact from v2.0, one row
  jv_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- per labor line
  wonum                      BIGINT NOT NULL REFERENCES work_order(wonum),
  employee_id                  UUID NOT NULL REFERENCES employee(employee_id),  -- SCD2 version active
                                                                                  -- ON timesheet_date
  timesheet_date                  DATE NOT NULL,
  regular_hrs                       NUMERIC(8,4) NOT NULL,
  ot_hrs                              NUMERIC(8,4) NOT NULL,
  ot1_hrs NUMERIC(8,4), ot1_5_hrs NUMERIC(8,4), ot2_hrs NUMERIC(8,4), ot3_hrs NUMERIC(8,4),
  total_hrs                             NUMERIC(8,4) NOT NULL,
  pay_rate                                NUMERIC(10,2) NOT NULL,
  factor_weight                            NUMERIC(4,2) NOT NULL,
  line_cost                                 NUMERIC(14,2) NOT NULL,       -- PAYRATE × TOTALHRS, verified,
                                                                            -- THE ONLY individual cost field
  ratio_share                                 NUMERIC(6,4),                -- FACTORHRS / ΣFACTORHRS on the WO
  wo_job_value                                  NUMERIC(14,2),             -- AMOUNTINCOME, WO-level total
  employee_job_value                              NUMERIC(14,2) NOT NULL,  -- JOBVALUE, individual distributed
  employee_job_value_reg                             NUMERIC(14,2),
  employee_job_value_ot                                NUMERIC(14,2),
  profit                                                 NUMERIC(14,2) NOT NULL, -- employee_job_value − line_cost
  value_per_hour                                           NUMERIC(12,2) NOT NULL, -- employee_job_value / total_hrs
  data_quality_flag                                          TEXT NOT NULL, -- 'USE'|'CUT'|'ERROR'
  source_year                                                  SMALLINT NOT NULL,
  import_batch_id                                                UUID NOT NULL REFERENCES data_import_batch(batch_id),
  raw_staging_ref                                                  UUID,     -- lineage back to staging_jv_labor row
  loaded_at                                                          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_labor_conf_emp_date ON labor_confirmation (employee_id, timesheet_date);
CREATE INDEX idx_labor_conf_wonum ON labor_confirmation (wonum);
CREATE INDEX idx_labor_conf_quality ON labor_confirmation (data_quality_flag);
CREATE INDEX idx_labor_conf_batch ON labor_confirmation (import_batch_id);
-- Partition candidate: BY RANGE (timesheet_date) once volume grows past a few million rows.

-- NOTE — ACTLABCOST (source): intentionally NOT a column in labor_confirmation.
-- It is a work-order-level total broadcast across every labor line in the source export
-- (verified in Blueprint v1/v2 analysis) and must never be read as a per-employee cost.
-- It is retained only inside staging_jv_labor / raw archive for lineage, and is explicitly
-- excluded by the safe view below so application code cannot select it even by accident.
CREATE VIEW v_labor_confirmation_safe AS
  SELECT jv_id, wonum, employee_id, timesheet_date, regular_hrs, ot_hrs, ot1_hrs, ot1_5_hrs,
         ot2_hrs, ot3_hrs, total_hrs, pay_rate, factor_weight, line_cost, ratio_share,
         wo_job_value, employee_job_value, employee_job_value_reg, employee_job_value_ot,
         profit, value_per_hour, data_quality_flag, source_year, import_batch_id
  FROM labor_confirmation
  WHERE data_quality_flag = 'USE';
-- API routes and the KPI Engine read ONLY from this view, never from labor_confirmation directly.
```

### 2.4 Human Validation & Skill Target Profile

```sql
CREATE TABLE human_validation (
  validation_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                UUID NOT NULL REFERENCES employee(employee_id),
  validation_type              TEXT NOT NULL,        -- 'SUPERVISOR_ASSESSMENT'|'CERTIFICATION'|
                                                       -- 'TRAINING_COMPLETION'|'PEER_REVIEW'|'INCIDENT_REVIEW'
  skill_dimension                 TEXT,                -- FK-like reference to kpi_dictionary.kpi_code
                                                       -- where layer='SKILL_INTELLIGENCE', nullable if general
  rating_or_result                   TEXT,
  evidence_document_ref                 TEXT,          -- pointer to Supabase Storage object, not raw file in DB
  validated_by                            TEXT NOT NULL,
  validated_at                              DATE NOT NULL,
  expires_at                                  DATE,
  source                                        TEXT NOT NULL, -- 'HR_SYSTEM'|'MANUAL_ENTRY'|'LMS_EXPORT'
  created_by_user_id                              UUID REFERENCES app_user_profile(user_id),
  created_at                                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Ships EMPTY at launch (Blueprint v2.0 §B.4) — schema exists so evidence_type can become
-- BLENDED/HUMAN_VALIDATED the moment HRBP starts entering assessments; no migration needed.

CREATE TABLE skill_target_profile (
  profile_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  craft_code                   TEXT NOT NULL REFERENCES craft(craft_code),
  role_level                     TEXT,
  skill_dimension                  TEXT NOT NULL,      -- references kpi_dictionary.kpi_code
  target_percentile                  NUMERIC(5,2) NOT NULL,
  minimum_evidence_type                 TEXT,           -- e.g. some dimensions may require HUMAN_VALIDATED
  approved_by                              TEXT NOT NULL,
  approved_at                                TIMESTAMPTZ NOT NULL,
  is_active                                    BOOLEAN NOT NULL DEFAULT FALSE
);
-- Also EMPTY at launch — Layer 4 runs in "Relative Standing" mode until HRBP populates this
-- (Blueprint v2.0 §F / §J item 2).
```

### 2.5 KPI Engine output & metadata

```sql
CREATE TABLE kpi_dictionary (                          -- machine-readable §5 KPI Dictionary
  kpi_code                  TEXT PRIMARY KEY,            -- e.g. 'PERF_PRODUCTIVITY_ADJ'
  kpi_name                    TEXT NOT NULL,
  business_question              TEXT NOT NULL,
  layer                            TEXT NOT NULL,          -- 'PERFORMANCE_EVIDENCE'|'SKILL_INTELLIGENCE'|
                                                            -- 'LABOR_ANALYTICS'|'SKILL_GAP'
  formula_description                 TEXT NOT NULL,        -- human-readable, mirrors Blueprint v2.0 §D exactly
  data_source                            TEXT NOT NULL,
  dimension                                TEXT,             -- grouping axis, e.g. 'Craft × Skill Level × Complexity Tier'
  unit                                       TEXT NOT NULL,   -- 'THB/hour', 'ratio', '0-100 score', '%', 'hours'
  default_benchmark_method                    TEXT,
  measurability                                 TEXT NOT NULL, -- 'DIRECT'|'PROXY'|'REQUIRES_ADDITIONAL_DATA'
  limitation_notes                                TEXT,
  is_active                                         BOOLEAN NOT NULL DEFAULT TRUE
);
-- Seeded directly from Blueprint v2.0 §D.1-D.4 (see §5 of this document for the full seed list).
-- New KPIs are added by inserting a row here + implementing the calc function — the dashboard
-- reads KPI metadata (name, question, unit, limitation text) from this table dynamically, so
-- UI copy never has to be hardcoded per KPI.

CREATE TABLE peer_benchmark (
  benchmark_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  craft_code                     TEXT NOT NULL REFERENCES craft(craft_code),
  skill_level_code                  TEXT NOT NULL REFERENCES skill_level(skill_level_code),
  complexity_tier                      SMALLINT,           -- NULL when using Tier-B coarse grouping
  maintenance_class                       TEXT,             -- populated when complexity_tier IS NULL (Tier-B)
  is_shutdown_turnaround                     BOOLEAN,
  is_emergency                                  BOOLEAN,
  period_type                                     TEXT NOT NULL,
  period_key                                        TEXT NOT NULL,
  kpi_code                                            TEXT NOT NULL REFERENCES kpi_dictionary(kpi_code),
  p10 NUMERIC, p25 NUMERIC, p50 NUMERIC, p75 NUMERIC, p90 NUMERIC,
  mean NUMERIC, median NUMERIC, mad NUMERIC,
  sample_size                                            INTEGER NOT NULL,
  calculated_at                                            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kpi_result (                               -- unified store for Layers 2, 1, 3, 4 outputs
  kpi_result_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                    UUID REFERENCES employee(employee_id),      -- NULL for team/org-level rows
  org_id                            UUID REFERENCES org_unit(org_id),         -- NULL for individual rows
  kpi_code                            TEXT NOT NULL REFERENCES kpi_dictionary(kpi_code),
  period_type                            TEXT NOT NULL,
  period_key                                TEXT NOT NULL,
  value                                        NUMERIC(14,4),
  score_0_100                                    NUMERIC(5,2),                -- populated for normalized/score KPIs
  benchmark_percentile                              NUMERIC(5,2),
  evidence_type                                       TEXT,                    -- 'SYSTEM_EVIDENCE_ONLY'|
                                                                                -- 'HUMAN_VALIDATED'|'BLENDED'
                                                                                -- REQUIRED (NOT NULL) for layer=
                                                                                -- 'SKILL_INTELLIGENCE' or 'SKILL_GAP'
  confidence_level                                       TEXT,                  -- 'HIGH'|'MEDIUM'|'LOW'
                                                                                -- REQUIRED for the same layers
  complexity_coverage_pct                                   NUMERIC(5,2),
  record_count                                                INTEGER,
  weight_profile_id                                             UUID REFERENCES weight_profile(weight_profile_id),
  target_profile_id                                               UUID REFERENCES skill_target_profile(profile_id),
  calc_engine_version                                               TEXT NOT NULL,
  calculated_at                                                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  import_batch_id                                                       UUID REFERENCES data_import_batch(batch_id),
  UNIQUE (employee_id, org_id, kpi_code, period_type, period_key, weight_profile_id)
);
CREATE INDEX idx_kpi_result_employee_period ON kpi_result (employee_id, period_type, period_key);
CREATE INDEX idx_kpi_result_kpi_code ON kpi_result (kpi_code);

-- Schema-level enforcement of the evidence-type rule (Blueprint v2.0 §H rule 11):
ALTER TABLE kpi_result ADD CONSTRAINT chk_skill_layer_requires_evidence_type
  CHECK (
    (SELECT layer FROM kpi_dictionary WHERE kpi_dictionary.kpi_code = kpi_result.kpi_code)
      NOT IN ('SKILL_INTELLIGENCE','SKILL_GAP')
    OR (evidence_type IS NOT NULL AND confidence_level IS NOT NULL)
  );
-- (Implemented as a trigger in practice, since subqueries in CHECK constraints aren't
-- supported directly in Postgres — noted here to specify the intended guarantee; the actual
-- migration will use a BEFORE INSERT/UPDATE trigger function enforcing the same rule.)

CREATE TABLE weight_profile (
  weight_profile_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name                  TEXT NOT NULL,
  approved_by                     TEXT NOT NULL,
  approved_at                       TIMESTAMPTZ NOT NULL,
  weights_json                        JSONB NOT NULL,
  human_validation_blend_weight          NUMERIC(4,2),   -- §J item 4 — NULL until HRBP decides
  is_active                                BOOLEAN NOT NULL DEFAULT FALSE
);
```

### 2.6 Excel Import Pipeline tables

```sql
CREATE TABLE import_column_mapping_profile (             -- the mechanism that avoids code changes (§3)
  profile_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name                  TEXT NOT NULL,             -- e.g. 'JV Export 2026+'
  effective_from                   DATE NOT NULL,
  effective_to                       DATE,
  sheet_name_pattern                    TEXT,               -- regex/glob, e.g. 'JV%'
  column_mapping                          JSONB NOT NULL,    -- {"LABORCODE":"labor_code", "CRAFT":"craft_code", ...}
  required_columns                          JSONB NOT NULL,  -- columns that MUST be present or the batch is rejected
  derived_field_rules                          JSONB,        -- e.g. rule to derive category_bg from
                                                              -- work_type+wo_ref_type when TYPE_BG column is absent
                                                              -- (exactly the 2026 schema-drift case)
  is_active                                       BOOLEAN NOT NULL DEFAULT TRUE
);
-- Seeded at launch with (at least) two profiles matching the observed 2024/2025 shape and
-- the 2026 shape. A future month with a different shape gets a NEW ROW here, not a code change.

CREATE TABLE data_import_batch (
  batch_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename                 TEXT NOT NULL,
  uploaded_by_user_id                UUID NOT NULL REFERENCES app_user_profile(user_id),
  uploaded_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  storage_object_path                     TEXT NOT NULL,     -- Supabase Storage path to the original .xlsx
  mapping_profile_id                         UUID REFERENCES import_column_mapping_profile(profile_id),
  period_covered                                TEXT,          -- e.g. '2026-07' — the month this batch represents
  status                                          TEXT NOT NULL, -- 'UPLOADED'|'VALIDATING'|'STAGED'|
                                                                  -- 'QUALITY_CHECK'|'IMPORTED'|'FAILED'|
                                                                  -- 'PARTIALLY_IMPORTED'|'SUPERSEDED'
  row_count_raw                                     INTEGER,
  row_count_staged                                    INTEGER,
  row_count_imported                                    INTEGER,
  row_count_rejected                                       INTEGER,
  replaces_batch_id                                          UUID REFERENCES data_import_batch(batch_id),
                                                              -- set when this batch corrects a prior one
  validation_summary                                            JSONB,
  error_log                                                       JSONB,
  kpi_calculation_triggered_at                                       TIMESTAMPTZ,
  kpi_calculation_completed_at                                         TIMESTAMPTZ
);

CREATE TABLE staging_jv_labor (                            -- landing area, wide/JSONB, pre-validation
  staging_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                      UUID NOT NULL REFERENCES data_import_batch(batch_id),
  source_sheet                     TEXT NOT NULL,
  source_row_num                      INTEGER NOT NULL,
  raw_payload                            JSONB NOT NULL,      -- every original column, untouched
  mapped_payload                            JSONB,             -- after column_mapping applied
  validation_status                            TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING'|'VALID'|'INVALID'
  promoted_to_labor_confirmation                  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_staging_batch ON staging_jv_labor (batch_id, validation_status);

CREATE TABLE data_quality_issue (
  issue_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                       UUID NOT NULL REFERENCES data_import_batch(batch_id),
  staging_id                        UUID REFERENCES staging_jv_labor(staging_id),
  issue_type                           TEXT NOT NULL,        -- 'SCHEMA_DRIFT'|'CUT_FLAG'|'DIV_ZERO_ERROR'|
                                                              -- 'NEGATIVE_OUTLIER'|'MISSING_REQUIRED_FIELD'|
                                                              -- 'DUPLICATE_ROW'|'DATE_OUT_OF_RANGE'|
                                                              -- 'UNRECOGNIZED_JPNUM'|'UNRECOGNIZED_WORKTYPE'|
                                                              -- 'UNRECOGNIZED_CRAFT'|'FORMULA_MISMATCH'
                                                              -- ('FORMULA_MISMATCH' = the loaded row's
                                                              -- line_cost/profit/value_per_hour don't match
                                                              -- the verified formulas from Blueprint v1/v2 —
                                                              -- a strong signal of a corrupted or hand-edited
                                                              -- source row)
  severity                                TEXT NOT NULL,       -- 'BLOCKING'|'WARNING'|'INFO'
  field_name                                 TEXT,
  raw_value                                     TEXT,
  detected_at                                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved                                          BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by_user_id                                  UUID REFERENCES app_user_profile(user_id),
  resolution_note                                        TEXT
);
CREATE INDEX idx_dqi_batch ON data_quality_issue (batch_id, severity, resolved);
```

### 2.7 Access & Audit

```sql
CREATE TABLE app_user_profile (                            -- extends Supabase auth.users
  user_id                    UUID PRIMARY KEY REFERENCES auth.users(id),
  email                         TEXT NOT NULL,
  full_name                       TEXT,
  role                               TEXT NOT NULL,          -- 'ADMIN'|'HRBP'|'MANAGER'|'SUPERVISOR'|'VIEWER'
  scoped_org_id                        UUID REFERENCES org_unit(org_id),  -- for MANAGER/SUPERVISOR scoping
  linked_employee_id                      UUID REFERENCES employee(employee_id),  -- for SUPERVISOR/VIEWER
                                                                                    -- self-service scoping
  is_active                                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  audit_id                   BIGSERIAL PRIMARY KEY,
  user_id                       UUID REFERENCES app_user_profile(user_id),
  action                           TEXT NOT NULL,            -- 'VIEW_EMPLOYEE_CARD'|'EXPORT'|'AI_QUERY'|
                                                              -- 'UPLOAD_BATCH'|'RESOLVE_QUALITY_ISSUE'|
                                                              -- 'APPROVE_WEIGHT_PROFILE'|'CONFIRM_SKILL_GAP'|...
  target_employee_id               UUID,
  target_batch_id                     UUID,
  detail                                 JSONB,
  occurred_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.8 Entity Relationship summary

```
craft ─┬─< craft_skill_factor >─┬─ skill_level
       │                        │
       └─< employee (SCD2) >────┘── supervisor
                │        \
                │         \── org_unit
                │
                ├──< labor_confirmation >── work_order ── work_type_lookup
                │           │                    └── job_plan
                │           └── import_batch (data_import_batch)
                │
                ├──< human_validation
                │
                ├──< kpi_result >── kpi_dictionary
                │           └── weight_profile
                │           └── skill_target_profile
                │
                └──< skill_target_profile (via craft_code)

data_import_batch ──< staging_jv_labor ──< data_quality_issue
data_import_batch ──< import_column_mapping_profile (referenced, not owned)

app_user_profile ──< audit_log
app_user_profile ──< data_import_batch (uploaded_by)
```

---

## 3. Excel Import System

### 3.1 Flow

```
┌─────────┐   ┌────────┐   ┌───────────┐   ┌────────┐   ┌──────────────┐   ┌────────┐   ┌───────────┐   ┌───────────┐
│  Excel   │──▶│ Upload  │──▶│ Validate   │──▶│ Staging │──▶│ Data Quality  │──▶│ Import  │──▶│ KPI Calc   │──▶│ Dashboard  │
│ (.xlsx)  │   │         │   │            │   │         │   │ Check          │   │         │   │            │   │            │
└─────────┘   └────────┘   └───────────┘   └────────┘   └──────────────┘   └────────┘   └───────────┘   └───────────┘
```

**Step-by-step:**

1. **Upload** (`ADMIN`/`HRBP` role only, §8)
   - User selects the monthly `.xlsx` on the `/admin/import` page, picks/confirms the applicable `import_column_mapping_profile` (auto-suggested by filename/sheet pattern, overridable).
   - File is written to Supabase Storage bucket `raw-uploads/{year}/{filename}` — the original file is preserved untouched, forever, for audit.
   - `data_import_batch` row created, `status='UPLOADED'`.

2. **Validate**
   - A server-side job (Vercel API route or Supabase Edge Function, triggered on upload) parses the workbook using the selected `column_mapping_profile`.
   - Checks: all `required_columns` present in each sheet → if not, `status='FAILED'` with a clear error listing exactly which expected columns are missing (this is how the 2026 missing-`TYPE_BG` case would be caught immediately rather than silently producing wrong KPIs).
   - Basic type/shape checks (dates parse, numeric fields numeric, no fully-blank required cells).
   - `status='VALIDATING'` → on pass, proceed; on failure, batch stops here and is visible in `/admin/import-history` with the exact issue.

3. **Staging**
   - Every row is written to `staging_jv_labor` with both `raw_payload` (untouched) and `mapped_payload` (after applying `column_mapping` + `derived_field_rules` — e.g., deriving `category_bg`/`maintenance_class` from `work_type`+`wo_ref_type` when the source has no `TYPE_BG` column, exactly the rule needed for 2026-shaped files).
   - `status='STAGED'`.

4. **Data Quality Check** (business rules from Blueprint v2.0 §H, applied here — not new rules)
   - `ตัด != 'Use'` rows → flagged `CUT_FLAG`, excluded from promotion to `labor_confirmation` (kept in staging for lineage).
   - Recompute `line_cost = pay_rate × total_hrs`, `profit = employee_job_value − line_cost`, `value_per_hour = employee_job_value / total_hrs` and compare to the source-provided figures (where present) — a mismatch beyond a small rounding tolerance raises `FORMULA_MISMATCH` (`WARNING`, reviewable) rather than silently trusting a possibly hand-edited source cell.
   - Duplicate detection: same `(wonum, labor_code, timesheet_date, source_row content hash)` already imported in a prior batch → flagged `DUPLICATE_ROW`.
   - Unrecognized `craft`, `work_type`, or `jpnum` codes not yet in the lookup tables → flagged `UNRECOGNIZED_*` (`WARNING`, auto-created as a new lookup row pending review, so a brand-new craft code next year doesn't require a code change — just an admin confirming the auto-created row).
   - Outlier detection: extreme single-row values (following the same p1/p99-class logic used for benchmarking) flagged `NEGATIVE_OUTLIER`/`INFO` for visibility, not auto-excluded (real loss-making jobs must be kept — only `CUT_FLAG` rows are excluded).
   - Every issue written to `data_quality_issue`; `BLOCKING` severity issues (e.g., a required field genuinely missing on a row with no way to derive it) prevent that row's promotion; `WARNING`/`INFO` issues are surfaced in `/data-quality` but don't block the batch.
   - `status='QUALITY_CHECK'` complete.

5. **Import**
   - Rows without `BLOCKING` issues are promoted from `staging_jv_labor` into `work_order` (upsert), `employee` (upsert with SCD2 logic — if `craft_code`/`skill_level_code` differ from the current version, the old version gets `effective_to` set and a new version is inserted), and `labor_confirmation`.
   - `staging_jv_labor.promoted_to_labor_confirmation = TRUE` per row.
   - **Correction/re-upload handling:** if this batch's `replaces_batch_id` is set, the prior batch's `labor_confirmation` rows (via `import_batch_id`) are excluded from active queries (soft-marked, not deleted — audit trail preserved) and the new batch's rows become authoritative for that `period_covered`.
   - `status='IMPORTED'` (or `'PARTIALLY_IMPORTED'` if some rows were blocked).

6. **KPI Calculation** (automatic trigger on successful import, also manually re-runnable)
   - Runs the KPI Engine (§5) for the affected `period_key`(s): refreshes `job_plan` complexity stats, `peer_benchmark`, and all `kpi_result` rows for Layers 2/1/3/4 for employees/periods touched by this batch.
   - `data_import_batch.kpi_calculation_completed_at` set on completion.

7. **Dashboard**
   - All dashboard pages read exclusively from `kpi_result`, `peer_benchmark`, `v_labor_confirmation_safe`, and `data_quality_issue` — never from `staging_jv_labor` or raw Storage files.

### 3.2 How this supports "upload new data every month with no source-code change"

- New month, same shape → select the existing `import_column_mapping_profile`, upload, done.
- New month, slightly different shape (a column renamed, added, or dropped — as already happened between 2025 and 2026) → an ADMIN adds a **new row** to `import_column_mapping_profile` (via `/admin/import-mapping`, a data-entry screen, not a deploy) with the updated `column_mapping`/`required_columns`/`derived_field_rules`, then uploads against that profile. No TypeScript changes, no redeploy.
- New craft/work-type/job-plan code appears → auto-created as a pending lookup row during Data Quality Check, reviewed by an ADMIN in `/admin/data-quality`, not a schema migration.
- The one thing that **does** require engineering involvement: a genuinely new *category* of column that doesn't map to any existing conformed field (e.g., a wholly new metric type). That's a real schema change and is out of scope for "no code change" by definition — flagged so expectations are correct.

---

## 4. Dashboard Pages

Page-level specification only (no UI code/mockups yet, per your instruction). For each: purpose, primary data source, key sections, roles with access.

| # | Page | Purpose | Data source | Key sections | Roles |
|---|---|---|---|---|---|
| 1 | **Executive Dashboard** (`/`) | Org-wide health at a glance for leadership | `kpi_result` (org-level rows), `data_import_batch` | Headcount & craft mix; org-wide Performance Evidence trend; Labor cost summary; data freshness ("last import: 2026-07, X days ago"); Skill Intelligence coverage (% of employees with BLENDED vs SYSTEM_EVIDENCE_ONLY) | ADMIN, HRBP |
| 2 | **Skill Intelligence** (`/skill-intelligence`) | Org/craft-level Layer 1 view | `kpi_result` (layer=SKILL_INTELLIGENCE) | Skill matrix heatmap by craft × dimension; evidence-type coverage breakdown; confidence-level distribution; drill-down to Employee Profile | ADMIN, HRBP, MANAGER (scoped) |
| 3 | **Employee Profile** (`/employees/[id]`) | Individual player card | `kpi_result`, `human_validation`, `employee` | Overall Rating + 9 dimension cards, each tagged evidence_type/confidence; Radar chart; recent WO evidence; link to Skill Gap | ADMIN, HRBP, MANAGER (own scope), SUPERVISOR (own team), VIEWER (self only) |
| 4 | **Performance Evidence** (`/performance-evidence/[id]`) | Layer 2 detail — the "show your work" page | `kpi_result` (layer=PERFORMANCE_EVIDENCE), `v_labor_confirmation_safe`, `peer_benchmark`, `job_plan` | Raw vs. complexity-adjusted value/hour; complexity_coverage_pct; peer group definition used; drill-down list of contributing WOs | ADMIN, HRBP, MANAGER, SUPERVISOR (own team) |
| 5 | **Productivity / Labor Analytics** (`/labor-analytics`) | Layer 3 — workload/scheduling, explicitly not a skill page | `kpi_result` (layer=LABOR_ANALYTICS) | OT ratio & tier mix by team/plant; emergency-hours share; planned-vs-reactive mix; headcount coverage | ADMIN, HRBP, MANAGER, SUPERVISOR |
| 6 | **Skill Gap & Development** (`/employees/[id]/gap`, `/gap-review-queue`) | Layer 4 | `kpi_result` (layer=SKILL_GAP), `skill_target_profile`, `human_validation` | Relative Standing (if no active target profile) or Gap-to-Target; review queue for SUPERVISOR/HRBP to Confirm/Adjust/Dismiss; AI-generated development narrative | ADMIN, HRBP, MANAGER, SUPERVISOR (review own team's queue) |
| 7 | **Supervisor / Team Analysis** (`/teams/[org_id]`) | Team rollups for people managers | `kpi_result` (org-level), `fact_labor_analytics_period` equivalents | Team skill matrix; team OT/workload; team skill-gap summary; roster | MANAGER, SUPERVISOR (own team), HRBP |
| 8 | **Labor Cost** (`/labor-cost`) | Cost-focused view, explicitly labeled operational not skill | `v_labor_confirmation_safe` aggregates, `kpi_result` (Cost Efficiency KPIs) | Total labor cost by team/plant/period; cost efficiency ratio trend; **explicit note that individual comparisons use `line_cost`, never the WO-broadcast field** | ADMIN, HRBP |
| 9 | **Trend Analysis** (`/trend`) | Historical view across all layers | `kpi_result` time series | Selectable KPI + entity (employee/team/org); peer-median overlay; confidence shading for low-evidence periods; explicit gap markers for periods with no qualifying data | ADMIN, HRBP, MANAGER |
| 10 | **Data Quality** (`/data-quality`) | Operational trust page | `data_quality_issue`, `data_import_batch` | Open issues by severity/type; unrecognized-code review queue; excluded-row counts (CUT_FLAG) trend; complexity coverage trend (Tier A vs Tier B share over time) | ADMIN |
| 11 | **Excel Upload / Import History** (`/admin/import`, `/admin/import-history`) | The pipeline UI itself | `data_import_batch`, `import_column_mapping_profile`, `staging_jv_labor` | Upload form; batch status timeline (Upload→Validate→Stage→QC→Import→Calc); per-batch row counts and error log; mapping-profile management | ADMIN |
| 12 | **KPI Dictionary** (`/kpi-dictionary`) | Self-service methodology transparency | `kpi_dictionary` | Every KPI's Name/Business Question/Formula/Data Source/Benchmark/Evidence Type/Measurability/Limitation, rendered directly from the table (§5) — this page requires zero hardcoded copy | All roles (read-only) |

---

## 5. KPI Engine — KPI Dictionary (seed content for `kpi_dictionary`)

**Every formula below is copied unchanged from Blueprint v2.0 §D.** No new KPI formula has been introduced in this document.

### Layer 2 — Performance Evidence

**KPI: Complexity-Adjusted Productivity** (`kpi_code = PERF_PRODUCTIVITY_ADJ`)
- Business Question: "How much value did this employee generate per hour, relative to peers doing comparably complex work?"
- Data Source: `v_labor_confirmation_safe.employee_job_value`, `.total_hrs`; `job_plan` for complexity tier
- Formula: `Σ employee_job_value / Σ total_hrs`, percentile-ranked within peer group
- Dimension: Craft × Skill Level × Complexity Tier (Tier A) or × Maintenance Class/Shutdown/Emergency flags (Tier B)
- Filter: `data_quality_flag='USE'`; period range
- Unit: THB/hour (raw); 0–100 percentile score (normalized)
- Benchmark: peer group percentile, winsorized p1/p99, min sample size 5
- Confidence/Evidence Type: Performance Evidence layer — feeds Layer 1 as `SYSTEM_EVIDENCE_ONLY` unless blended
- Measurability: 🟢 DIRECT (Tier A) / 🟡 PROXY-QUALITY (Tier B, ~88–93% of rows — see Blueprint v2.0 §C.2)
- Limitation: reflects value generated, not technique; complexity normalization is coarse for the ~90% generic-job-plan (`CM01`-class) majority

**KPI: Work / Cost Efficiency Evidence** (`kpi_code = PERF_COST_EFFICIENCY`)
- Business Question: "How much value did this employee generate per baht of labor cost?"
- Data Source: `v_labor_confirmation_safe.employee_job_value`, `.line_cost` (never the WO-broadcast field)
- Formula: `Σ employee_job_value / Σ line_cost`
- Dimension: same as PERF_PRODUCTIVITY_ADJ
- Filter: `data_quality_flag='USE'`
- Unit: ratio (THB value / THB cost); 0–100 percentile
- Benchmark: same peer group method
- Confidence/Evidence Type: Performance Evidence, feeds Layer 1
- Measurability: 🟢 DIRECT
- Limitation: mechanically correlated with PERF_PRODUCTIVITY_ADJ (shared numerator) — documented, not hidden

**KPI: PM Value Evidence** (`kpi_code = PERF_PM_VALUE`)
- Business Question: "How efficiently does this employee generate value on planned/preventive work?"
- Data Source: `v_labor_confirmation_safe` filtered `maintenance_class='PLANNED'`
- Formula: `Σ employee_job_value(PLANNED) / Σ total_hrs(PLANNED)`
- Dimension: Craft × Skill Level × Complexity Tier, PLANNED work only
- Filter: `maintenance_class='PLANNED'`, `data_quality_flag='USE'`
- Unit: THB/hour; 0–100 percentile
- Benchmark: peer group percentile within PLANNED work
- Confidence/Evidence Type: Performance Evidence
- Measurability: 🟢 DIRECT (value ratio) — 🔴 on-time PM completion rate is REQUIRES_ADDITIONAL_DATA, not computed by this KPI
- Limitation: says nothing about schedule adherence; `PMNUM` fill rate only 6.4%, no PM due-date table exists

**KPI: CM Value Evidence** (`kpi_code = PERF_CM_VALUE`)
- Business Question: "How efficiently does this employee generate value on corrective/reactive work?"
- Data Source/Formula/Dimension/Filter/Unit/Benchmark: mirrors PERF_PM_VALUE for `maintenance_class='REACTIVE'`
- Confidence/Evidence Type: Performance Evidence
- Measurability: 🟢 DIRECT (value ratio) — 🔴 diagnostic accuracy/rework rate is REQUIRES_ADDITIONAL_DATA
- Limitation: reactive-work severity not controlled for beyond coarse flags; no reopen/callback field exists

**KPI: Technical Range Evidence** (`kpi_code = PERF_TECHNICAL_RANGE`)
- Business Question: "How broad and value-efficient is this employee's exposure to diagnostically harder (reactive) work?"
- Data Source: PERF_CM_VALUE + distinct-count aggregates (`distinct assets/work-types`) + `is_emergency` participation rate
- Formula: composite percentile of (reactive-work value efficiency) + (distinct asset/work-type breadth) + (emergency participation rate)
- Dimension: Craft
- Filter: `data_quality_flag='USE'`
- Unit: 0–100 percentile
- Benchmark: percentile within craft
- Confidence/Evidence Type: Performance Evidence — **explicitly labeled proxy in UI**
- Measurability: 🟡 PROXY — this is not a technical-skill measurement
- Limitation: no defect/rework/QA-pass field exists; do not present as certified competence (Blueprint v2.0 §D.1.5, §J item 5)

**KPI: Skill Breadth Evidence** (`kpi_code = PERF_BREADTH`)
- Business Question: "How diverse is this employee's work exposure this period?"
- Data Source: `v_labor_confirmation_safe` distinct-count aggregates
- Formula: percentile-ranked distinct counts (work_type, assetnum, plant), averaged
- Dimension: Craft
- Filter: `data_quality_flag='USE'`
- Unit: 0–100 percentile
- Benchmark: percentile within craft
- Confidence/Evidence Type: Performance Evidence
- Measurability: 🟢 DIRECT
- Limitation: driven partly by supervisor assignment decisions, not solely employee initiative

### Layer 1 — Skill Intelligence

**KPI: Skill Dimension Score** (`kpi_code = SKILL_DIM_<dimension>`, one row per dimension)
- Business Question: "What do we believe about this employee's capability on this dimension, and how confident are we?"
- Data Source: corresponding `PERF_*` KPI result + `human_validation` (if any)
- Formula: `SYSTEM_EVIDENCE_ONLY` → `score = performance_evidence_percentile`; `BLENDED` → `score = weight × validation_score + (1-weight) × performance_evidence_percentile` (weight from `weight_profile.human_validation_blend_weight`, pending HRBP decision, §J item 4)
- Dimension: per skill dimension (Productivity, Work Efficiency, PM, CM, Technical, Cost Efficiency, Profit/Hour, Breadth)
- Filter: active `weight_profile`
- Unit: 0–100 score
- Benchmark: inherited from Layer 2 peer group
- Confidence/Evidence Type: **mandatory field** — `SYSTEM_EVIDENCE_ONLY` | `HUMAN_VALIDATED` | `BLENDED`; confidence `HIGH`/`MEDIUM`/`LOW` per Blueprint v2.0 §E step 8
- Measurability: depends on dimension (see corresponding Layer 2 KPI)
- Limitation: today, effectively all scores are `SYSTEM_EVIDENCE_ONLY` since `human_validation` is empty at launch — labeled "Indicator," not "Rating," in the UI until blended (Blueprint v2.0 §C.3)

**KPI: Overall Skill Rating** (`kpi_code = SKILL_OVERALL`)
- Business Question: "What's this employee's overall skill standing?"
- Data Source: all `SKILL_DIM_*` results for the period
- Formula: `Σ (weight_i × dimension_score_i)` via active `weight_profile.weights_json`
- Dimension: n/a (single composite)
- Filter: active `weight_profile`
- Unit: 0–100 score
- Benchmark: n/a (composite of already-benchmarked dimensions)
- Confidence/Evidence Type: set to the **weakest** contributing dimension's evidence_type/confidence — never averaged up
- Measurability: mechanically computable; **weights themselves are an open decision (§J item 10)**
- Limitation: only as trustworthy as its lowest-confidence input dimension

### Layer 3 — Labor Analytics (explicitly not Skill Intelligence)

**KPI: OT Ratio & Tier Mix** (`kpi_code = LABOR_OT_RATIO`)
- Business Question: "How much overtime is this employee/team working, and what kind?"
- Data Source: `v_labor_confirmation_safe` hour fields
- Formula: `Σ ot_hrs / Σ total_hrs`; OT1/1.5/2/3 tier shares
- Dimension: Craft/Team
- Filter: `data_quality_flag='USE'`
- Unit: % (ratio)
- Benchmark: peer percentile within craft/team, **descriptive only, no good/bad direction asserted**
- Confidence/Evidence Type: n/a — this is a Layer 3 metric, **not part of Skill Intelligence** (Blueprint v2.0 §D.3.1 rationale — moved out of "OT Management skill" entirely)
- Measurability: 🟢 DIRECT
- Limitation: high OT can mean responsiveness (positive) or overload (organizational) — direction must be interpreted with `is_emergency` context, not scored unilaterally

**KPI: Utilization / Coverage** (`kpi_code = LABOR_UTILIZATION`)
- Business Question: "How is work distributed across teams/plants — planned vs. reactive, emergency load?"
- Data Source: `v_labor_confirmation_safe` team/org aggregates
- Formula: hours logged vs. period; emergency-hours share; planned-vs-reactive mix
- Dimension: Team/Plant
- Filter: `data_quality_flag='USE'`
- Unit: hours, %
- Benchmark: team-to-team, plant-to-plant
- Confidence/Evidence Type: n/a — Layer 3
- Measurability: 🟡 PROXY — "available working days" not in source data; 🔴 true utilization vs. scheduled shifts REQUIRES an attendance/roster feed
- Limitation: approximated from logged-hours patterns only

### Layer 4 — Skill Gap

**KPI: Skill Gap Size** (`kpi_code = GAP_SIZE_<dimension>`)
- Business Question: "How far is this employee from the target standard for this dimension, and is that gap confirmed by a supervisor?"
- Data Source: `SKILL_DIM_*` result + `skill_target_profile`
- Formula: `max(0, target_percentile − current_score)`
- Dimension: per skill dimension × craft
- Filter: `skill_target_profile.is_active = TRUE`
- Unit: percentile points
- Benchmark: the HRBP-approved target itself
- Confidence/Evidence Type: carried through from the underlying `SKILL_DIM_*` result; `requires_human_review = TRUE` by default until a SUPERVISOR/HRBP confirms
- Measurability: 🔴 REQUIRES_ADDITIONAL_DATA — **`skill_target_profile` does not exist yet; this KPI cannot run in gap-to-target mode until HRBP populates it (§J item 2).** Until then, the page shows Relative Standing (percentile vs peers) instead.
- Limitation: a gap built on `SYSTEM_EVIDENCE_ONLY` is shown differently (visually) than one built on `BLENDED` evidence

---

## 6. Skill Intelligence — Enforcement Design

Restating the seven rules from your message, each mapped to a concrete implementation mechanism (not just documentation):

| Rule | Enforcement mechanism |
|---|---|
| `SKILLLEVEL` ไม่ใช่ Skill Score | `skill_level` table carries a `COMMENT` documenting this; no `kpi_dictionary` formula or calc function reads `employee.skill_level_code` as an input value — only as a `GROUP BY`/join key for peer grouping. Code review checklist item for any new KPI PR. |
| Labor Hours ไม่ใช่ Skill Score | No `kpi_code` with `layer='SKILL_INTELLIGENCE'` takes `total_hrs`/`regular_hrs`/`ot_hrs` as a direct formula input — hours only appear as a *denominator* inside Layer 2 ratio KPIs (value/hour, cost/hour), never as a standalone skill input. |
| Labor Cost ไม่ใช่ Skill Score | Same pattern — `line_cost` appears only as a denominator in efficiency ratios, never as a direct skill input. |
| `ACTLABCOST` ไม่ถูกใช้เป็น individual employee cost | The field **does not exist as a column in `labor_confirmation`** (§2.3) — it is architecturally absent from the conformed layer, not just renamed. `v_labor_confirmation_safe` (the only view the app reads) further guarantees no accidental exposure. |
| Performance Evidence ต้องแยกจาก Skill Intelligence | Enforced by `kpi_dictionary.layer` typing + the `kpi_result` schema's `CHECK`/trigger (§2.5) requiring `evidence_type`/`confidence_level` only for `SKILL_INTELLIGENCE`/`SKILL_GAP` rows — Performance Evidence rows are a structurally distinct `layer` value, and the UI (§4, pages 3 vs 4) renders them as separate pages with different visual language ("Indicator" vs "Evidence"). |
| Human Validation ต้องแสดง evidence type / confidence อย่างชัดเจน | `evidence_type` and `confidence_level` are `NOT NULL`-enforced (via trigger) for every `SKILL_INTELLIGENCE`/`SKILL_GAP` `kpi_result` row; the API response schema for these endpoints treats a missing evidence_type as a contract violation (500-level error, not a silently-omitted field); every dashboard card showing a Layer 1 or Layer 4 number is required (component-level convention, checked in code review) to render the evidence badge adjacent to the number, never the number alone. |

---

## 7. User Flow

```
1. Login
   → Supabase Auth (email/password or SSO) → app_user_profile.role determines landing page

2. Upload Excel  (ADMIN/HRBP only)
   → /admin/import → select mapping profile → upload .xlsx → Storage + data_import_batch created

3. Validate
   → automatic → required-column check → pass: proceed / fail: batch shown FAILED with reason,
     admin corrects mapping profile or source file and re-uploads

4. Import
   → automatic after Data Quality Check → staging rows promoted to work_order/employee/
     labor_confirmation → SCD2 employee versioning applied → correction/replace logic if
     replaces_batch_id set

5. Calculate
   → automatic trigger → KPI Engine runs for affected periods → job_plan/peer_benchmark
     refreshed → kpi_result rows written for Layers 2/1/3/(4 if targets active)

6. Dashboard
   → all roles land on their role-appropriate Executive/Team/Employee view, reading only
     from kpi_result and related read tables

7. Employee Profile
   → drill from Dashboard or Skill Matrix → Overall Rating + 9 dimension Indicators, each
     with evidence_type/confidence badge → drill further into Performance Evidence detail
     or Trend

8. Skill Gap
   → from Employee Profile → Relative Standing (no target profile yet) or Gap-to-Target
     (once HRBP defines skill_target_profile) → flagged "Pending supervisor review"

9. Development Recommendation
   → SUPERVISOR/HRBP reviews the gap in /gap-review-queue → Confirm/Adjust/Dismiss →
     only CONFIRMED gaps generate an AI-narrated development recommendation
     (/assistant, scoped to the reviewer's RBAC access) and become visible to the
     employee (VIEWER role) and eligible for Team Builder matching
```

---

## 8. Security

### 8.1 Roles

| Role | Scope | Can do |
|---|---|---|
| **ADMIN** | Org-wide | Everything: upload/manage imports, manage mapping profiles, resolve data quality issues, approve weight profiles & target skill profiles, manage users, view audit log |
| **HRBP** | Org-wide, read + governance | View all dashboards org-wide, approve `weight_profile`/`skill_target_profile`, confirm/adjust/dismiss skill gaps org-wide, export reports, cannot manage raw data import mechanics (mapping profiles) or user accounts |
| **MANAGER** | Own `org_unit` subtree | View Employee Profile/Performance Evidence/Skill Intelligence/Skill Gap/Labor Analytics for their scoped team(s) only; cannot approve org-wide weight/target profiles |
| **SUPERVISOR** | Own direct reports (via `employee.supervisor_id`) | View own team's Employee Profiles, review/confirm own team's items in `/gap-review-queue`, enter `human_validation` records for own team |
| **VIEWER** | Self only (`linked_employee_id`) | View own Employee Profile, own Skill Gap (once confirmed), own Trend — read-only, no comparison/team-builder access |

### 8.2 Enforcement

- **Supabase RLS policies** on every table with an `employee_id`/`org_id` column, keyed to `app_user_profile.role` + `scoped_org_id`/`linked_employee_id` — e.g., a `MANAGER`'s row-level policy on `kpi_result` restricts `SELECT` to rows where `employee_id` joins to an `employee.org_id` within their `scoped_org_id` subtree. This holds even if an API route has a bug, per §1.
- **API route RBAC checks** as a second layer (defense in depth) — every route handler re-validates the session role before querying, not relying on RLS alone.
- **Audit logging**: every card view, export, batch upload, quality-issue resolution, and gap confirmation writes an `audit_log` row.
- **PII minimization**: `thai_name`/`display_name` access logged; export functionality restricted to `ADMIN`/`HRBP`.
- **AI layer isolation**: `/api/ai/ask` assembles context only from data the requesting user's role already permits (same RLS/RBAC filter applied before the Claude API call), consistent with Blueprint v2.0.

---

## 9. GitHub Repository Structure

```
jv-skill-intelligence/
├── .github/
│   └── workflows/
│       ├── ci.yml                       # lint, typecheck, unit tests on PR
│       └── deploy.yml                   # Vercel deploy (or Vercel's native GitHub integration)
├── app/                                  # Next.js App Router
│   ├── (dashboard)/
│   │   ├── page.tsx                      # Executive Dashboard
│   │   ├── skill-intelligence/page.tsx
│   │   ├── employees/
│   │   │   ├── page.tsx                  # directory
│   │   │   └── [id]/
│   │   │       ├── page.tsx              # Employee Profile
│   │   │       ├── radar/page.tsx
│   │   │       ├── gap/page.tsx
│   │   │       └── trend/page.tsx
│   │   ├── performance-evidence/[id]/page.tsx
│   │   ├── labor-analytics/page.tsx
│   │   ├── labor-cost/page.tsx
│   │   ├── trend/page.tsx
│   │   ├── compare/page.tsx
│   │   ├── skill-matrix/page.tsx
│   │   ├── teams/[orgId]/page.tsx
│   │   ├── gap-review-queue/page.tsx
│   │   ├── data-quality/page.tsx
│   │   ├── kpi-dictionary/page.tsx
│   │   └── assistant/page.tsx
│   ├── admin/
│   │   ├── import/page.tsx
│   │   ├── import-history/page.tsx
│   │   ├── import-mapping/page.tsx
│   │   ├── weight-profiles/page.tsx
│   │   ├── target-skill-profiles/page.tsx
│   │   ├── users/page.tsx
│   │   └── audit-log/page.tsx
│   ├── api/
│   │   ├── employees/[id]/card/route.ts
│   │   ├── employees/[id]/radar/route.ts
│   │   ├── employees/[id]/trend/route.ts
│   │   ├── employees/compare/route.ts
│   │   ├── skill-matrix/route.ts
│   │   ├── skill-gap/[id]/route.ts
│   │   ├── team-builder/search/route.ts
│   │   ├── benchmarks/[craft]/[level]/route.ts
│   │   ├── kpi-dictionary/route.ts
│   │   ├── weight-profiles/route.ts
│   │   ├── ai/ask/route.ts
│   │   └── admin/
│   │       ├── import/upload/route.ts
│   │       ├── import/validate/route.ts
│   │       ├── import/promote/route.ts
│   │       ├── import/mapping-profiles/route.ts
│   │       └── audit-log/route.ts
│   └── layout.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts                     # browser client, anon key
│   │   ├── server.ts                     # server client, service role (server-only)
│   │   └── middleware.ts                 # session refresh
│   ├── auth/
│   │   ├── rbac.ts                        # role/scope helper functions
│   │   └── session.ts
│   ├── calc-engine/                        # KPI Engine — NOT invoked from API routes directly for scoring
│   │   ├── layer2-performance-evidence.ts
│   │   ├── layer1-skill-intelligence.ts
│   │   ├── layer3-labor-analytics.ts
│   │   ├── layer4-skill-gap.ts
│   │   ├── complexity-engine.ts             # dim_job_complexity / Tier A-B logic
│   │   ├── benchmark-engine.ts               # peer_benchmark percentile computation
│   │   └── __tests__/
│   │       ├── formulas.test.ts               # regression tests: verified LINECOST/PROFIT/RATIO
│   │       │                                  # relationships from Blueprint v1/v2 analysis
│   │       └── complexity-tiering.test.ts
│   ├── import/
│   │   ├── excel-parser.ts
│   │   ├── column-mapper.ts                    # applies import_column_mapping_profile
│   │   ├── validation-rules.ts
│   │   ├── quality-rules.ts                     # ตัด flag, formula-mismatch, outlier detection
│   │   └── promote-to-conformed.ts               # staging → work_order/employee/labor_confirmation
│   ├── kpi-dictionary/
│   │   └── seed-data.ts                            # seed content for kpi_dictionary (§5)
│   └── types/
│       └── db.ts                                    # generated Supabase TypeScript types
├── supabase/
│   ├── migrations/                                    # all DDL from §2, timestamped
│   ├── seed.sql                                        # kpi_dictionary, dim lookups, mapping profiles
│   └── config.toml
├── components/
│   ├── ui/                                              # shared design-system components
│   ├── evidence-badge.tsx                                # renders evidence_type/confidence — reused
│   │                                                     # everywhere per §6 enforcement
│   └── charts/
│       ├── radar-chart.tsx
│       ├── trend-chart.tsx
│       └── skill-matrix-heatmap.tsx
├── docs/
│   ├── blueprint-v1.md
│   ├── blueprint-v2.md
│   ├── implementation-architecture-v3.md            # this document
│   └── decision-log.md                                # running record of §10-equivalent approvals
├── scripts/
│   └── local-dev-seed.ts                               # synthetic (non-real) data for dev/staging
├── .env.example                                          # NEVER a real .env committed
├── .gitignore                                              # excludes *.xlsx, *.csv, .env*, /data
├── package.json
├── tsconfig.json
└── README.md
```

---

## 10. Implementation Roadmap

### Phase 1 — Foundation & Labor Analytics only
- Supabase project setup, schema migration (§2, minus `human_validation`/`skill_target_profile` content — tables created but empty), Auth + RBAC roles, RLS policies.
- Excel Import pipeline end-to-end (§3): Upload → Validate → Staging → Data Quality Check → Import, including `import_column_mapping_profile` seeded for the 2024/2025 and 2026 shapes.
- `data_quality_issue` and `/data-quality`, `/admin/import`, `/admin/import-history` pages.
- **Layer 3 (Labor Analytics) only** goes live for dashboards: `/labor-analytics`, `/labor-cost`, `/teams/[orgId]` (labor side).
- Rationale: this phase needs no HRBP decisions to be defensible — it's pure, disclosed operational analytics.

### Phase 2 — Performance Evidence (Layer 2)
- Complexity Engine (Tier A/B, §C.2): `job_plan` statistical refresh job, `peer_benchmark` computation.
- `kpi_result` population for all `PERF_*` KPIs (§5).
- `/performance-evidence/[id]`, `/kpi-dictionary` pages live.
- Everything shown with `complexity_coverage_pct` visible — no number presented without its confidence context.

### Phase 3 — Skill Intelligence (Layer 1, System-Evidence-Only) + Human Validation tooling
- `fact`/`kpi_result` population for `SKILL_DIM_*` and `SKILL_OVERALL`, all necessarily `evidence_type='SYSTEM_EVIDENCE_ONLY'` at first since `human_validation` starts empty.
- Ship the **data-entry UI for `human_validation`** (supervisor assessment forms, certification entry) — this phase is as much about building the collection tool as showing the output.
- `weight_profile` admin UI (§4 page 11-equivalent, `/admin/weight-profiles`) — first weight profile requires HRBP approval before activation (§J item 10).
- `/skill-intelligence`, `/employees/[id]` (full player card), `/employees/[id]/radar`, `/compare`, `/skill-matrix` go live, all rendering the evidence badge (§6) on every score.
- **Gate:** does not go live for real employee-facing use until `weight_profile` and the blend-weight decision (§J items 4, 10) have a first approved version.

### Phase 4 — Skill Gap & Development (Layer 4) + AI Assistant
- `/admin/target-skill-profiles` — HRBP defines `skill_target_profile` per craft/dimension (§J item 2, the hard blocker for this phase).
- Until target profiles exist, `/employees/[id]/gap` ships in **Relative Standing mode only** (can go live earlier, even Phase 2/3, as an interim honest state — noted here as the phase where the *full* gap-to-target feature completes).
- `/gap-review-queue`, `requires_human_review` workflow, `/team-builder`.
- `/assistant` (Claude AI layer) — reads only from completed Layer 1–4 `kpi_result` data, states which layer/evidence_type every claim rests on.
- `/admin/users`, `/admin/audit-log` finalized; full RBAC surface complete.

Each phase is independently shippable and honestly labeled at every stage — the system never presents a Phase 3/4 capability before its data prerequisites exist; it shows the earlier-phase view instead (e.g., Relative Standing instead of Gap-to-Target) rather than blocking the whole dashboard on a decision that hasn't been made yet.

---

## Open Decisions Requiring HRBP / Business Owner Approval (before code)

Carried forward from Blueprint v2.0 §J, plus new implementation-specific items from this document:

1. **`skill_target_profile` content** — HRBP must define target competency percentiles per craft/dimension. **Blocks Phase 4's gap-to-target mode.**
2. **Human validation collection process** — who performs supervisor assessments, how often, on what scale, entered by whom into `human_validation`. **Blocks Phase 3 from producing any `BLENDED` evidence.**
3. **`human_validation_blend_weight`** — how much weight human validation carries vs. system evidence once both exist. (HRBP)
4. **Weight profile** (`weights_json`) for Overall Skill Rating — first version needs approval before Phase 3 goes live for real use. (HRBP)
5. **Whether "Technical Range Evidence" ships at all** as a `SYSTEM_EVIDENCE_ONLY` proxy in Phase 3, or is held back until human validation exists for it. (HRBP)
6. **Investment decision on a `DESCRIPTION`-based NLP complexity classifier** to raise the ~90% generic-job-plan coverage from Tier B to Tier A — a scoped follow-up project, not assumed in any phase above unless approved. (Engineering + HRBP sign-off on taxonomy)
7. **Minimum evidence thresholds** (proposed defaults: 20 hours / 5 WOs per period for non-LOW confidence; peer benchmark minimum sample size 5) — confirm or adjust. (HRBP)
8. **Whether Safety/Incident data should feed this system** or remain in a separate system. (HRBP)
9. **`PMNUM`'s low fill rate (6.4%)** — confirm with the Maximo admin whether this reflects a real data gap or a different linking mechanism, before concluding on-time PM tracking is unavailable. (Engineering)
10. **`skill_target_profile.minimum_evidence_type` per dimension** — which dimensions require `BLENDED` evidence before a gap is actionable at all. (HRBP)
11. **Batch correction/replace policy** — who is authorized to mark a `data_import_batch` as `replaces_batch_id` for a prior month, and what approval (if any) is needed before a correction supersedes previously-published KPIs. (HRBP + ADMIN)
12. **Raw file retention policy** in Supabase Storage (`raw-uploads` bucket) — how long original `.xlsx` files are retained, and any access restrictions beyond the RBAC roles already defined. (HRBP / Data Governance)
13. **`FORMULA_MISMATCH` handling policy** — when a re-derived `line_cost`/`profit`/`value_per_hour` doesn't match the source-provided value beyond tolerance, should the row still import with a warning (current design), or be treated as `BLOCKING` until manually reviewed? (Engineering + HRBP)
14. **RLS scoping granularity for `MANAGER`** — confirm `org_unit` (company/plant/subplant/team) is the correct scoping unit, or whether a different organizational hierarchy should gate visibility. (HRBP + IT)

---

**This document is complete and stops here, per your instruction, to wait for approval before any application code or dashboard UI is written.**
