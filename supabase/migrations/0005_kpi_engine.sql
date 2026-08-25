-- ============================================================
-- 0005_kpi_engine.sql
-- JV Skill Intelligence — KPI metadata & output tables
-- Source: Implementation Architecture v3.0 §2.5
-- ============================================================

create table if not exists kpi_dictionary (
  kpi_code                   text primary key,
  kpi_name                     text not null,
  business_question               text not null,
  layer                             text not null
    constraint chk_kpi_layer check (
      layer in ('PERFORMANCE_EVIDENCE', 'SKILL_INTELLIGENCE', 'LABOR_ANALYTICS', 'SKILL_GAP')
    ),
  formula_description                 text not null,
  data_source                            text not null,
  dimension                                text,
  unit                                        text not null,
  default_benchmark_method                      text,
  measurability                                    text not null
    constraint chk_measurability check (
      measurability in ('DIRECT', 'PROXY', 'REQUIRES_ADDITIONAL_DATA')
    ),
  limitation_notes                                   text,
  is_active                                            boolean not null default true
);
comment on table kpi_dictionary is
  'Machine-readable KPI Dictionary. Every row here mirrors a formula already approved in '
  'Blueprint v2.0 §D — no calc-engine function may compute a metric whose formula is not '
  'described by a row in this table. Seed content: lib/kpi-dictionary/seed-data.ts, applied '
  'via supabase/seed.sql.';

create table if not exists weight_profile (
  weight_profile_id              uuid primary key default gen_random_uuid(),
  profile_name                      text not null,
  approved_by                          text not null,
  approved_at                            timestamptz not null,
  weights_json                             jsonb not null,
  human_validation_blend_weight               numeric(4,2)
    constraint chk_blend_weight check (
      human_validation_blend_weight is null or
      human_validation_blend_weight between 0 and 1
    ),
  is_active                                    boolean not null default false
);
create unique index if not exists uq_weight_profile_one_active
  on weight_profile ((is_active)) where is_active;

create table if not exists peer_benchmark (
  benchmark_id                uuid primary key default gen_random_uuid(),
  craft_code                     text not null references craft(craft_code),
  skill_level_code                  text not null references skill_level(skill_level_code),
  complexity_tier                      smallint,   -- NULL when using Tier-B coarse grouping
  maintenance_class                       text,     -- populated when complexity_tier IS NULL
  is_shutdown_turnaround                     boolean,
  is_emergency                                  boolean,
  period_type                                     text not null,
  period_key                                        text not null,
  kpi_code                                            text not null references kpi_dictionary(kpi_code),
  p10 numeric, p25 numeric, p50 numeric, p75 numeric, p90 numeric,
  mean numeric, median numeric, mad numeric,
  sample_size                                            integer not null,
  calculated_at                                            timestamptz not null default now()
);
create index if not exists idx_peer_benchmark_lookup
  on peer_benchmark (craft_code, skill_level_code, kpi_code, period_type, period_key);

create table if not exists kpi_result (
  kpi_result_id                 uuid primary key default gen_random_uuid(),
  employee_id                      uuid references employee(employee_id),  -- NULL for org/team rows
  org_id                              uuid references org_unit(org_id),      -- NULL for individual rows
  kpi_code                              text not null references kpi_dictionary(kpi_code),
  period_type                              text not null,
  period_key                                 text not null,
  value                                        numeric(14,4),
  score_0_100                                    numeric(5,2),
  benchmark_percentile                              numeric(5,2),
  evidence_type                                       text
    constraint chk_evidence_type check (
      evidence_type is null or
      evidence_type in ('SYSTEM_EVIDENCE_ONLY', 'HUMAN_VALIDATED', 'BLENDED')
    ),
  confidence_level                                       text
    constraint chk_confidence_level check (
      confidence_level is null or confidence_level in ('HIGH', 'MEDIUM', 'LOW')
    ),
  complexity_coverage_pct                                   numeric(5,2),
  record_count                                                integer,
  weight_profile_id                                             uuid references weight_profile(weight_profile_id),
  target_profile_id                                               uuid references skill_target_profile(profile_id),
  calc_engine_version                                               text not null,
  calculated_at                                                       timestamptz not null default now(),
  import_batch_id                                                       uuid, -- FK added in 0006
  constraint uq_kpi_result unique (employee_id, org_id, kpi_code, period_type, period_key, weight_profile_id)
);
create index if not exists idx_kpi_result_employee_period on kpi_result (employee_id, period_type, period_key);
create index if not exists idx_kpi_result_kpi_code on kpi_result (kpi_code);

-- ============================================================
-- Enforcement (Architecture v3.0 §2.5 / §6): every kpi_result row
-- whose kpi_dictionary.layer is SKILL_INTELLIGENCE or SKILL_GAP
-- MUST carry evidence_type + confidence_level. Enforced via a
-- BEFORE INSERT/UPDATE trigger (Postgres CHECK constraints cannot
-- subquery another table).
-- ============================================================
create or replace function fn_enforce_skill_layer_evidence_type()
returns trigger as $$
declare
  v_layer text;
begin
  select layer into v_layer from kpi_dictionary where kpi_code = new.kpi_code;

  if v_layer in ('SKILL_INTELLIGENCE', 'SKILL_GAP') then
    if new.evidence_type is null or new.confidence_level is null then
      raise exception
        'kpi_result for a % KPI (kpi_code=%) must set evidence_type and confidence_level '
        '(Blueprint v2.0 / Architecture v3.0 §6 enforcement rule)', v_layer, new.kpi_code;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_skill_layer_evidence_type on kpi_result;
create trigger trg_enforce_skill_layer_evidence_type
  before insert or update on kpi_result
  for each row execute function fn_enforce_skill_layer_evidence_type();
