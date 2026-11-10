CREATE INDEX IF NOT EXISTS document_versions_created_by_idx
  ON public.document_versions (created_by);

CREATE INDEX IF NOT EXISTS document_upload_reservations_owner_user_idx
  ON public.document_upload_reservations (owner_user_id);

CREATE INDEX IF NOT EXISTS document_upload_reservations_created_by_idx
  ON public.document_upload_reservations (created_by);
