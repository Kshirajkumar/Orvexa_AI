CREATE INDEX IF NOT EXISTS invoice_records_latest_source_document_idx
  ON public.invoice_records (latest_source_document_id)
  WHERE latest_source_document_id IS NOT NULL;
