-- Durable extraction attempts. Apply after the core schema and extraction_versioning.sql.
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS usage_source text NOT NULL DEFAULT 'unknown';

CREATE TABLE IF NOT EXISTS public.extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents_metadata(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('gemini', 'openrouter_local')),
  model text,
  prompt_version text NOT NULL DEFAULT 'extraction-prompt-v1',
  schema_version text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  provider_request_id text,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_usd numeric(12,8) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  usage_source text NOT NULL DEFAULT 'unknown' CHECK (usage_source IN ('provider_response', 'client_reported', 'unknown')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_runs_document_idx
  ON public.extraction_runs (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS extraction_runs_user_idx
  ON public.extraction_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS extraction_versions_client_idx
  ON public.extraction_versions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS extraction_versions_created_by_idx
  ON public.extraction_versions (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS extraction_events_document_idx
  ON public.extraction_events (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS extraction_events_client_idx
  ON public.extraction_events (client_id, created_at DESC);

ALTER TABLE public.extraction_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.extraction_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.extraction_runs TO service_role;

-- Existing version rows may be NULL; this constraint only applies to future non-NULL IDs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'extraction_versions_run_fk'
  ) THEN
    ALTER TABLE public.extraction_versions
      ADD CONSTRAINT extraction_versions_run_fk
      FOREIGN KEY (extraction_run_id) REFERENCES public.extraction_runs(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- Verification queries for staging:
-- SELECT to_regclass('public.extraction_runs');
-- SELECT conname FROM pg_constraint WHERE conname = 'extraction_versions_run_fk';
