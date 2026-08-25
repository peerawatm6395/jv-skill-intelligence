-- ============================================================
-- 0006_import_pipeline.sql
-- JV Skill Intelligence — Excel Import Pipeline tables
-- Source: Implementation Architecture v3.0 §2.6, §3
-- ============================================================

create table if not exists import_column_mapping_profile (
  profile_id                 uuid primary key default gen_random_uuid(),
  profile_name                  text not null,
  effective_from                   date not null,
  effective_to                       date,
  sheet_name_pattern                    text,
  column_mapping                          jsonb not null,   -- { "LABORCODE": "labor_code", ... }
  required_columns                          jsonb not null, -- [ "LABORCODE", "CRAFT", ... ]
  derived_field_rules                          jsonb,        -- e.g. rule to derive category_bg from
                                                              -- work_type+wo_ref_type when a source
                                                              -- column (like 2026's missing TYPE_BG) is absent
  is_active                                       boolean not null default true
);
comment on table import_column_mapping_profile is
  'The mechanism that lets a new monthly file with a different column shape (e.g. the '
  'observed 2026 drop of TYPE_BG / addition of EMPLOYEETYPE) be handled by adding a ROW here, '
  'not by changing application code. See Architecture v3.0 §3.2.';

create table if not exists data_import_batch (
  batch_id                    uuid primary key default gen_random_uuid(),
  source_filename                 text not null,
  uploaded_by_user_id                uuid not null, -- FK added in 0007 after app_user_profile exists
  uploaded_at                          timestamptz not null default now(),
  storage_object_path                     text not null,
  mapping_profile_id                         uuid references import_column_mapping_profile(profile_id),
  period_covered                                text, -- e.g. '2026-07'
  status                                          text not null default 'UPLOADED'
    constraint chk_batch_status check (
      status in (
        'UPLOADED', 'VALIDATING', 'STAGED', 'QUALITY_CHECK', 'IMPORTED',
        'FAILED', 'PARTIALLY_IMPORTED', 'SUPERSEDED'
      )
    ),
  row_count_raw                                     integer,
  row_count_staged                                    integer,
  row_count_imported                                    integer,
  row_count_rejected                                       integer,
  replaces_batch_id                                          uuid references data_import_batch(batch_id),
  validation_summary                                            jsonb,
  error_log                                                       jsonb,
  kpi_calculation_triggered_at                                       timestamptz,
  kpi_calculation_completed_at                                         timestamptz
);
create index if not exists idx_import_batch_status on data_import_batch (status);
create index if not exists idx_import_batch_period on data_import_batch (period_covered);

create table if not exists staging_jv_labor (
  staging_id                 uuid primary key default gen_random_uuid(),
  batch_id                      uuid not null references data_import_batch(batch_id),
  source_sheet                     text not null,
  source_row_num                      integer not null,
  raw_payload                            jsonb not null,  -- every original column, untouched
  mapped_payload                            jsonb,          -- after column_mapping applied
  validation_status                            text not null default 'PENDING'
    constraint chk_staging_status check (validation_status in ('PENDING', 'VALID', 'INVALID')),
  promoted_to_labor_confirmation                  boolean not null default false
);
create index if not exists idx_staging_batch on staging_jv_labor (batch_id, validation_status);

create table if not exists data_quality_issue (
  issue_id                    uuid primary key default gen_random_uuid(),
  batch_id                       uuid not null references data_import_batch(batch_id),
  staging_id                        uuid references staging_jv_labor(staging_id),
  issue_type                           text not null
    constraint chk_issue_type check (
      issue_type in (
        'SCHEMA_DRIFT', 'CUT_FLAG', 'DIV_ZERO_ERROR', 'NEGATIVE_OUTLIER',
        'MISSING_REQUIRED_FIELD', 'DUPLICATE_ROW', 'DATE_OUT_OF_RANGE',
        'UNRECOGNIZED_JPNUM', 'UNRECOGNIZED_WORKTYPE', 'UNRECOGNIZED_CRAFT',
        'FORMULA_MISMATCH'
      )
    ),
  severity                                text not null
    constraint chk_issue_severity check (severity in ('BLOCKING', 'WARNING', 'INFO')),
  field_name                                 text,
  raw_value                                     text,
  detected_at                                     timestamptz not null default now(),
  resolved                                          boolean not null default false,
  resolved_by_user_id                                  uuid, -- FK added in 0007
  resolution_note                                        text
);
create index if not exists idx_dqi_batch on data_quality_issue (batch_id, severity, resolved);

-- ---- Deferred foreign keys now that data_import_batch exists ----
alter table employee
  add constraint fk_employee_import_batch
  foreign key (created_from_batch_id) references data_import_batch(batch_id);

alter table labor_confirmation
  add constraint fk_labor_conf_import_batch
  foreign key (import_batch_id) references data_import_batch(batch_id);

alter table labor_confirmation
  add constraint fk_labor_conf_staging
  foreign key (raw_staging_ref) references staging_jv_labor(staging_id);

alter table kpi_result
  add constraint fk_kpi_result_import_batch
  foreign key (import_batch_id) references data_import_batch(batch_id);
