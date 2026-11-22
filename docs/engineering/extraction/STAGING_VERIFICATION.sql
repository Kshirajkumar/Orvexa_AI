-- Read-only staging checks for the extraction reliability tranche.
-- Do not run this file as a migration. It must not modify data or schema.

SELECT extname, extnamespace::regnamespace::text AS extension_schema
FROM pg_extension
WHERE extname = 'pgcrypto';

SELECT to_regclass('public.extraction_runs') AS extraction_runs,
       to_regclass('public.extraction_versions') AS extraction_versions,
       to_regclass('public.extraction_events') AS extraction_events;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('extraction_runs', 'extraction_versions', 'ai_usage_log')
  AND column_name IN ('source_data', 'extraction_run_id', 'usage_source')
ORDER BY table_name, column_name;

SELECT p.oid::regprocedure::text AS function_signature,
       pg_get_functiondef(p.oid) LIKE '%extensions.digest%' AS uses_qualified_digest
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('save_extraction_version', 'approve_extraction_data', 'restore_extraction_version')
ORDER BY 1;

SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'extraction_versions_document_idx',
    'extraction_versions_client_idx',
    'extraction_versions_created_by_idx',
    'extraction_events_document_idx',
    'extraction_events_client_idx',
    'extraction_runs_document_idx',
    'extraction_runs_user_idx'
  )
ORDER BY tablename, indexname;

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('save_extraction_version', 'approve_extraction_data', 'restore_extraction_version')
ORDER BY routine_name, grantee;
