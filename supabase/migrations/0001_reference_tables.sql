-- ============================================================
-- 0001_reference_tables.sql
-- JV Skill Intelligence — Reference / Lookup tables
-- Source: Implementation Architecture v3.0 §2.1
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists craft (
  craft_code   text primary key,
  craft_name   text not null,
  is_active    boolean not null default true
);

create table if not exists skill_level (
  skill_level_code text primary key,   -- LV1..LV4
  description       text,
  is_active          boolean not null default true
);
comment on table skill_level is
  'Administrative pay/weighting tier only (verified deterministic driver of factor_weight in '
  'craft_skill_factor). MUST NEVER be read as a skill/competency score by any KPI or Skill '
  'Intelligence calculation. See Blueprint v2.0 §C.1 and Implementation Architecture v3.0 §6.';

create table if not exists craft_skill_factor (
  craft_code       text not null references craft(craft_code),
  skill_level_code text not null references skill_level(skill_level_code),
  factor_weight    numeric(4,2) not null,
  primary key (craft_code, skill_level_code)
);
comment on table craft_skill_factor is
  'Verified deterministic FACTOR lookup keyed on (craft, skill_level), used only to correctly '
  'reconstruct RATIO/JOBVALUE distribution math. Never used as a KPI input.';

create table if not exists work_type_lookup (
  work_type          text primary key,   -- CM, PM, IN, BD, ADM, RVM, RVG, CPM, PDM, CPO
  category_bg        text not null,
  maintenance_class  text not null
    constraint chk_maintenance_class check (
      maintenance_class in ('PLANNED', 'REACTIVE', 'ADMIN', 'CAPEX_RENOVATE')
    )
);

create table if not exists job_plan (
  jpnum              text primary key,
  coverage_type      text not null
    constraint chk_coverage_type check (
      coverage_type in ('SPECIFIC_TEMPLATE', 'GENERIC_BUCKET', 'UNCODED')
    ),
  sample_size        integer not null default 0,
  median_hours       numeric(8,2),
  median_job_value   numeric(12,2),
  hours_p10          numeric(8,2),
  hours_p90          numeric(8,2),
  complexity_tier    smallint
    constraint chk_complexity_tier check (complexity_tier between 1 and 5),
  typical_craft_mix  jsonb,
  last_computed_at   timestamptz not null default now()
);
comment on table job_plan is
  'Job/WO complexity dimension (Blueprint v2.0 §C.2). complexity_tier is only populated when '
  'coverage_type = SPECIFIC_TEMPLATE (>=10 historical observations, not a generic catch-all '
  'code such as CM01). Generic-bucket rows fall back to Tier-B coarse flags on work_order.';

create table if not exists org_unit (
  org_id    uuid primary key default gen_random_uuid(),
  company   text,
  plant     text,
  subplant  text,
  team      text,
  unique (company, plant, subplant, team)
);
