-- Repair existing TaxFlow installations where integration_secrets was created
-- with only SELECT/UPDATE access for the backend service role.
-- Browser roles remain blocked; the server-only service_role is the only role
-- that can remove integration metadata during permanent account deletion.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, UPDATE, DELETE ON TABLE public.integration_secrets TO service_role;

NOTIFY pgrst, 'reload schema';
