-- ============================================================
-- seed.sql — reference data safe to commit to GitHub.
-- Contains NO employee data and NO real JV records — only KPI
-- metadata, work-type crosswalks, and import mapping profiles,
-- all derived from the approved Blueprint v2.0 / Architecture v3.0.
-- ============================================================

-- ---------- work_type_lookup (crosswalk verified in Blueprint v1/v2 §0) ----------
insert into work_type_lookup (work_type, category_bg, maintenance_class) values
  ('CM',  'Corrective Maintenance', 'REACTIVE'),
  ('BD',  'Break Down',             'REACTIVE'),
  ('IN',  'Preventive Maintenance', 'PLANNED'),
  ('PM',  'Preventive Maintenance', 'PLANNED'),
  ('PDM', 'Predictive Maintenance', 'PLANNED'),
  ('RVM', 'Renovate',               'CAPEX_RENOVATE'),
  ('RVG', 'Renovate',               'CAPEX_RENOVATE'),
  ('CPM', 'Capex',                  'CAPEX_RENOVATE'),
  ('CPO', 'Capex',                  'CAPEX_RENOVATE'),
  ('ADM', 'Corrective Maintenance', 'ADMIN')
on conflict (work_type) do nothing;

-- ---------- kpi_dictionary (Architecture v3.0 §5 — formulas copied from Blueprint v2.0 §D) ----------
insert into kpi_dictionary
  (kpi_code, kpi_name, business_question, layer, formula_description, data_source, dimension,
   unit, default_benchmark_method, measurability, limitation_notes)
values
(
  'PERF_PRODUCTIVITY_ADJ', 'Complexity-Adjusted Productivity',
  'How much value did this employee generate per hour, relative to peers doing comparably complex work?',
  'PERFORMANCE_EVIDENCE',
  'SUM(employee_job_value) / SUM(total_hrs), percentile-ranked within peer group',
  'v_labor_confirmation_safe.employee_job_value, .total_hrs; job_plan for complexity tier',
  'Craft x Skill Level x Complexity Tier (Tier A) or x Maintenance Class/Shutdown/Emergency (Tier B)',
  'THB/hour (raw); 0-100 percentile (normalized)',
  'Peer group percentile, winsorized p1/p99, min sample size 5',
  'PROXY',
  'Reflects value generated, not technique. Complexity normalization is coarse (Tier B) for the '
  '~88-93% of rows on the generic CM01-class job plan bucket (Blueprint v2.0 SS C.2).'
),
(
  'PERF_COST_EFFICIENCY', 'Work / Cost Efficiency Evidence',
  'How much value did this employee generate per baht of labor cost?',
  'PERFORMANCE_EVIDENCE',
  'SUM(employee_job_value) / SUM(line_cost) -- NEVER the WO-broadcast cost field',
  'v_labor_confirmation_safe.employee_job_value, .line_cost',
  'Craft x Skill Level x Complexity Tier (same grouping as PERF_PRODUCTIVITY_ADJ)',
  'ratio; 0-100 percentile',
  'Peer group percentile, winsorized p1/p99, min sample size 5',
  'DIRECT',
  'Mechanically correlated with PERF_PRODUCTIVITY_ADJ (shared numerator) -- documented, not independent.'
),
(
  'PERF_PM_VALUE', 'PM Value Evidence',
  'How efficiently does this employee generate value on planned/preventive work?',
  'PERFORMANCE_EVIDENCE',
  'SUM(employee_job_value WHERE maintenance_class=PLANNED) / SUM(total_hrs WHERE maintenance_class=PLANNED)',
  'v_labor_confirmation_safe filtered to maintenance_class=PLANNED',
  'Craft x Skill Level x Complexity Tier, PLANNED work only',
  'THB/hour; 0-100 percentile',
  'Peer group percentile within PLANNED work',
  'PROXY',
  'Says nothing about schedule adherence. PMNUM fill rate only 6.4%% in source; no PM due-date '
  'table exists -- on-time PM completion rate is REQUIRES_ADDITIONAL_DATA, not this KPI.'
),
(
  'PERF_CM_VALUE', 'CM Value Evidence',
  'How efficiently does this employee generate value on corrective/reactive work?',
  'PERFORMANCE_EVIDENCE',
  'SUM(employee_job_value WHERE maintenance_class=REACTIVE) / SUM(total_hrs WHERE maintenance_class=REACTIVE)',
  'v_labor_confirmation_safe filtered to maintenance_class=REACTIVE',
  'Craft x Skill Level x Complexity Tier, REACTIVE work only',
  'THB/hour; 0-100 percentile',
  'Peer group percentile within REACTIVE work',
  'PROXY',
  'Reactive-work severity not controlled for beyond coarse Tier-B flags. No reopen/callback '
  'field exists -- diagnostic accuracy/rework rate is REQUIRES_ADDITIONAL_DATA.'
),
(
  'PERF_TECHNICAL_RANGE', 'Technical Range Evidence (proxy)',
  'How broad and value-efficient is this employee''s exposure to diagnostically harder (reactive) work?',
  'PERFORMANCE_EVIDENCE',
  'Composite percentile of (PERF_CM_VALUE) + (distinct asset/work-type breadth) + (emergency participation rate)',
  'PERF_CM_VALUE result + distinct-count aggregates + is_emergency flag',
  'Craft',
  '0-100 percentile',
  'Percentile within craft',
  'PROXY',
  'NOT a technical-skill measurement -- no defect/rework/QA-pass field exists in source data. '
  'Must be labeled "proxy" wherever shown (Blueprint v2.0 SS D.1.5, SS J item 5).'
),
(
  'PERF_BREADTH', 'Skill Breadth Evidence',
  'How diverse is this employee''s work exposure this period?',
  'PERFORMANCE_EVIDENCE',
  'Percentile-ranked distinct counts (work_type, assetnum, plant), averaged',
  'v_labor_confirmation_safe distinct-count aggregates',
  'Craft',
  '0-100 percentile',
  'Percentile within craft',
  'DIRECT',
  'Driven partly by supervisor assignment/scheduling decisions, not solely by employee initiative.'
),
(
  'SKILL_DIM_PRODUCTIVITY', 'Productivity (Skill Indicator)',
  'What do we believe about this employee''s capability on productivity, and how confident are we?',
  'SKILL_INTELLIGENCE',
  'SYSTEM_EVIDENCE_ONLY: score = PERF_PRODUCTIVITY_ADJ percentile. BLENDED: '
  'weight * validation_score + (1-weight) * performance_evidence_percentile',
  'PERF_PRODUCTIVITY_ADJ result + human_validation (if any)',
  'per skill dimension',
  '0-100 score',
  'Inherited from Layer 2 peer group',
  'PROXY',
  'Effectively SYSTEM_EVIDENCE_ONLY at launch since human_validation ships empty. Labeled '
  '"Indicator" not "Rating" until evidence_type reaches HUMAN_VALIDATED/BLENDED.'
),
(
  'SKILL_DIM_COST_EFFICIENCY', 'Cost Efficiency (Skill Indicator)',
  'What do we believe about this employee''s capability on cost efficiency, and how confident are we?',
  'SKILL_INTELLIGENCE',
  'SYSTEM_EVIDENCE_ONLY: score = PERF_COST_EFFICIENCY percentile. BLENDED: same blend formula as above.',
  'PERF_COST_EFFICIENCY result + human_validation (if any)', 'per skill dimension', '0-100 score',
  'Inherited from Layer 2 peer group', 'PROXY',
  'Same evidence-type caveat as SKILL_DIM_PRODUCTIVITY.'
),
(
  'SKILL_DIM_PM', 'PM Skill (Indicator)',
  'What do we believe about this employee''s capability on preventive/predictive maintenance work?',
  'SKILL_INTELLIGENCE',
  'SYSTEM_EVIDENCE_ONLY: score = PERF_PM_VALUE percentile. BLENDED: same blend formula.',
  'PERF_PM_VALUE result + human_validation (if any)', 'per skill dimension', '0-100 score',
  'Inherited from Layer 2 peer group', 'PROXY',
  'Same evidence-type caveat; excludes schedule-adherence (not measurable).'
),
(
  'SKILL_DIM_CM', 'CM Skill (Indicator)',
  'What do we believe about this employee''s capability on corrective/reactive maintenance work?',
  'SKILL_INTELLIGENCE',
  'SYSTEM_EVIDENCE_ONLY: score = PERF_CM_VALUE percentile. BLENDED: same blend formula.',
  'PERF_CM_VALUE result + human_validation (if any)', 'per skill dimension', '0-100 score',
  'Inherited from Layer 2 peer group', 'PROXY',
  'Same evidence-type caveat; excludes diagnostic-accuracy/rework (not measurable).'
),
(
  'SKILL_DIM_TECHNICAL', 'Technical Skill (Indicator -- proxy)',
  'What do we believe about this employee''s technical range, and how confident are we?',
  'SKILL_INTELLIGENCE',
  'SYSTEM_EVIDENCE_ONLY: score = PERF_TECHNICAL_RANGE percentile. BLENDED: same blend formula.',
  'PERF_TECHNICAL_RANGE result + human_validation (if any)', 'per skill dimension', '0-100 score',
  'Inherited from Layer 2 peer group', 'PROXY',
  'Explicitly a proxy -- see PERF_TECHNICAL_RANGE limitation. HRBP to confirm whether to ship '
  '(Architecture v3.0 SS J item 5).'
),
(
  'SKILL_DIM_BREADTH', 'Skill Breadth (Indicator)',
  'What do we believe about this employee''s breadth of capability, and how confident are we?',
  'SKILL_INTELLIGENCE',
  'SYSTEM_EVIDENCE_ONLY: score = PERF_BREADTH percentile. BLENDED: same blend formula.',
  'PERF_BREADTH result + human_validation (if any)', 'per skill dimension', '0-100 score',
  'Inherited from Layer 2 peer group', 'DIRECT',
  'Same evidence-type caveat as SKILL_DIM_PRODUCTIVITY.'
),
(
  'SKILL_OVERALL', 'Overall Skill Rating',
  'What''s this employee''s overall skill standing, and how confident are we in that number?',
  'SKILL_INTELLIGENCE',
  'SUM(weight_i * dimension_score_i) via active weight_profile.weights_json',
  'All SKILL_DIM_* results for the period', 'n/a (composite)', '0-100 score',
  'n/a (composite of already-benchmarked dimensions)', 'PROXY',
  'evidence_type/confidence_level set to the WEAKEST contributing dimension, never averaged up. '
  'Weight profile itself is an open decision (Architecture v3.0 SS J item 4).'
),
(
  'LABOR_OT_RATIO', 'OT Ratio & Tier Mix',
  'How much overtime is this employee/team working, and what kind?',
  'LABOR_ANALYTICS',
  'SUM(ot_hrs) / SUM(total_hrs); OT1/1.5/2/3 tier shares',
  'v_labor_confirmation_safe hour fields', 'Craft/Team', '% (ratio)',
  'Peer percentile within craft/team, descriptive only', 'DIRECT',
  'High OT can mean responsiveness (positive, esp. if is_emergency) or overload (organizational) '
  '-- direction is NOT asserted by this KPI and it is NOT part of Skill Intelligence '
  '(Blueprint v2.0 SS D.3.1).'
),
(
  'LABOR_UTILIZATION', 'Utilization / Coverage',
  'How is work distributed across teams/plants -- planned vs reactive, emergency load?',
  'LABOR_ANALYTICS',
  'Hours logged vs period; emergency-hours share; planned-vs-reactive mix',
  'v_labor_confirmation_safe team/org aggregates', 'Team/Plant', 'hours, %',
  'Team-to-team, plant-to-plant comparison', 'PROXY',
  '"Available working days" not in source data -- true utilization vs scheduled shifts '
  'REQUIRES an attendance/roster feed not currently available.'
),
(
  'GAP_SIZE', 'Skill Gap Size',
  'How far is this employee from the target standard for this dimension, and is the gap confirmed?',
  'SKILL_GAP',
  'MAX(0, target_percentile - current_score)',
  'SKILL_DIM_* result + skill_target_profile', 'per skill dimension x craft', 'percentile points',
  'The HRBP-approved target itself', 'REQUIRES_ADDITIONAL_DATA',
  'skill_target_profile does not exist yet (ships empty) -- this KPI cannot run in '
  'gap-to-target mode until HRBP populates it. Until then the UI shows Relative Standing instead.'
)
on conflict (kpi_code) do nothing;

-- ---------- import_column_mapping_profile (observed 2024/2025 shape and 2026 shape) ----------
insert into import_column_mapping_profile
  (profile_name, effective_from, sheet_name_pattern, column_mapping, required_columns, derived_field_rules, is_active)
values
(
  'JV Export 2024-2025 shape',
  '2024-01-01',
  'JV%',
  '{
    "LABORCODE":"labor_code","DISPLAYNAME":"display_name","ZTHAINAME":"thai_name",
    "CRAFT":"craft_code","SKILLLEVEL":"skill_level_code","WONUM":"wonum",
    "DESCRIPTION":"description","WORKTYPE":"work_type","ZWOREFTYPE":"wo_ref_type",
    "JPNUM":"jpnum","ASSETNUM":"assetnum","LOCATION":"location",
    "SUPERVISOR":"supervisor_code","SUP_NAME":"supervisor_name",
    "ZCOMPANY":"company","ZPLANT":"plant","ZSUBPLANT":"subplant","TEAM":"team",
    "TIMESHEETDATE":"timesheet_date","WORKCLOSEDATE":"work_close_date",
    "REGULARHRS":"regular_hrs","OTHRS":"ot_hrs","OT1":"ot1_hrs","OT1_5":"ot1_5_hrs",
    "OT2":"ot2_hrs","OT3":"ot3_hrs","TOTALHRS":"total_hrs","PAYRATE":"pay_rate",
    "FACTOR":"factor_weight","AMOUNTINCOME":"wo_job_value","RATIO":"ratio_share",
    "JOBVALUE":"employee_job_value","JOBVALUEREG":"employee_job_value_reg",
    "JOBVALUEOT":"employee_job_value_ot","PROFIT":"profit_source",
    "EMER_PLANT":"emer_plant","YEAR":"source_year","\u0e15\u0e31\u0e14":"data_quality_flag_source",
    "TYPE_BG":"category_bg_source"
  }'::jsonb,
  '["LABORCODE","CRAFT","SKILLLEVEL","WONUM","WORKTYPE","TIMESHEETDATE","REGULARHRS","OTHRS",
    "TOTALHRS","PAYRATE","FACTOR","AMOUNTINCOME","RATIO","JOBVALUE","PROFIT","\u0e15\u0e31\u0e14"]'::jsonb,
  '{"note":"TYPE_BG column present in this shape -- used directly, no derivation needed"}'::jsonb,
  true
),
(
  'JV Export 2026+ shape (TYPE_BG absent, EMPLOYEETYPE added)',
  '2026-01-01',
  'JV%',
  '{
    "LABORCODE":"labor_code","DISPLAYNAME":"display_name","ZTHAINAME":"thai_name",
    "CRAFT":"craft_code","SKILLLEVEL":"skill_level_code","EMPLOYEETYPE":"employee_type",
    "WONUM":"wonum","DESCRIPTION":"description","WORKTYPE":"work_type","ZWOREFTYPE":"wo_ref_type",
    "JPNUM":"jpnum","ASSETNUM":"assetnum","LOCATION":"location",
    "SUPERVISOR":"supervisor_code","SUP_NAME":"supervisor_name",
    "ZCOMPANY":"company","ZPLANT":"plant","ZSUBPLANT":"subplant","TEAM":"team",
    "TIMESHEETDATE":"timesheet_date","WORKCLOSEDATE":"work_close_date",
    "REGULARHRS":"regular_hrs","OTHRS":"ot_hrs","OT1":"ot1_hrs","OT1_5":"ot1_5_hrs",
    "OT2":"ot2_hrs","OT3":"ot3_hrs","TOTALHRS":"total_hrs","PAYRATE":"pay_rate",
    "FACTOR":"factor_weight","AMOUNTINCOME":"wo_job_value","RATIO":"ratio_share",
    "JOBVALUE":"employee_job_value","JOBVALUEREG":"employee_job_value_reg",
    "JOBVALUEOT":"employee_job_value_ot","PROFIT":"profit_source",
    "EMER_PLANT":"emer_plant","YEAR":"source_year","\u0e15\u0e31\u0e14":"data_quality_flag_source",
    "\u0e2d\u0e1a\u0e23\u0e21":"training_flag_source"
  }'::jsonb,
  '["LABORCODE","CRAFT","SKILLLEVEL","WONUM","WORKTYPE","TIMESHEETDATE","REGULARHRS","OTHRS",
    "TOTALHRS","PAYRATE","FACTOR","AMOUNTINCOME","RATIO","JOBVALUE","PROFIT","\u0e15\u0e31\u0e14"]'::jsonb,
  '{"category_bg_source":{"derive_from":["work_type","wo_ref_type"],
     "method":"crosswalk lookup against work_type_lookup + wo_ref_type shutdown mapping",
     "reason":"TYPE_BG column absent in this shape (observed 2026 schema drift)"}}'::jsonb,
  true
)
on conflict do nothing;
