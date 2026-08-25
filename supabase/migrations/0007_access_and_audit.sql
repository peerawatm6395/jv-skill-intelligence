-- ============================================================
-- 0007_access_and_audit.sql
-- JV Skill Intelligence — Roles, users, audit log
-- Source: Implementation Architecture v3.0 §2.7, §8
-- ============================================================

create table if not exists app_user_profile (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  email                  text not null,
  full_name                text,
  role                        text not null
    constraint chk_user_role check (role in ('ADMIN', 'HRBP', 'MANAGER', 'SUPERVISOR', 'VIEWER')),
  scoped_org_id                 uuid references org_unit(org_id),      -- MANAGER/SUPERVISOR scoping
  linked_employee_id               uuid references employee(employee_id), -- SUPERVISOR/VIEWER self-service
  is_active                          boolean not null default true,
  created_at                            timestamptz not null default now()
);

create table if not exists audit_log (
  audit_id            bigserial primary key,
  user_id                uuid references app_user_profile(user_id),
  action                    text not null,
  target_employee_id           uuid,
  target_batch_id                 uuid,
  detail                             jsonb,
  occurred_at                           timestamptz not null default now()
);
create index if not exists idx_audit_log_user on audit_log (user_id, occurred_at desc);
create index if not exists idx_audit_log_target_employee on audit_log (target_employee_id);

-- ---- Deferred foreign keys now that app_user_profile exists ----
alter table data_import_batch
  add constraint fk_import_batch_uploaded_by
  foreign key (uploaded_by_user_id) references app_user_profile(user_id);

alter table data_quality_issue
  add constraint fk_dqi_resolved_by
  foreign key (resolved_by_user_id) references app_user_profile(user_id);

alter table human_validation
  add constraint fk_human_validation_created_by
  foreign key (created_by_user_id) references app_user_profile(user_id);

-- ============================================================
-- Row-Level Security (Architecture v3.0 §8.2)
-- Defense-in-depth alongside API-route RBAC checks (lib/auth/rbac.ts)
-- ============================================================

alter table employee enable row level security;
alter table kpi_result enable row level security;
alter table labor_confirmation enable row level security;
alter table human_validation enable row level security;
alter table app_user_profile enable row level security;
alter table audit_log enable row level security;

-- Helper: current caller's profile (role + scope), read via auth.uid()
create or replace function fn_current_user_profile()
returns table (role text, scoped_org_id uuid, linked_employee_id uuid) as $$
  select role, scoped_org_id, linked_employee_id
  from app_user_profile
  where user_id = auth.uid()
$$ language sql stable security definer;

-- app_user_profile: everyone can read their own row; ADMIN can read/manage all
create policy p_user_profile_self_select on app_user_profile
  for select using (
    user_id = auth.uid()
    or exists (select 1 from fn_current_user_profile() p where p.role = 'ADMIN')
  );

-- employee: ADMIN/HRBP see all; MANAGER/SUPERVISOR see their org/team scope; VIEWER sees self
create policy p_employee_scoped_select on employee
  for select using (
    exists (
      select 1 from fn_current_user_profile() p
      where p.role in ('ADMIN', 'HRBP')
         or (p.role in ('MANAGER', 'SUPERVISOR') and p.scoped_org_id = employee.org_id)
         or (p.role = 'VIEWER' and p.linked_employee_id = employee.employee_id)
    )
  );

-- kpi_result: same scoping pattern, joined through employee.org_id
create policy p_kpi_result_scoped_select on kpi_result
  for select using (
    exists (
      select 1 from fn_current_user_profile() p
      where p.role in ('ADMIN', 'HRBP')
         or (
           p.role in ('MANAGER', 'SUPERVISOR')
           and exists (
             select 1 from employee e
             where e.employee_id = kpi_result.employee_id and e.org_id = p.scoped_org_id
           )
         )
         or (p.role = 'VIEWER' and p.linked_employee_id = kpi_result.employee_id)
    )
    or kpi_result.org_id is not null  -- org/team-level rows visible per separate org-scope check below
  );

-- labor_confirmation: only ADMIN/HRBP/MANAGER/SUPERVISOR (never raw evidence for VIEWER role)
create policy p_labor_confirmation_scoped_select on labor_confirmation
  for select using (
    exists (
      select 1 from fn_current_user_profile() p
      where p.role in ('ADMIN', 'HRBP')
         or (
           p.role in ('MANAGER', 'SUPERVISOR')
           and exists (
             select 1 from employee e
             where e.employee_id = labor_confirmation.employee_id and e.org_id = p.scoped_org_id
           )
         )
    )
  );

-- human_validation: ADMIN/HRBP all; SUPERVISOR own team; VIEWER own record (read-only)
create policy p_human_validation_scoped_select on human_validation
  for select using (
    exists (
      select 1 from fn_current_user_profile() p
      where p.role in ('ADMIN', 'HRBP')
         or (
           p.role = 'SUPERVISOR'
           and exists (
             select 1 from employee e
             where e.employee_id = human_validation.employee_id and e.org_id = p.scoped_org_id
           )
         )
         or (p.role = 'VIEWER' and p.linked_employee_id = human_validation.employee_id)
    )
  );

create policy p_human_validation_supervisor_insert on human_validation
  for insert with check (
    exists (
      select 1 from fn_current_user_profile() p
      where p.role in ('ADMIN', 'HRBP')
         or (
           p.role = 'SUPERVISOR'
           and exists (
             select 1 from employee e
             where e.employee_id = human_validation.employee_id and e.org_id = p.scoped_org_id
           )
         )
    )
  );

-- audit_log: ADMIN/HRBP only
create policy p_audit_log_admin_select on audit_log
  for select using (
    exists (select 1 from fn_current_user_profile() p where p.role in ('ADMIN', 'HRBP'))
  );

comment on function fn_current_user_profile() is
  'security definer helper so RLS policies can look up the caller''s role/scope without '
  'recursively re-triggering RLS on app_user_profile itself.';
