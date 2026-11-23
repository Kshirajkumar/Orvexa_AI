-- 1. Ensure foreign key on client_user_profiles(ca_user_id) cascades instead of restricting
DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT c.conname, child_ns.nspname AS child_schema, child.relname AS child_table
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE c.contype = 'f'
      AND child.relname = 'client_user_profiles'
      AND c.confrelid = 'public.ca_user_profiles'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', v_con.child_schema, v_con.child_table, v_con.conname);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (ca_user_id) REFERENCES public.ca_user_profiles(user_id) ON DELETE CASCADE',
      v_con.child_schema, v_con.child_table, v_con.conname);
  END LOOP;
END $$;

-- 2. Ensure all foreign keys referencing auth.users in public schema cascade or set null appropriately
DO $$
DECLARE
  fk RECORD;
  child_column TEXT;
  child_is_not_null BOOLEAN;
  action_sql TEXT;
BEGIN
  FOR fk IN
    SELECT
      c.oid AS constraint_oid,
      c.conname,
      c.conrelid,
      child_ns.nspname AS child_schema,
      child.relname AS child_table,
      c.conkey
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND child_ns.nspname = 'public'
      AND c.confdeltype IN ('a', 'r', 'd')
  LOOP
    IF array_length(fk.conkey, 1) = 1 THEN
      SELECT a.attname, a.attnotnull
        INTO child_column, child_is_not_null
      FROM pg_attribute a
      WHERE a.attrelid = fk.conrelid
        AND a.attnum = fk.conkey[1]
        AND NOT a.attisdropped;

      IF child_column IS NOT NULL THEN
        action_sql := CASE
          WHEN child_is_not_null THEN 'ON DELETE CASCADE'
          ELSE 'ON DELETE SET NULL'
        END;

        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', fk.child_schema, fk.child_table, fk.conname);
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) %s',
          fk.child_schema, fk.child_table, fk.conname, child_column, action_sql);
      END IF;
    END IF;
  END LOOP;
END $$;

-- 3. Stored Procedure: delete_ca_user_all_data
-- Atomically deletes all data rows linked to a CA user and their clients across all tables
-- in proper foreign-key dependency order, and returns client portal auth user IDs to delete.
CREATE OR REPLACE FUNCTION public.delete_ca_user_all_data(p_ca_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_client_ids UUID[];
  v_portal_user_ids UUID[];
  v_client_count INTEGER := 0;
  v_deleted_portal_count INTEGER := 0;
BEGIN
  IF p_ca_user_id IS NULL THEN
    RAISE EXCEPTION 'A valid CA user ID is required for account deletion.';
  END IF;

  -- Step 1: Collect all client IDs belonging to this CA
  SELECT ARRAY_AGG(id) INTO v_client_ids
  FROM public.clients
  WHERE user_id = p_ca_user_id;

  v_client_ids := COALESCE(v_client_ids, ARRAY[]::UUID[]);
  v_client_count := array_length(v_client_ids, 1);
  IF v_client_count IS NULL THEN
    v_client_count := 0;
  END IF;

  -- Step 2: Collect all client portal auth user IDs associated with these clients
  SELECT ARRAY_AGG(DISTINCT uid) INTO v_portal_user_ids
  FROM (
    SELECT user_id AS uid FROM public.client_portal_access
    WHERE (client_id = ANY(v_client_ids) OR created_by = p_ca_user_id) AND user_id IS NOT NULL AND user_id <> p_ca_user_id
    UNION
    SELECT user_id AS uid FROM public.client_user_profiles
    WHERE (client_id = ANY(v_client_ids) OR ca_user_id = p_ca_user_id) AND user_id IS NOT NULL AND user_id <> p_ca_user_id
    UNION
    SELECT claimed_by_user_id AS uid FROM public.client_portal_invites
    WHERE client_id = ANY(v_client_ids) AND claimed_by_user_id IS NOT NULL AND claimed_by_user_id <> p_ca_user_id
    UNION
    SELECT portal_user_id AS uid FROM public.storage_cleanup_jobs
    WHERE (client_id = ANY(v_client_ids) OR user_id = p_ca_user_id) AND portal_user_id IS NOT NULL AND portal_user_id <> p_ca_user_id
  ) sub;

  v_portal_user_ids := COALESCE(v_portal_user_ids, ARRAY[]::UUID[]);
  v_deleted_portal_count := array_length(v_portal_user_ids, 1);
  IF v_deleted_portal_count IS NULL THEN
    v_deleted_portal_count := 0;
  END IF;

  -- Step 3: Delete child records in dependency order
  IF v_client_count > 0 THEN
    -- Document file activity
    DELETE FROM public.document_file_activity
    WHERE client_id = ANY(v_client_ids) OR user_id = p_ca_user_id;

    -- Extraction & invoice records
    IF to_regclass('public.extraction_events') IS NOT NULL THEN
      DELETE FROM public.extraction_events
      WHERE extraction_version_id IN (
        SELECT id FROM public.extraction_versions WHERE client_id = ANY(v_client_ids)
      );
    END IF;

    IF to_regclass('public.extraction_versions') IS NOT NULL THEN
      DELETE FROM public.extraction_versions WHERE client_id = ANY(v_client_ids);
    END IF;

    IF to_regclass('public.extraction_runs') IS NOT NULL THEN
      DELETE FROM public.extraction_runs
      WHERE client_id = ANY(v_client_ids) OR user_id = p_ca_user_id;
    END IF;

    DELETE FROM public.extracted_fields WHERE client_id = ANY(v_client_ids);

    IF to_regclass('public.invoice_review_requests') IS NOT NULL THEN
      DELETE FROM public.invoice_review_requests
      WHERE invoice_record_id IN (
        SELECT id FROM public.invoice_records WHERE client_id = ANY(v_client_ids)
      );
    END IF;

    IF to_regclass('public.invoice_record_versions') IS NOT NULL THEN
      DELETE FROM public.invoice_record_versions
      WHERE invoice_record_id IN (
        SELECT id FROM public.invoice_records WHERE client_id = ANY(v_client_ids)
      );
    END IF;

    IF to_regclass('public.invoice_records') IS NOT NULL THEN
      DELETE FROM public.invoice_records WHERE client_id = ANY(v_client_ids);
    END IF;

    -- Client communications and tasks
    DELETE FROM public.ai_usage_log WHERE client_id = ANY(v_client_ids);
    DELETE FROM public.whatsapp_messages WHERE client_id = ANY(v_client_ids);
    DELETE FROM public.compliance_tasks WHERE client_id = ANY(v_client_ids);

    -- Document lifecycle and reservations
    IF to_regclass('public.document_sync_receipts') IS NOT NULL THEN
      DELETE FROM public.document_sync_receipts
      WHERE client_id = ANY(v_client_ids);
    END IF;

    DELETE FROM public.document_upload_reservations
    WHERE client_id = ANY(v_client_ids) OR user_id = p_ca_user_id;

    DELETE FROM public.document_versions
    WHERE client_id = ANY(v_client_ids) OR uploaded_by_user_id = p_ca_user_id;

    DELETE FROM public.documents_metadata WHERE client_id = ANY(v_client_ids);

    -- Client portal tables
    DELETE FROM public.client_portal_invites
    WHERE client_id = ANY(v_client_ids) OR invited_by_user_id = p_ca_user_id;

    DELETE FROM public.client_portal_access
    WHERE client_id = ANY(v_client_ids) OR created_by = p_ca_user_id;

    IF to_regclass('public.ca_client_relationships') IS NOT NULL THEN
      DELETE FROM public.ca_client_relationships
      WHERE client_id = ANY(v_client_ids) OR ca_user_id = p_ca_user_id;
    END IF;

    IF to_regclass('public.client_user_profiles') IS NOT NULL THEN
      DELETE FROM public.client_user_profiles
      WHERE client_id = ANY(v_client_ids) OR ca_user_id = p_ca_user_id;
    END IF;

    IF to_regclass('public.client_deletion_audit') IS NOT NULL THEN
      DELETE FROM public.client_deletion_audit
      WHERE client_id = ANY(v_client_ids) OR owner_user_id = p_ca_user_id;
    END IF;

    DELETE FROM public.storage_cleanup_jobs
    WHERE client_id = ANY(v_client_ids) OR user_id = p_ca_user_id;

    -- Delete clients
    DELETE FROM public.clients WHERE id = ANY(v_client_ids);
  END IF;

  -- Step 4: Delete CA user-scoped records
  DELETE FROM public.document_file_activity WHERE user_id = p_ca_user_id;
  DELETE FROM public.document_upload_reservations WHERE user_id = p_ca_user_id;
  DELETE FROM public.storage_cleanup_jobs WHERE user_id = p_ca_user_id;

  IF to_regclass('public.client_deletion_audit') IS NOT NULL THEN
    DELETE FROM public.client_deletion_audit WHERE owner_user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.telegram_message_schedules') IS NOT NULL THEN
    DELETE FROM public.telegram_message_schedules WHERE user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.telegram_messages') IS NOT NULL THEN
    DELETE FROM public.telegram_messages WHERE user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.telegram_chats') IS NOT NULL THEN
    DELETE FROM public.telegram_chats WHERE user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.telegram_link_tokens') IS NOT NULL THEN
    DELETE FROM public.telegram_link_tokens WHERE user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.message_templates') IS NOT NULL THEN
    DELETE FROM public.message_templates WHERE user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.auth_email_verification_challenges') IS NOT NULL THEN
    DELETE FROM public.auth_email_verification_challenges WHERE user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.integration_secrets') IS NOT NULL THEN
    DELETE FROM public.integration_secrets WHERE owner_user_id = p_ca_user_id;
  END IF;

  IF to_regclass('public.ca_user_profiles') IS NOT NULL THEN
    DELETE FROM public.ca_user_profiles WHERE user_id = p_ca_user_id;
  END IF;

  DELETE FROM public.user_profiles WHERE id = p_ca_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'clientCount', v_client_count,
    'portalUserIds', v_portal_user_ids,
    'portalUserCount', v_deleted_portal_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_ca_user_all_data(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_ca_user_all_data(UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
