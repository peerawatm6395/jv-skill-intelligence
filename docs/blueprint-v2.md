# JV Skill Intelligence — System Blueprint v2.0
**Status: DRAFT FOR REVIEW — supersedes v1. No application code written yet.**
Repository: `peerawatm6395/jv-skill-intelligence`

## Why this revision exists

v1 built a solid, verified labor-data validation layer, but it let "value generated per hour" stand in for "skill" too directly. That's a category error: **labor hours, labor cost, and job value tell you what happened, not how skilled the person is.** A high value-per-hour could mean genuine expertise, or it could mean the person was handed easier/higher-priced jobs, worked in a craft with a richer job-value catalog, or benefited from a data artifact like the `ACTLABCOST` broadcast bug caught in v1.

This version restructures the whole system around **four explicit layers**, so the architecture itself prevents the category error instead of relying on a disclaimer in a tooltip:

| Layer | Answers | Built from |
|---|---|---|
| **1. Skill Intelligence** | "What do we believe about this person's actual capability?" | Performance Evidence + Human Validation, explicitly blended with a visible confidence/evidence-type tag — never Performance Evidence alone |
| **2. Performance Evidence** | "What did the system observe them do, and how does that compare to peers doing similarly complex work?" | JV labor-fact data, complexity-normalized, data-quality gated. This is objective *evidence*, not a skill claim. |
| **3. Productivity / Labor Analytics** | "How is the workforce being deployed — hours, OT, coverage, utilization?" | JV labor-fact data, operational lens, no skill inference at all |
| **4. Skill Gap & Development Recommendation** | "Where should this person or team develop next, and how confident are we in that recommendation?" | Layer 1 output vs. an HRBP-approved target skill profile, always flagged for human review before being treated as a development plan |

Everything below is organized under these four layers, per your request (A–J).

---

## A. Revised System Architecture

```
                         ┌───────────────────────────────┐
                         │  Source: Maximo/ERP JV export   │
                         └───────────────┬─────────────────┘
                                         │ ETL (outside GitHub, outside app)
                                         ▼
                         ┌───────────────────────────────┐
                         │  raw_jv_labor (immutable,       │
                         │  append-only landing)           │
                         └───────────────┬─────────────────┘
                                         ▼
                         ┌───────────────────────────────┐
                         │  jv_labor_fact (conformed)       │
                         │  ตัด='Use' filter applied         │
                         │  per-employee cost corrected      │  ◄── ACTLABCOST bug fixed here,
                         │  (LINECOST, never ACTLABCOST)     │      not downstream
                         └───────────────┬─────────────────┘
                                         │
                     ┌───────────────────┼────────────────────┐
                     ▼                   ▼                    ▼
        ┌─────────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
        │ Complexity Engine     │ │ LAYER 3           │ │ dim_employee (SCD2),  │
        │ dim_job_complexity     │ │ Labor Analytics    │ │ dim_craft_skill,       │
        │ (JPNUM cohort stats +  │ │ fact_labor_        │ │ dim_worktype, dim_org  │
        │ maintenance_class +    │ │ analytics_period    │ └───────────┬──────────┘
        │ shutdown/emergency      │ │ (hours, OT,         │             │
        │ flags; coverage-tagged  │ │ utilization,         │             │
        │ RELIABLE vs GENERIC)    │ │ workload mix —       │             │
        └───────────┬─────────────┘ │ no skill claim)      │             │
                     │               └──────────────────────┘             │
                     ▼                                                    │
        ┌─────────────────────────────────────────┐                      │
        │ LAYER 2 — Performance Evidence             │◄─────────────────┘
        │ fact_employee_performance_evidence          │
        │ (complexity-normalized, peer-benchmarked,   │
        │ labeled "evidence of demonstrated output,"  │
        │ never labeled "skill")                       │
        └───────────────────┬───────────────────────┘
                            │
         ┌──────────────────┴───────────────────┐
         ▼                                        ▼
┌─────────────────────────┐          ┌─────────────────────────────┐
│ human_validation_record    │        │ (Performance Evidence alone)  │
│ supervisor assessment,      │        │  → evidence_type =             │
│ certification, training,    │        │    SYSTEM_EVIDENCE_ONLY        │
│ mostly NOT YET COLLECTED    │        │    (low ceiling on confidence) │
│ — schema ready, §G           │        └───────────────┬───────────────┘
└───────────────┬─────────────┘                        │
                │            ┌──────────────────────────┘
                ▼            ▼
     ┌───────────────────────────────────┐
     │ LAYER 1 — Skill Intelligence          │
     │ fact_employee_skill_intelligence       │
     │ evidence_type: SYSTEM_EVIDENCE_ONLY /  │
     │ HUMAN_VALIDATED / BLENDED               │
     │ confidence_level always shown           │
     └───────────────────┬───────────────────┘
                          │
                          ▼
     ┌───────────────────────────────────┐
     │ target_skill_profile (HRBP-approved,  │
     │ per craft/role — does not exist yet,  │
     │ §G/§J)                                 │
     └───────────────────┬───────────────────┘
                          ▼
     ┌───────────────────────────────────┐
     │ LAYER 4 — Skill Gap & Development     │
     │ fact_skill_gap                         │
     │ always flagged "requires human review" │
     └───────────────────┬───────────────────┘
                          ▼
     ┌───────────────────────────────────┐
     │ Next.js app (Vercel) — reads only,    │
     │ never computes scores client-side      │
     └───────────────────┬───────────────────┘
                          ▼
     ┌───────────────────────────────────┐
     │ Claude AI layer — explains layers 1–4, │
     │ always states which layer/evidence     │
     │ type a claim rests on; never recomputes │
     └───────────────────────────────────┘
```

**Structural rules enforced by this architecture, not just by policy:**
1. Layer 1 (Skill Intelligence) can **only** be computed from Layer 2 output + `human_validation_record` — it has no code path back to raw hours/cost/`SKILLLEVEL`.
2. Layer 2 (Performance Evidence) **cannot be computed without a complexity tier** — the calculation engine requires `dim_job_complexity` to be joined before any cross-employee comparison; there is no "raw comparison" mode exposed in the app.
3. Layer 3 (Labor Analytics) is architecturally sealed off from Layers 1 and 4 — it feeds the same `jv_labor_fact` but its output tables have no foreign key into `fact_employee_skill_intelligence`, so a workload/OT metric can never silently leak into a skill score.
4. Every Layer 1 or Layer 4 record carries a mandatory `evidence_type` and `confidence_level` field that the UI is required to render adjacent to any score — there is no UI surface that shows a skill number without its evidence provenance.

---

## B. Data Model

### B.1 Dimensions (mostly carried over from v1, annotated)

```sql
CREATE TABLE dim_employee (
  employee_sk       BIGSERIAL PRIMARY KEY,
  labor_code        BIGINT NOT NULL,
  display_name      TEXT NOT NULL,
  thai_name         TEXT,
  craft             TEXT NOT NULL,          -- appropriate skill GROUP for benchmarking
  skill_level        TEXT NOT NULL,          -- LV1-LV4 — ADMINISTRATIVE PAY TIER ONLY.
                                             -- Enforced by convention + code review: no calc-engine
                                             -- function may read this column as a skill input.
  employee_type      TEXT,                   -- M/D, 2026+
  supervisor_id      BIGINT,
  supervisor_name    TEXT,
  team               TEXT,
  effective_from      DATE NOT NULL,
  effective_to        DATE,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (labor_code, effective_from)
);

CREATE TABLE dim_craft_skill (
  craft              TEXT NOT NULL,
  skill_level         TEXT NOT NULL,
  factor_weight       NUMERIC(4,2) NOT NULL,   -- verified deterministic pay-weighting FACTOR.
                                                -- NOT a competency measure. Used only to correctly
                                                -- reconstruct RATIO/JOBVALUE splits, never as a KPI input.
  PRIMARY KEY (craft, skill_level)
);

CREATE TABLE dim_worktype (
  work_type          TEXT PRIMARY KEY,
  category_bg        TEXT NOT NULL,
  maintenance_class   TEXT NOT NULL           -- 'PLANNED' | 'REACTIVE' | 'ADMIN' | 'CAPEX_RENOVATE'
);

CREATE TABLE dim_org ( ... unchanged from v1 ... );
CREATE TABLE dim_date ( ... unchanged from v1 ... );
```

### B.2 NEW — Job/WO Complexity dimension (feeds Layer 2 normalization, §C.2/D)

```sql
CREATE TABLE dim_job_complexity (
  jpnum               TEXT PRIMARY KEY,
  coverage_type        TEXT NOT NULL,          -- 'SPECIFIC_TEMPLATE' | 'GENERIC_BUCKET' | 'UNCODED'
                                                -- 'CM01' and similarly generic/catch-all plan codes are
                                                -- tagged GENERIC_BUCKET — see honesty note in §C.2.
  sample_size          INTEGER NOT NULL,
  median_hours          NUMERIC(8,2),
  median_job_value       NUMERIC(12,2),
  hours_p10             NUMERIC(8,2),
  hours_p90             NUMERIC(8,2),
  typical_craft_mix       JSONB,               -- distribution of crafts that historically perform this job
  typical_skill_level_mix  JSONB,
  complexity_tier         SMALLINT,            -- 1 (low) - 5 (high), derived statistically, see §C.2
  last_computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row-level complexity context, joined onto every labor-fact record
-- (computed columns added to jv_labor_fact, not a separate join-heavy table, for query performance):
--   maintenance_class            (from dim_worktype)
--   is_shutdown_turnaround        (ZWOREFTYPE != 'NORMAL')
--   is_emergency                  (EMER_PLANT not null)
--   job_complexity_tier            (from dim_job_complexity if coverage_type='SPECIFIC_TEMPLATE', else NULL)
--   complexity_confidence          ('RELIABLE' | 'LOW_COVERAGE' | 'NOT_APPLICABLE')
```

### B.3 Conformed fact (carried over from v1, field-renamed for honesty)

Same structure as v1 §2 `jv_labor_fact`, with these explicit renames/additions to prevent future misuse:

- `ACTLABCOST` → stored as `wo_total_labor_cost_DO_NOT_USE_PER_EMPLOYEE` (deliberately ugly name; the calc-engine linter fails a build if any KPI function references this column) — or, more practically, **the column is dropped from `jv_labor_fact` entirely** and kept only in `raw_jv_labor.payload` for lineage/audit, so it is architecturally impossible for a future developer to accidentally use it per-employee. **Recommendation: drop it from the conformed layer. Flagged for Engineering sign-off (§J).**
- New columns: `maintenance_class`, `is_shutdown_turnaround`, `is_emergency`, `job_complexity_tier`, `complexity_confidence` (from §B.2).

### B.4 NEW — Human Validation layer (Layer 1 input, currently mostly empty — see §G)

```sql
CREATE TABLE human_validation_record (
  validation_id        BIGSERIAL PRIMARY KEY,
  employee_sk           BIGINT NOT NULL REFERENCES dim_employee(employee_sk),
  validation_type        TEXT NOT NULL,        -- 'SUPERVISOR_ASSESSMENT' | 'CERTIFICATION' |
                                                -- 'TRAINING_COMPLETION' | 'PEER_REVIEW' | 'INCIDENT_REVIEW'
  skill_dimension         TEXT,                -- maps to a Layer 1 competency axis, nullable if general
  rating_or_result         TEXT,                -- free-form or scaled, per validation_type
  evidence_document_ref     TEXT,               -- link to cert/record, not stored in DB
  validated_by            TEXT NOT NULL,        -- supervisor/assessor identity
  validated_at             DATE NOT NULL,
  expires_at               DATE,                -- for certifications
  source                   TEXT NOT NULL         -- 'HR_SYSTEM' | 'MANUAL_ENTRY' | 'LMS_EXPORT' etc.
);
```
Current data has **no populated source for this table** except the sparse `อบรม` (training-value) flag in 2026 (162–247 rows, not a real training record — just a JV-linked flag). This table is architected now so Layer 1 has a place to grow into as HR starts capturing supervisor input, but it ships **empty at launch**. This is the most important structural gap in the whole system — see §G.

### B.5 NEW — Target skill profile (Layer 4 input, requires HRBP definition — see §G/§J)

```sql
CREATE TABLE target_skill_profile (
  profile_id            TEXT PRIMARY KEY,
  craft                  TEXT NOT NULL,
  role_level              TEXT,                 -- optional finer grain than craft alone
  skill_dimension          TEXT NOT NULL,        -- one of the Layer 1 competency axes (§C)
  target_percentile         NUMERIC(5,2) NOT NULL, -- e.g. 75 = "should be at or above craft p75"
  minimum_evidence_type      TEXT,               -- e.g. some dimensions may require HUMAN_VALIDATED,
                                                  -- not just SYSTEM_EVIDENCE_ONLY, before a gap is actionable
  approved_by              TEXT NOT NULL,
  approved_at               TIMESTAMPTZ NOT NULL,
  is_active                 BOOLEAN NOT NULL DEFAULT FALSE
);
```
**This table does not exist yet either.** There is currently no engineering-approved or HRBP-approved competency framework per craft in the source data. Layer 4 cannot run meaningfully until this is populated — flagged in §G/§J, not silently defaulted.

### B.6 Layer output tables

```sql
-- LAYER 2 — Performance Evidence (renamed from v1's fact_employee_kpi_period; explicitly not a skill table)
CREATE TABLE fact_employee_performance_evidence (
  evidence_id             BIGSERIAL PRIMARY KEY,
  employee_sk              BIGINT NOT NULL REFERENCES dim_employee(employee_sk),
  period_type               TEXT NOT NULL,
  period_key                 TEXT NOT NULL,
  craft                      TEXT NOT NULL,
  skill_level                 TEXT NOT NULL,       -- stratification only
  complexity_tier_mix          JSONB,               -- distribution of complexity tiers worked this period
  value_per_hour_raw            NUMERIC(12,2),
  value_per_hour_complexity_adj  NUMERIC(12,2),      -- see §C.2 method
  cost_efficiency_ratio          NUMERIC(8,4),
  pm_value_per_hour               NUMERIC(12,2),
  cm_value_per_hour                NUMERIC(12,2),
  record_count                     INTEGER,
  complexity_coverage_pct           NUMERIC(5,2),     -- % of the period's hours that had RELIABLE complexity
                                                       -- tiering (vs GENERIC_BUCKET/NOT_APPLICABLE) — shown
                                                       -- in the UI so users know how trustworthy the
                                                       -- complexity adjustment is for this employee-period
  calculated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  calc_engine_version                 TEXT NOT NULL,
  UNIQUE (employee_sk, period_type, period_key)
);

CREATE TABLE fact_peer_benchmark (
  -- same as v1, but keyed additionally by complexity_tier where coverage allows:
  craft TEXT, skill_level TEXT, complexity_tier SMALLINT,  -- nullable if GENERIC_BUCKET
  period_type TEXT, period_key TEXT, metric_name TEXT,
  p10 NUMERIC, p25 NUMERIC, p50 NUMERIC, p75 NUMERIC, p90 NUMERIC,
  mean NUMERIC, median NUMERIC, mad NUMERIC, sample_size INTEGER,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LAYER 3 — Labor Analytics (NEW table, structurally separate from Layer 2 — no skill inference)
CREATE TABLE fact_labor_analytics_period (
  analytics_id             BIGSERIAL PRIMARY KEY,
  employee_sk                BIGINT REFERENCES dim_employee(employee_sk),   -- nullable for team/org-level rows
  org_sk                      INTEGER REFERENCES dim_org(org_sk),
  period_type                  TEXT NOT NULL,
  period_key                    TEXT NOT NULL,
  total_hours                    NUMERIC(10,2),
  regular_hours                    NUMERIC(10,2),
  ot_hours                          NUMERIC(10,2),
  ot_ratio                           NUMERIC(6,4),
  ot_tier_mix                         JSONB,             -- OT1/1.5/2/3 breakdown
  emergency_hours                      NUMERIC(10,2),
  emergency_ratio                       NUMERIC(6,4),
  planned_vs_reactive_hour_mix           JSONB,
  distinct_worktypes_worked               INTEGER,
  distinct_plants_worked                   INTEGER,
  headcount_covered                         INTEGER,      -- for org/team-level rollups
  calculated_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_sk, org_sk, period_type, period_key)
);

-- LAYER 1 — Skill Intelligence
CREATE TABLE fact_employee_skill_intelligence (
  score_id                BIGSERIAL PRIMARY KEY,
  employee_sk               BIGINT NOT NULL REFERENCES dim_employee(employee_sk),
  period_type                TEXT NOT NULL,
  period_key                  TEXT NOT NULL,
  skill_dimension               TEXT NOT NULL,      -- Technical, Productivity-Evidence, PM Evidence,
                                                     -- CM Evidence, Cost Evidence, Breadth Evidence, etc.
                                                     -- (renamed from v1's bare "skill" labels — see §C.3)
  score_0_100                   NUMERIC(5,2) NOT NULL,
  evidence_type                   TEXT NOT NULL,     -- 'SYSTEM_EVIDENCE_ONLY' | 'HUMAN_VALIDATED' | 'BLENDED'
  confidence_level                 TEXT NOT NULL,     -- 'HIGH' | 'MEDIUM' | 'LOW'
  performance_evidence_ref           BIGINT REFERENCES fact_employee_performance_evidence(evidence_id),
  human_validation_refs                BIGINT[],       -- array of human_validation_record IDs contributing, if any
  weight_profile_id                     TEXT NOT NULL,
  calculated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  calc_engine_version                     TEXT NOT NULL
);

CREATE TABLE fact_overall_skill_rating (
  rating_id BIGSERIAL PRIMARY KEY,
  employee_sk BIGINT NOT NULL REFERENCES dim_employee(employee_sk),
  period_type TEXT NOT NULL, period_key TEXT NOT NULL,
  overall_rating NUMERIC(5,2) NOT NULL,
  overall_evidence_type TEXT NOT NULL,      -- worst-case (lowest-confidence) of contributing dimensions,
                                             -- never silently averaged up to a higher confidence than earned
  overall_confidence_level TEXT NOT NULL,
  weight_profile_id TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_sk, period_type, period_key, weight_profile_id)
);

-- LAYER 4 — Skill Gap & Development
CREATE TABLE fact_skill_gap (
  gap_id                  BIGSERIAL PRIMARY KEY,
  employee_sk               BIGINT NOT NULL REFERENCES dim_employee(employee_sk),
  period_type                TEXT NOT NULL, period_key TEXT NOT NULL,
  skill_dimension              TEXT NOT NULL,
  current_score                 NUMERIC(5,2) NOT NULL,
  target_percentile              NUMERIC(5,2) NOT NULL,
  target_profile_id                TEXT NOT NULL REFERENCES target_skill_profile(profile_id),
  gap_size                          NUMERIC(5,2) NOT NULL,
  evidence_type_of_current_score       TEXT NOT NULL,   -- carried through — a gap built on
                                                          -- SYSTEM_EVIDENCE_ONLY is shown differently
                                                          -- than one built on HUMAN_VALIDATED
  requires_human_review                  BOOLEAN NOT NULL DEFAULT TRUE,
  reviewed_by                              TEXT,
  reviewed_at                               TIMESTAMPTZ,
  review_outcome                            TEXT,        -- 'CONFIRMED' | 'ADJUSTED' | 'DISMISSED'
  calculated_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE score_evidence_link ( ... unchanged from v1 — links every score to source jv_id rows ... );
CREATE TABLE weight_profile ( ... unchanged from v1 ... );
CREATE TABLE app_user ( ... unchanged from v1 ... );
CREATE TABLE audit_log ( ... unchanged from v1 ... );
```

---

## C. Skill Intelligence Framework

### C.1 The core epistemic rule

**Skill is a latent property of a person. JV data records events (hours worked, work orders completed, value generated). No amount of aggregation turns an event log into a direct skill measurement — it can only produce evidence that narrows uncertainty about skill, and that evidence is stronger or weaker depending on how well it controls for what the person was assigned to do.**

Concretely, this rules out three things explicitly, per your instructions:
- `SKILLLEVEL` is never read by any Layer 1 scoring function. It is an HR pay-tier, verified in v1 to be a deterministic lookup for `FACTOR`, not an assessed competency. It appears in the system only as a peer-grouping/stratification key and as a "does the computed evidence agree with the assigned tier?" diagnostic for HRBP — never as an input to a score.
- Labor hours and labor cost are never treated as proof of skill. They measure *time spent* and *money spent*, which are inputs to efficiency ratios, not skill.
- `ACTLABCOST`/the WO-broadcast cost field is never used per employee, for any purpose, anywhere in the system (§B.3 — recommended to be dropped from the conformed layer entirely).

### C.2 Complexity normalization (new in v2 — required before any productivity comparison)

**The problem this solves:** two employees can log identical hours and produce very different `JOBVALUE` purely because the job-value catalog (looked up via `JPNUM`) prices jobs differently, independent of how skillfully either person worked. Without correcting for this, "value per hour" rewards *what you were assigned*, not *how well you did it*.

**What I found when I checked whether this is fixable with the current data — stated honestly, not glossed over:**

I profiled `JPNUM` (the job-plan/template code) across all three years. It is **99.9% filled**, which looked promising, but:

| Year | Rows | % of rows on the single generic `CM01` job-plan code | Distinct job-plan templates with ≥10 observations (excl. `CM01`) |
|---|---|---|---|
| 2024 | 151,300 | **93.2%** | 141 |
| 2025 | 135,086 | **88.1%** | 188 |
| 2026 | 80,101 | **89.2%** | 124 |

**`CM01` is a catch-all "generic corrective maintenance" code, not a specific job template** — it covers 88–93% of all rows every year, spanning every craft and a wide hour/value range (2024: 0.02–47.97 hours, −6.99M to 47,676 THB job value within that single code). That means **JPNUM-based complexity tiering only gives reliable, specific complexity information for roughly 7–12% of records.** For the other ~90%, the current data does not support fine-grained job-complexity normalization.

**Complexity normalization method actually usable now (honest, tiered):**

1. **Tier A — Reliable, specific complexity (≈7–12% of rows):** for `JPNUM` codes with `coverage_type = 'SPECIFIC_TEMPLATE'` (≥10 historical observations, not the generic bucket), compute `dim_job_complexity` statistics (median hours, median value, typical craft/skill mix) and assign a 1–5 `complexity_tier`. Peer comparisons for these records benchmark within `(craft, skill_level, complexity_tier)`.
2. **Tier B — Coarse but reliable, available for ~100% of rows:** `maintenance_class` (PLANNED vs. REACTIVE vs. ADMIN vs. CAPEX/RENOVATE, from `WORKTYPE`), `is_shutdown_turnaround` (from `ZWOREFTYPE`), and `is_emergency` (from `EMER_PLANT`) are used as a coarser but universally-available complexity/urgency stratification. Peer comparisons for the generic-bucket majority benchmark within `(craft, skill_level, maintenance_class, is_shutdown_turnaround, is_emergency)` instead of a raw craft-only comparison.
3. Every Layer 2 output row carries `complexity_confidence` (`RELIABLE` for Tier A, `LOW_COVERAGE` for Tier B-only) and `complexity_coverage_pct` at the employee-period level, so the UI never presents a complexity-adjusted number without disclosing how much of it rests on coarse vs. specific normalization.
4. **What would close this gap** (flagged for Engineering, §G/§J): either (a) a WO priority/severity field from Maximo if one exists outside this export, (b) an asset-criticality table, or (c) an NLP-based complexity classifier trained on the `DESCRIPTION` free-text field — the last of these is a real option given `DESCRIPTION` is populated on nearly every row, but it requires its own validation project (a labeled sample, human review of the taxonomy) before being trusted, and is out of scope for this phase unless approved.

### C.3 Skill dimensions (revised naming — deliberately not called raw "skill" scores)

The original 9 target dimensions are kept, but reframed as **Performance-Evidence dimensions** at Layer 2, which only become **Skill Intelligence dimensions** at Layer 1 once evidence-type is attached:

| Layer 2 (Performance Evidence) name | Layer 1 (Skill Intelligence) name shown to HRBP |
|---|---|
| Productivity Evidence | Productivity (Skill Indicator) |
| Work Efficiency Evidence | Work Efficiency (Skill Indicator) |
| PM Value Evidence | PM Skill (Indicator) |
| CM Value Evidence | CM Skill (Indicator) |
| Technical Range Evidence | Technical Skill (Indicator — proxy, see §D) |
| Cost Efficiency Evidence | Cost Efficiency (Skill Indicator) |
| Profit-per-Hour Evidence | Profit per Hour (Indicator) |
| Breadth Evidence | Skill Breadth (Indicator) |
| — (moved to Layer 3 entirely, not a skill dimension) | OT Management → **Labor Analytics only**, not part of Skill Intelligence at all (see §D.3 rationale) |

Every Layer 1 card shows the word **"Indicator"**, not "Rating," until `evidence_type = HUMAN_VALIDATED` or `BLENDED` for that dimension — a purely `SYSTEM_EVIDENCE_ONLY` dimension is UI-labeled as an indicator with a visible confidence badge, precisely so the product itself doesn't overstate what the data supports.

### C.4 Evidence-type computation

```
evidence_type =
  BLENDED               if a human_validation_record exists for this employee+skill_dimension
                         within the period AND performance evidence also exists
  HUMAN_VALIDATED        if only a human_validation_record exists (rare — e.g. a fresh hire
                         with a certification but not yet enough JV hours)
  SYSTEM_EVIDENCE_ONLY    if only performance evidence exists (the default for nearly 100%
                         of employees today, since human_validation_record is currently empty)
```

confidence_level is computed independently from `record_count` (evidence volume), `complexity_confidence`, and — once populated — validation recency, per §E.

---

## D. KPI Dictionary

Every KPI states: **Definition, Formula, Data Source, Normalization, Benchmark, Limitation**, plus a **Measurability** tag: 🟢 Directly measurable now / 🟡 Measurable but low-confidence (generic-bucket complexity coverage) / 🔴 Requires additional data (listed in §G).

### D.1 Layer 2 — Performance Evidence KPIs

**D.1.1 Complexity-Adjusted Productivity** 🟢/🟡 (🟢 for Tier-A-covered work, 🟡 for generic-bucket work)
- *Definition:* Value generated per hour worked, benchmarked against peers who performed comparably complex work.
- *Formula:* `Σ employee_job_value / Σ total_hrs`, percentile-ranked within `(craft, skill_level, complexity_tier)` if `complexity_confidence=RELIABLE`, else within `(craft, skill_level, maintenance_class, is_shutdown_turnaround, is_emergency)`.
- *Data source:* `jv_labor_fact.employee_job_value`, `.total_hrs`, `dim_job_complexity`.
- *Normalization:* percentile rank, winsorized p1/p99 per peer group.
- *Benchmark:* peer group as defined above, minimum sample size 5.
- *Limitation:* even complexity-normalized, this is still an outcome measure — it reflects value generated, not necessarily technique. Two employees producing equal value on equally-complex work could differ in *how* they got there (safety shortcuts, help from teammates not reflected in labor split, etc.) that this KPI cannot see.

**D.1.2 Work / Cost Efficiency Evidence** 🟢
- *Definition:* Value generated per baht of labor cost.
- *Formula:* `Σ employee_job_value / Σ line_cost` (never `wo_total_labor_cost`).
- *Data source:* `jv_labor_fact.employee_job_value`, `.line_cost`.
- *Normalization:* percentile within same complexity-aware peer group as D.1.1.
- *Benchmark:* same peer group definition.
- *Limitation:* mechanically related to D.1.1 (shared numerator) — documented as correlated, not fully independent evidence.

**D.1.3 PM Value Evidence** 🟢 (value ratio) / 🔴 (on-time compliance — not measurable)
- *Definition:* Value-per-hour on planned/preventive/predictive work (`maintenance_class='PLANNED'`).
- *Formula:* `Σ employee_job_value(PLANNED) / Σ total_hrs(PLANNED)`, complexity-normalized.
- *Data source:* `jv_labor_fact` filtered to `maintenance_class='PLANNED'`.
- *Normalization/Benchmark:* as D.1.1, restricted to PLANNED work.
- *Limitation:* **on-time PM completion rate — arguably the more meaningful PM performance signal — is 🔴 not measurable.** `PMNUM` is only 6.4% filled and there is no PM due-date/schedule table in this export. This KPI measures value-efficiency on planned work only, not schedule adherence.

**D.1.4 CM Value Evidence** 🟢 (value ratio) / 🔴 (diagnostic accuracy — not measurable)
- *Definition:* Value-per-hour on corrective/reactive/breakdown work.
- *Formula/Data source/Normalization/Benchmark:* mirrors D.1.3 for `maintenance_class='REACTIVE'`.
- *Limitation:* reactive work severity varies with no severity field to control for beyond the coarse Tier-B flags; **whether the fault was correctly diagnosed the first time, or required rework, is 🔴 not measurable** (no reopen/callback field exists — see §G).

**D.1.5 Technical Range Evidence (Technical Skill proxy)** 🟡/🔴
- *Definition:* Breadth and value-efficiency of reactive/diagnostic work exposure, as a *proxy* for technical competence.
- *Formula:* composite percentile of (reactive-work value efficiency) + (distinct assets/work-types) + (emergency-work participation rate).
- *Data source:* `jv_labor_fact` distinct-count aggregates + D.1.4.
- *Normalization/Benchmark:* percentile within craft.
- *Limitation:* 🔴 **This is explicitly a proxy, not a technical skill measurement.** No defect/rework/QA-pass field exists. HRBP/Engineering must decide whether to surface this at all, or hold it back until `human_validation_record` (supervisor technical assessment) can blend in — see §J.

**D.1.6 Skill Breadth Evidence** 🟢
- *Definition:* Diversity of work-type/asset/plant exposure within the period.
- *Formula:* percentile-ranked distinct counts (`distinct_worktypes_worked`, `distinct_assets`, `distinct_plants`), averaged.
- *Data source:* `jv_labor_fact` distinct-count aggregates.
- *Normalization/Benchmark:* percentile within craft.
- *Limitation:* driven partly by supervisor assignment/scheduling decisions, not solely by employee initiative — presented as descriptive exposure, not ambition or capability.

### D.2 Layer 1 — Skill Intelligence (aggregation of D.1, plus human validation)

**D.2.1 Skill Dimension Score** 🟢 (as SYSTEM_EVIDENCE_ONLY) / requires §G data to reach BLENDED
- *Definition:* 0–100 score per dimension, blending Performance Evidence with Human Validation when available.
- *Formula:* `Score = evidence_blend(performance_evidence_percentile, human_validation_rating, weight_profile)`. When no human validation exists (current default), `Score = performance_evidence_percentile` and `evidence_type = SYSTEM_EVIDENCE_ONLY`.
- *Data source:* `fact_employee_performance_evidence` + `human_validation_record`.
- *Normalization:* already percentile-based from Layer 2; human validation ratings (once collected) normalized on a scale defined jointly with HRBP (§J).
- *Benchmark:* inherited from Layer 2's complexity-aware peer group.
- *Limitation:* until `human_validation_record` has real data, every Layer 1 score is, by construction, **only as trustworthy as Layer 2** — the architecture supports blending, but today there is nothing to blend with. This is disclosed via `evidence_type`, not hidden.

**D.2.2 Overall Skill Rating** 🟢 (mechanically) / interpretation depends on §J weight approval
- *Definition/Formula:* `Σ (weight_i × dimension_score_i)` using an approved `weight_profile` (same governance as v1 §4.10).
- *Limitation:* `overall_evidence_type` is set to the **weakest** contributing dimension's evidence type, not an average — a single `SYSTEM_EVIDENCE_ONLY` dimension keeps the whole Overall Rating capped at that confidence, so the headline number can't imply more validation than actually exists.

### D.3 Layer 3 — Labor Analytics KPIs (explicitly not skill KPIs)

**D.3.1 OT Ratio & Tier Mix** 🟢
- *Definition:* Overtime hours as a share of total hours, and the split across OT1/1.5/2/3 tiers.
- *Formula:* `Σ ot_hrs / Σ total_hrs`; tier shares similarly.
- *Data source:* `jv_labor_fact` hour fields.
- *Normalization/Benchmark:* peer percentile within craft/team, purely descriptive (no "good/bad" direction asserted).
- *Limitation/Rationale for moving to Layer 3:* v1 tried to make this a skill-adjacent "OT Management" score; on reflection this is a **workload/scheduling analytics metric**, not a skill signal — high OT can mean responsiveness (positive) or overload/understaffing (organizational, not personal) or inefficiency (rare, hard to isolate from the other two). Placing it in Layer 3 keeps it available to HRBP for workforce planning without implying it measures the employee's competence.

**D.3.2 Utilization / Coverage** 🟢
- *Definition:* Hours logged vs. available working days in period, emergency-hours share, planned-vs-reactive work mix at team/plant level.
- *Formula/Data source:* aggregates of `jv_labor_fact` at team/org grain.
- *Normalization/Benchmark:* team-to-team, plant-to-plant comparison for staffing decisions.
- *Limitation:* "available working days" isn't in this export (no leave/absence calendar) — utilization is approximated from logged-hours patterns only; true utilization vs. scheduled shift data is 🔴 not measurable without an HR attendance/roster feed.

### D.4 Layer 4 — Skill Gap KPIs

**D.4.1 Skill Gap Size** 🟡 (mechanically measurable; meaning depends on §G/§J)
- *Definition:* Distance between current Layer 1 score and an HRBP-approved target percentile for that craft/dimension.
- *Formula:* `max(0, target_percentile − current_score)`.
- *Data source:* `fact_employee_skill_intelligence`, `target_skill_profile`.
- *Normalization:* already on the 0–100 scale.
- *Benchmark:* the target itself is the benchmark — set by HRBP, not invented by the system.
- *Limitation:* **🔴 `target_skill_profile` does not exist yet** — this KPI cannot run meaningfully until HRBP defines target competency levels per craft (§G/§J). Until then, the system can show *relative* standing (percentile vs. peers) but not a true "gap to target."

---

## E. Skill Scoring Logic

1. **Gate on data quality:** pull `jv_labor_fact` rows where `data_quality_flag='USE'` only.
2. **Attach complexity context:** join `dim_job_complexity` where `coverage_type='SPECIFIC_TEMPLATE'`; fall back to Tier-B flags (`maintenance_class`, `is_shutdown_turnaround`, `is_emergency`) otherwise. Tag `complexity_confidence` per row.
3. **Aggregate to Layer 2:** compute `fact_employee_performance_evidence` per employee-period, split by complexity tier mix, with `complexity_coverage_pct` recorded.
4. **Benchmark:** compute `fact_peer_benchmark` within the complexity-aware peer group defined in §C.2, winsorized at p1/p99, minimum sample size 5 (falls back to a wider grouping, logged, if below threshold).
5. **Percentile-normalize** each Layer 2 metric into a 0–100 Performance Evidence percentile.
6. **Check for human validation:** query `human_validation_record` for the employee + skill_dimension + period window (validity window configurable, e.g. certifications valid until `expires_at`, assessments valid for N months).
7. **Blend into Layer 1 score:**
   - No validation found → `score = performance_evidence_percentile`, `evidence_type = SYSTEM_EVIDENCE_ONLY`.
   - Validation found → `score = weight_profile.human_validation_weight × validation_score + (1 − weight) × performance_evidence_percentile`, `evidence_type = BLENDED`. The blend weight itself is a value to be set jointly with HRBP (§J), not invented here.
8. **Set confidence_level:** `LOW` if `record_count` below threshold, or `complexity_confidence != RELIABLE` and the dimension is complexity-sensitive (D.1.1–D.1.5), or evidence is `SYSTEM_EVIDENCE_ONLY` with a small validation-eligible population; `HIGH` only when `BLENDED` with recent validation and sufficient evidence volume; `MEDIUM` otherwise.
9. **Persist with full lineage:** `score_evidence_link` rows connect every Layer 1 score to the exact `jv_id`s and `human_validation_record` ids behind it.
10. **Overall Rating:** weighted blend of dimension scores via approved `weight_profile`; `overall_evidence_type` = weakest contributing dimension (§D.2.2).

---

## F. Skill Gap Logic

1. Requires an **active `target_skill_profile`** per `(craft, skill_dimension)` — HRBP-approved, not system-invented (§G/§J). Until this exists, the Skill Gap page runs in a **"Relative Standing" mode** (percentile vs. peers, no gap-to-target number) rather than fabricating a target.
2. Once targets exist: `gap = max(0, target_percentile − current_score)` per dimension, computed only where `current_score`'s `evidence_type` meets the profile's `minimum_evidence_type` requirement (some dimensions may be defined as requiring `BLENDED` evidence before a gap is considered actionable — an HRBP decision, §J).
3. Every gap record defaults to `requires_human_review = TRUE`. **No gap is surfaced to the employee or used in Team Builder eligibility filtering until a supervisor/HRBP marks it `CONFIRMED`** via the review workflow — this directly implements your instruction that development recommendations stay separate from an unreviewed system output.
4. Team/craft-level gap rollups aggregate confirmed individual gaps (or relative-standing figures pre-target) to surface systemic patterns for workforce planning, same as v1 §11, but now carrying the evidence-type/review-status metadata through the rollup.
5. **Development recommendations** (Layer 4 output, e.g. "recommend PM-focused mentoring") are generated by the AI layer strictly from confirmed gap records + peer benchmark context — never from raw scores directly, and always rendered with a "recommendation, pending supervisor discussion" framing, not a directive.

---

## G. Required Additional Data

Organized by what it would unlock:

| Additional data needed | Unlocks | Priority |
|---|---|---|
| **Supervisor skill assessment records** (structured, periodic, per craft-relevant competency) | `human_validation_record` population → `BLENDED`/`HUMAN_VALIDATED` evidence types, the single biggest upgrade to Layer 1 credibility | **High** |
| **Certification / license records** (welding certs, electrical licenses, etc., with expiry) | Objective, verifiable technical-skill evidence independent of labor data | **High** |
| **Quality / rework / callback / reopen field** on work orders (did the job need to be redone?) | Turns D.1.4/D.1.5 (CM/Technical evidence) from value-efficiency proxies into genuine quality signals | **High** |
| **PM schedule / due-date table** (planned date vs. actual close date) | Enables real on-time PM completion rate (D.1.3 currently 🔴) | **Medium** |
| **Asset criticality / WO priority field** | Strengthens complexity normalization beyond the current Tier-A/Tier-B split (§C.2) | **Medium** |
| **HRBP/Engineering-approved competency framework per craft** (`target_skill_profile` content) | Required for Layer 4 to run in "gap-to-target" mode at all, not just relative standing | **High — blocks Layer 4** |
| **Training completion / LMS export** (beyond the sparse `อบรม` flag) | Populates `human_validation_record` type `TRAINING_COMPLETION` | **Medium** |
| **Attendance/roster/leave calendar** | Enables true utilization metrics in Layer 3 (currently approximated from logged hours only) | **Low-Medium** |
| **Safety/incident records** | A currently-missing but often material input to "CM Skill"/"Technical Skill" trustworthiness in maintenance contexts — flagged for HRBP to weigh in on whether it belongs in this system or stays in a separate safety system | **For discussion, §J** |
| **A validated complexity taxonomy for the `CM01` generic-bucket majority** (either an engineering-defined rule set or an NLP classifier over `DESCRIPTION`, validated against a human-labeled sample) | Would raise `complexity_confidence` from `LOW_COVERAGE` to `RELIABLE` for ~90% of records currently in the generic bucket | **High impact, needs a scoped follow-up project, not part of this phase unless approved (§J)** |

---

## H. Data Quality Rules

Hard rules enforced at the ETL/calc-engine level, not just documented:

1. **`ตัด != 'Use'` rows are excluded** at load time into `jv_labor_fact` (kept in `raw_jv_labor` for lineage, never used downstream). Applies uniformly across 2024 (implicit `Use` when null), 2025, 2026.
2. **`ACTLABCOST`/the WO-broadcast cost is never used as a per-employee figure.** Recommended: drop it from the conformed layer entirely (§B.3); if kept for reference, it must be renamed and excluded from every calc-engine function by lint rule.
3. **`SKILLLEVEL` is never an input to any score.** It is permitted only as a `GROUP BY`/stratification key and as a diagnostic ("does computed evidence diverge from assigned tier?") surfaced to HRBP, never fed back into the score that produced the diagnostic.
4. **No cross-employee productivity/value comparison without a complexity context.** Every comparison query must include `complexity_tier` (Tier A) or the Tier-B flag set — there is no "compare raw value/hour across craft" code path exposed anywhere in the app.
5. **Outlier winsorization** at p1/p99 per peer group before any percentile computation (the −6.99M THB-class single-row outliers observed in 2024/2025/2026 must not distort a whole peer distribution).
6. **Minimum sample size 5** for a valid peer benchmark; below that, fall back to a wider grouping (documented per computation) rather than benchmarking against too few peers.
7. **Minimum evidence volume per employee-period** (proposed default: 20 hours or 5 distinct WOs, to be confirmed with HRBP) before a Layer 1 score is shown at anything above `LOW` confidence.
8. **Employee identity via SCD2**: a labor-fact row always links to the `dim_employee` version whose `effective_from`/`effective_to` window contains its `timesheet_date`, not the employee's current profile — protects historical scores from being silently rewritten by a later craft/skill_level change.
9. **Cross-year schema drift reconciliation**: 2026 lacks `TYPE_BG` (re-derived from `WORKTYPE`+`ZWOREFTYPE` crosswalk), lacks `Quarter`/`รายเดือน` (re-derived from `TIMESHEETDATE`), and adds `EMPLOYEETYPE`/`อบรม` — ETL must handle this per-year mapping explicitly and alert on any *new* unrecognized schema drift in future loads (an ETL validation step, not a silent `SELECT *`).
10. **Complexity confidence is always disclosed**, never silently defaulted to "reliable" — `complexity_coverage_pct` shown wherever a complexity-adjusted number is shown.
11. **`evidence_type` and `confidence_level` are mandatory, non-null fields** on every Layer 1/4 record and are required UI elements, not optional tooltips — enforced by the API response schema (a Layer 1 payload without these fields is a contract violation, not a valid response).
12. **Negative `PROFIT`/`JOBVALUE` values are kept, not floored to zero** — they're real loss-making jobs and are meaningful evidence, but are subject to the same winsorization as rule 5 to prevent single extreme rows from dominating a benchmark.

---

## I. Dashboard / Output Design

```
/                              Role-based home. HRBP: org-wide 4-layer summary.
                               Manager: team view. Employee: own profile.

── LAYER 1: SKILL INTELLIGENCE ─────────────────────────────────────
/employees/[id]                Player Card — Overall Rating + 9 dimension "Indicators,"
                               each visibly tagged with evidence_type (badge: System
                               Evidence / Human Validated / Blended) and confidence_level
/employees/[id]/radar          Skill Radar — same evidence/confidence tagging per axis
/compare                       2–3 employee comparison — each employee's peer group AND
                               each dimension's evidence type shown side-by-side, so a
                               System-Evidence-Only dimension is never visually equated
                               with a Human-Validated one
/skill-matrix                  Org-wide matrix; cells shaded by score AND by a secondary
                               confidence overlay (toggle) so HRBP can filter to
                               "high-confidence only" view

── LAYER 2: PERFORMANCE EVIDENCE ───────────────────────────────────
/performance-evidence/[id]     Raw-to-normalized evidence detail: value/hour before and
                               after complexity adjustment, complexity_coverage_pct,
                               peer group definition used, drill-down to source WOs
/methodology/complexity        Public-within-org transparency page: what Tier A/B mean,
                               current CM01-generic-bucket coverage stats (§C.2 table),
                               explicitly showing the system's own limitations

── LAYER 3: PRODUCTIVITY / LABOR ANALYTICS ────────────────────────
/labor-analytics                Org/team/plant workload dashboards: OT ratio & tier mix,
                               emergency-hours share, planned-vs-reactive mix,
                               distinct-worktype coverage — explicitly NOT linked to
                               any skill score on this page
/labor-analytics/[team]        Team-level drill-down for staffing/scheduling decisions

── LAYER 4: SKILL GAP & DEVELOPMENT ────────────────────────────────
/employees/[id]/gap            Shows "Relative Standing" (percentile vs peers) if no
                               target_skill_profile is active yet; shows true gap-to-
                               target once profiles are approved. Every gap flagged
                               "Pending supervisor review" until confirmed.
/gap-review-queue              Supervisor/HRBP workflow: confirm / adjust / dismiss
                               system-suggested gaps before they become visible
                               recommendations or feed Team Builder eligibility
/team-builder                  Candidate search — filters only on CONFIRMED gaps /
                               evidence meeting the profile's minimum_evidence_type

── CROSS-CUTTING ───────────────────────────────────────────────────
/assistant                    AI Workforce Assistant — every AI answer states which
                               layer and evidence_type its claims rest on
                               ("this is based on system-evidence-only productivity
                               data for the current quarter; no supervisor validation
                               is on file for this employee")
/admin/weight-profiles         ADMIN: propose/approve/activate scoring + blend weights
/admin/target-skill-profiles   ADMIN/HRBP: define/approve craft competency targets
/admin/data-quality             ETL run history, excluded-row counts, complexity
                               coverage trend, schema-drift alerts
/admin/audit-log                Access logging
```

---

## J. Open Decisions Requiring HRBP / Engineering Approval

1. **Drop `ACTLABCOST` from the conformed layer entirely**, vs. keep it renamed/lint-blocked? (Engineering)
2. **Target skill profiles per craft** — HRBP must define what "good" looks like per dimension per craft before Layer 4 can run in gap-to-target mode. Without this, Layer 4 ships in Relative-Standing-only mode. (HRBP)
3. **Human validation collection process** — who performs supervisor assessments, how often, on what scale, and how it's entered into `human_validation_record`? This is the single highest-leverage decision for making Layer 1 trustworthy. (HRBP + Engineering for tooling)
4. **Blend weight** between Performance Evidence and Human Validation when both exist (§E step 7) — not invented by the system. (HRBP)
5. **Whether "Technical Skill" (D.1.5) should ship at all** as a `SYSTEM_EVIDENCE_ONLY` proxy, or be held back until human validation can blend in. (HRBP)
6. **Whether to invest in a `DESCRIPTION`-based complexity classifier** to raise the ~90% generic-bucket coverage to `RELIABLE` — scoped as its own validation project, not assumed in-scope here. (Engineering, with HRBP sign-off on the taxonomy)
7. **Minimum evidence thresholds** (proposed: 20 hours / 5 WOs per period for non-LOW confidence; 5 peers minimum for a valid benchmark) — confirm or adjust. (HRBP)
8. **Whether Safety/Incident data should feed into this system** or remain separate. (HRBP)
9. **Whether `PMNUM`'s low fill rate (6.4%) reflects a real data gap or a different linking mechanism** worth investigating in the source Maximo instance before concluding on-time PM tracking is unavailable. (Engineering to confirm with the Maximo admin)
10. **Overall Rating weight profile** (dimension weights) — same open item as v1, now explicitly gated behind the evidence-type/confidence framework rather than a flat average. (HRBP)
11. **`target_skill_profile.minimum_evidence_type` per dimension** — which dimensions, if any, should require `BLENDED` evidence before a gap is considered actionable at all (vs. allowing `SYSTEM_EVIDENCE_ONLY` gaps to be shown, just clearly labeled)? (HRBP)

Nothing in Layers 1 or 4 goes live for real employee-facing use until items 2, 3, and 4 have at least a first version approved — the system can and will run in a reduced, honestly-labeled mode (Performance Evidence + Labor Analytics only, Skill Intelligence shown as "System-Evidence-Only, no target defined yet") until then, rather than shipping a fabricated skill number.
