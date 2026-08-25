-- ============================================================
-- 0003_labor_confirmation.sql
-- JV Skill Intelligence — Work Order & Labor Confirmation
-- Source: Implementation Architecture v3.0 §2.3
--
-- CRITICAL RULE (Blueprint v1/v2, Architecture v3.0 §6):
-- The source "ACTLABCOST" field is a work-order-level total cost
-- broadcast across every labor line on that WO, NOT a per-employee
-- cost. It is therefore INTENTIONALLY ABSENT from this schema.
-- It is never stored in the conformed layer. If retained anywhere,
-- it may only live inside staging_jv_labor.raw_payload for lineage.
-- ============================================================

create table if not exists work_order (
  wonum                   bigint primary key,
  description               text,
  work_type                  text not null references work_type_lookup(work_type),
  wo_ref_type                  text, -- NORMAL/MSD/ANSD/FSD/WWSD/CAPEX
  jpnum                          text references job_plan(jpnum),
  assetnum                         text,
  location                           text,
  org_id                                uuid references org_unit(org_id),
  work_close_date                        date,
  is_shutdown_turnaround                   boolean not null default false, -- wo_ref_type != 'NORMAL'
  is_emergency                               boolean not null default false  -- EMER_PLANT not null in source
);

create table if not exists labor_confirmation (
  jv_id                    uuid primary key default gen_random_uuid(),
  wonum                      bigint not null references work_order(wonum),
  employee_id                  uuid not null references employee(employee_id),
  timesheet_date                 date not null,
  regular_hrs                      numeric(8,4) not null,
  ot_hrs                              numeric(8,4) not null,
  ot1_hrs                              numeric(8,4),
  ot1_5_hrs                             numeric(8,4),
  ot2_hrs                                 numeric(8,4),
  ot3_hrs                                   numeric(8,4),
  total_hrs                                   numeric(8,4) not null,
  pay_rate                                      numeric(10,2) not null,
  factor_weight                                   numeric(4,2) not null,
  line_cost                                         numeric(14,2) not null, -- PAYRATE * TOTALHRS, verified.
                                                                             -- THE ONLY individual cost field.
  ratio_share                                         numeric(6,4),         -- FACTORHRS / SUM(FACTORHRS) on WO
  wo_job_value                                          numeric(14,2),      -- AMOUNTINCOME, WO-level total
  employee_job_value                                      numeric(14,2) not null, -- JOBVALUE, individual
  employee_job_value_reg                                    numeric(14,2),
  employee_job_value_ot                                       numeric(14,2),
  profit                                                        numeric(14,2) not null, -- employee_job_value
                                                                                         -- - line_cost, verified
  value_per_hour                                                  numeric(12,2) not null, -- employee_job_value
                                                                                           -- / total_hrs, verified
  data_quality_flag                                                 text not null
    constraint chk_dq_flag check (data_quality_flag in ('USE', 'CUT', 'ERROR')),
  source_year                                                         smallint not null,
  import_batch_id                                                       uuid not null, -- FK added in 0006
  raw_staging_ref                                                         uuid,          -- FK added in 0006
  loaded_at                                                                 timestamptz not null default now()
);

create index if not exists idx_labor_conf_emp_date on labor_confirmation (employee_id, timesheet_date);
create index if not exists idx_labor_conf_wonum on labor_confirmation (wonum);
create index if not exists idx_labor_conf_quality on labor_confirmation (data_quality_flag);
create index if not exists idx_labor_conf_batch on labor_confirmation (import_batch_id);
create index if not exists idx_labor_conf_source_year on labor_confirmation (source_year);

comment on column labor_confirmation.line_cost is
  'PAYRATE x TOTALHRS. Verified exact against real source rows (Blueprint v1). This is the '
  'ONLY field to be used as an individual employee''s labor cost anywhere in the system.';

comment on table labor_confirmation is
  'Conformed JV labor fact, one row per labor confirmation line. ACTLABCOST is deliberately '
  'not a column here (see file header). Application code must read this table only through '
  'v_labor_confirmation_safe (see 0004).';

-- The only view the application (API routes / calc-engine) is permitted to select from.
-- Filters to quality-approved rows and structurally excludes any WO-broadcast cost field.
create or replace view v_labor_confirmation_safe as
  select
    jv_id, wonum, employee_id, timesheet_date,
    regular_hrs, ot_hrs, ot1_hrs, ot1_5_hrs, ot2_hrs, ot3_hrs, total_hrs,
    pay_rate, factor_weight, line_cost, ratio_share,
    wo_job_value, employee_job_value, employee_job_value_reg, employee_job_value_ot,
    profit, value_per_hour, data_quality_flag, source_year, import_batch_id
  from labor_confirmation
  where data_quality_flag = 'USE';

comment on view v_labor_confirmation_safe is
  'THE ONLY read path for labor data used by the KPI Engine and API routes. Excludes CUT/ERROR '
  'rows and structurally cannot expose a WO-broadcast cost field, because that field does not '
  'exist in labor_confirmation at all. See Implementation Architecture v3.0 §2.3, §6.';
