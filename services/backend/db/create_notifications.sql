-- TaxFlow.AI: database-backed activity notifications.
-- Run this migration in the Supabase SQL editor or via Supabase MCP execute_sql.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type    VARCHAR(50) NOT NULL,
  title         VARCHAR(160) NOT NULL,
  message       TEXT NOT NULL,
  entity_type   VARCHAR(50),
  entity_id     UUID,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own notifications" ON public.notifications;
CREATE POLICY "Users can read their own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own notifications" ON public.notifications;
CREATE POLICY "Users can insert their own notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Indexes for lightning fast notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read_at)
  WHERE read_at IS NULL;

-- 1. Trigger for Client Changes (INSERT / UPDATE / DELETE)
CREATE OR REPLACE FUNCTION public.create_client_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  client_name TEXT;
  notification_user_id UUID;
  notification_client_id UUID;
  notification_type TEXT;
  notification_title TEXT;
  notification_message TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    client_name := NEW.name;
    notification_user_id := NEW.user_id;
    notification_client_id := NEW.id;
    notification_type := 'client.created';
    notification_title := 'New client added';
    notification_message := format('%s was added to your client registry.', NEW.name);
  ELSIF TG_OP = 'UPDATE' THEN
    client_name := NEW.name;
    notification_user_id := NEW.user_id;
    notification_client_id := NEW.id;
    notification_type := 'client.updated';
    notification_title := 'Client updated';
    notification_message := format('%s was updated in your client registry.', NEW.name);
  ELSIF TG_OP = 'DELETE' THEN
    client_name := OLD.name;
    notification_user_id := OLD.user_id;
    notification_client_id := OLD.id;
    notification_type := 'client.deleted';
    notification_title := 'Client removed';
    notification_message := format('%s was permanently removed from your client registry.', OLD.name);
  ELSE
    RETURN NEW;
  END IF;

  IF notification_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id,
      event_type,
      title,
      message,
      entity_type,
      entity_id,
      metadata
    ) VALUES (
      notification_user_id,
      notification_type,
      notification_title,
      notification_message,
      'client',
      notification_client_id,
      jsonb_build_object('client_name', client_name)
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_create_notification ON public.clients;
CREATE TRIGGER trg_clients_create_notification
  AFTER INSERT OR UPDATE OR DELETE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.create_client_notification();

-- 2. Trigger for Document Intake (when document metadata is registered)
CREATE OR REPLACE FUNCTION public.create_document_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  client_display_name TEXT;
BEGIN
  -- Look up the accountant user_id who owns this client
  SELECT user_id, name INTO target_user_id, client_display_name
  FROM public.clients
  WHERE id = NEW.client_id;

  IF target_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id,
      event_type,
      title,
      message,
      entity_type,
      entity_id,
      metadata
    ) VALUES (
      target_user_id,
      'document.received',
      format('New %s document received', COALESCE(NEW.category, 'file')),
      format('%s uploaded "%s" via %s.', COALESCE(client_display_name, NEW.client_name, 'Client'), NEW.file_name, COALESCE(NEW.source, 'portal')),
      'document',
      NEW.id,
      jsonb_build_object(
        'client_id', NEW.client_id,
        'client_name', client_display_name,
        'file_name', NEW.file_name,
        'category', NEW.category,
        'source', NEW.source
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_create_notification ON public.documents_metadata;
CREATE TRIGGER trg_documents_create_notification
  AFTER INSERT ON public.documents_metadata
  FOR EACH ROW
  EXECUTE FUNCTION public.create_document_notification();

NOTIFY pgrst, 'reload schema';
