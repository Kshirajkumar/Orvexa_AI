-- Prevent the document delete audit trigger from inserting a row that
-- references a client while that client is being deleted by cascade.
CREATE OR REPLACE FUNCTION public.record_document_file_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = OLD.client_id
  ) THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.document_file_activity (
    document_id, client_id, operation, file_name, file_size_before_kb,
    file_sha256, storage_bucket, storage_object_path, status, note
  ) VALUES (
    OLD.id, OLD.client_id, 'deleted', OLD.file_name, OLD.file_size_kb,
    OLD.file_sha256, OLD.storage_bucket, OLD.storage_object_path,
    'completed', 'Document metadata deleted after the storage cleanup workflow completed.'
  );
  RETURN OLD;
END;
$$;
