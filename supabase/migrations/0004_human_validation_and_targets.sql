-- ============================================================
-- 0004_human_validation_and_targets.sql
-- JV Skill Intelligence — Human Validation & Skill Target Profile
-- Source: Implementation Architecture v3.0 §2.4
--
-- Both tables SHIP EMPTY at launch (Blueprint v2.0 §B.4/§B.5,
-- Architecture v3.0 Phase 3/4). They exist so evidence_type can
-- become BLENDED/HUMAN_VALIDATED and skill_target_profile can
-- power Layer 4 gap-to-target the moment HRBP populates them —
-- no migration is needed later, only data entry.
-- ============================================================

create table if not exists human_validation (
  validation_id          uuid primary key default gen_random_uuid(),
  employee_id               uuid not null references employee(employee_id),
  validation_type              text not null
    constraint chk_validation_type check (
      validation_type in (
        'SUPERVISOR_ASSESSMENT', 'CERTIFICATION', 'TRAINING_COMPLETION',
        'PEER_REVIEW', 'INCIDENT_REVIEW'
      )
    ),
  skill_dimension                 text,  -- references kpi_dictionary.kpi_code where
                                          -- layer = 'SKILL_INTELLIGENCE'; nullable if general
  rating_or_result                   text,
  evidence_document_ref                 text, -- pointer to Supabase Storage object, not a raw file
  validated_by                            text not null,
  validated_at                              date not null,
  expires_at                                  date,
  source                                        text not null
    constraint chk_validation_source check (
      source in ('HR_SYSTEM', 'MANUAL_ENTRY', 'LMS_EXPORT')
    ),
  created_by_user_id                              uuid, -- FK added in 0007 after app_user_profile exists
  created_at                                         timestamptz not null default now()
);
create index if not exists idx_human_validation_employee on human_validation (employee_id);

create table if not exists skill_target_profile (
  profile_id                uuid primary key default gen_random_uuid(),
  craft_code                   text not null references craft(craft_code),
  role_level                     text,
  skill_dimension                  text not null,
  target_percentile                  numeric(5,2) not null
    constraint chk_target_percentile check (target_percentile between 0 and 100),
  minimum_evidence_type                 text
    constraint chk_min_evidence_type check (
      minimum_evidence_type is null or
      minimum_evidence_type in ('SYSTEM_EVIDENCE_ONLY', 'HUMAN_VALIDATED', 'BLENDED')
    ),
  approved_by                              text not null,
  approved_at                                timestamptz not null,
  is_active                                    boolean not null default false
);
create index if not exists idx_skill_target_active on skill_target_profile (craft_code, skill_dimension)
  where is_active;

comment on table human_validation is
  'Layer 1 human-validation input (Blueprint v2.0 §B.4). Ships empty at launch — see file header.';
comment on table skill_target_profile is
  'Layer 4 target competency framework, HRBP-approved (Blueprint v2.0 §B.5, §J item 2). Ships '
  'empty at launch — Skill Gap page runs in Relative-Standing mode until this is populated.';
