-- Restore the server-only permissions required by Render workers.
-- Run after document_lifecycle.sql and inbox_automation.sql.
-- These grants do not expose any table or function to anon/authenticated.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.storage_cleanup_jobs, public.document_upload_reservations
  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.client_deletion_audit
  TO service_role;

GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_storage_cleanup_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_storage_cleanup_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_storage_cleanup_job(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_client_cleanup_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_client_auth_cleanup_job(uuid, text) TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.telegram_message_schedules
  TO service_role;

GRANT EXECUTE
  ON FUNCTION public.claim_due_telegram_message_schedules(integer)
  TO service_role;
GRANT EXECUTE
  ON FUNCTION public.finish_telegram_message_schedule(uuid, boolean, text, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';
