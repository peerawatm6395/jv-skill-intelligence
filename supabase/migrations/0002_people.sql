-- ============================================================
-- 0002_people.sql
-- JV Skill Intelligence — Supervisor & Employee (SCD Type 2)
-- Source: Implementation Architecture v3.0 §2.2
-- ============================================================

create table if not exists supervisor (
  supervisor_id       uuid primary key default gen_random_uuid(),
  supervisor_code     bigint not null,
  supervisor_name     text not null,
  linked_employee_id  uuid,  -- FK added after employee table exists, below
  is_active           boolean not null default true,
  unique (supervisor_code)
);

create table if not exists employee (
  employee_id            uuid primary key default gen_random_uuid(),
  labor_code              bigint not null,
  display_name             text not null,
  thai_name                  text,
  employee_type               text, -- 'M' | 'D', 2026+ source only
  craft_code                   text not null references craft(craft_code),
  skill_level_code               text not null references skill_level(skill_level_code),
  supervisor_id                    uuid references supervisor(supervisor_id),
  org_id                             uuid references org_unit(org_id),
  effective_from                      date not null,
  effective_to                          date,
  is_current                              boolean not null default true,
  created_from_batch_id                     uuid, -- FK added in 0006 after data_import_batch exists
  unique (labor_code, effective_from)
);

create index if not exists idx_employee_current
  on employee (labor_code) where is_current;
create index if not exists idx_employee_craft_skill
  on employee (craft_code, skill_level_code) where is_current;

alter table supervisor
  add constraint fk_supervisor_employee
  foreign key (linked_employee_id) references employee(employee_id);

-- Guard: an employee natural key (labor_code) may have at most one CURRENT version
create unique index if not exists uq_employee_one_current
  on employee (labor_code) where is_current;

comment on table employee is
  'Slowly Changing Dimension (Type 2). A labor_confirmation row links to the employee '
  'version whose [effective_from, effective_to) window contains its timesheet_date, not the '
  'employee''s current profile — protects historical scores from being rewritten by a later '
  'craft/skill_level change. skill_level_code is an administrative pay tier only (see 0001).';
