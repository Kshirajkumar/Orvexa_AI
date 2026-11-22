# Extraction staging verification

**Checked:** 22 November 2026
**Project:** Taxflow-Ai (`hqrwiklerptzqxnubmpv`)
**Method:** read-only Supabase inspection; no SQL write or migration was executed

## Confirmed live state

- Project status is `ACTIVE_HEALTHY`, region `ap-south-1`, PostgreSQL `17.11`.
- `pgcrypto` is installed in the `extensions` schema.
- `public.extraction_versions` exists and already contains `extraction_run_id`.
- `public.extraction_runs` does not exist.
- `extraction_versions.source_data` does not exist.
- `ai_usage_log.usage_source` does not exist.
- The live database exposes only the existing `save_extraction_version(uuid, uuid, text, jsonb, numeric, numeric, text, integer, text, jsonb)` function among the new extraction version functions.
- The live `save_extraction_version` definition does not use the qualified `extensions.digest` call.

## Advisor findings relevant to this tranche

- Supabase reports RLS enabled without policies on `extraction_versions` and `extraction_events`. This is consistent with the current service-role-only backend access model, but must be confirmed after the migration and before any direct client access is introduced.
- Supabase reports a mutable search path on the existing `update_updated_at_column` function.
- Supabase performance advisors flag the extraction foreign-key columns as unindexed in the live project. The repository migrations now add covering indexes for extraction version/event ownership and document lookups; verify them after staging application.
- Supabase reports six existing `SECURITY DEFINER` functions executable by `anon` and `authenticated`, plus leaked-password protection disabled. These are broader existing project findings and are not silently changed by this extraction tranche.

## Required next step

Apply the repository SQL to a non-production staging target in the documented order, then rerun the verification queries for:

1. `extensions.digest` resolution and the repaired `save_extraction_version` definition.
2. `extraction_runs`, `source_data`, and `usage_source` presence.
3. `approve_extraction_data` and `restore_extraction_version` existence and grants.
4. RLS, service-role grants, and advisor output.

Production migration remains intentionally unexecuted. The repository is not deployment-complete until these checks pass against the intended staging environment.
