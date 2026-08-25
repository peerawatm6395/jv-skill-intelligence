# JV Skill Intelligence

Workforce analytics platform for HRBP and management, built on **Blueprint v2.0** and
**Implementation Architecture v3.0** (see `docs/`). Organizes all analytics into four
hard-separated layers:

1. **Skill Intelligence** — what we believe about capability, always evidence-tagged
2. **Performance Evidence** — what the system observed, complexity-normalized, never itself called "skill"
3. **Productivity / Labor Analytics** — workload/scheduling metrics, no skill inference
4. **Skill Gap & Development** — target-vs-current, always pending human review

## Non-negotiable rules (enforced in code, not just policy)

- `SKILLLEVEL` is never a skill-score input — administrative pay tier only.
- Labor hours and labor cost are never skill-score inputs directly, only ratio denominators.
- The source `ACTLABCOST` field (work-order-broadcast cost) **does not exist anywhere in this
  schema**. The only individual employee cost field is `line_cost` (`PAYRATE × TOTALHRS`).
- Every `kpi_result` row for a `SKILL_INTELLIGENCE`/`SKILL_GAP` KPI **must** have
  `evidence_type` and `confidence_level` set — enforced by a Postgres trigger
  (`0005_kpi_engine.sql`), not just application logic.
- No KPI formula differs from Blueprint v2.0 §D. See `supabase/seed.sql` and
  `lib/calc-engine/`.

## Stack

Next.js 15 (App Router) + TypeScript · Supabase (Postgres + Auth + Storage) · Vercel · Tailwind

## Setup

```bash
npm install

# 1. Create a Supabase project, then apply migrations in order:
#    (via the Supabase SQL editor, or the Supabase CLI: supabase db push)
for f in supabase/migrations/*.sql; do echo "apply $f"; done

# 2. Load reference data (KPI Dictionary, work-type crosswalk, import
#    mapping profiles) — contains NO employee/JV data, safe to commit/share:
#    run supabase/seed.sql

# 3. Copy env template and fill in your Supabase project's values
cp .env.example .env.local

# 4. Run the app
npm run dev
```

### Demo / synthetic data (no real employee data)

```bash
npm run seed
```

Generates ~30 fictional employees (labor codes starting at 900000, generated names,
clearly marked "(Demo)") and synthetic labor confirmations, then runs the KPI Engine
over them so every dashboard page has something to render. Requires at least one
`app_user_profile` row to exist first (create a Supabase Auth user, then insert a
matching profile row with `role='ADMIN'`).

### Uploading real monthly JV data

Go to `/admin/import`, pick the matching column-mapping profile (or add a new one at
`/admin/import-mapping` if the file's column shape has changed — no code change needed,
see Architecture v3.0 §3.2), and upload. The pipeline runs Upload → Validate → Staging →
Data Quality Check → Import → KPI Calculation automatically.

**Real JV/employee data must never be committed to this repository.** `.gitignore`
blocks `*.xlsx`, `*.csv`, `.env*`, and `/data/` for this reason.

## Testing

```bash
npm run test        # calc-engine + import-pipeline unit tests (formula regression tests)
npm run typecheck
npm run lint
npm run build
```

The formula tests in `lib/calc-engine/__tests__/formulas.test.ts` are regression-pinned
against real fixture values found during the original JV data analysis (Blueprint v1.0) —
they exist specifically to catch any future change to `LINECOST`/`PROFIT`/`value_per_hour`
math that isn't an approved Blueprint revision.

## Documentation

- `docs/blueprint-v2.md` — KPI methodology, 4-layer framework, data dictionary
- `docs/implementation-architecture-v3.md` — DB schema, import pipeline, dashboard specs, roadmap

## Project status

Phase 1 (foundation: schema, KPI engine, import pipeline, API, RBAC) and Phase 2
(dashboard UI) scaffolding are implemented per the approved roadmap. Skill Intelligence
ships with every score labeled `SYSTEM_EVIDENCE_ONLY` until HRBP begins entering
`human_validation` records, and Skill Gap runs in Relative Standing mode until HRBP
populates `skill_target_profile` — both by design, not oversight (see Architecture v3.0
§J for the full list of decisions pending HRBP/Engineering approval).
