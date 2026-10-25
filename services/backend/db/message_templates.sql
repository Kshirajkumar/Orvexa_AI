-- TaxFlow.AI: Message templates for client communication
-- Run after schema.sql. Shared defaults use NULL user_id; private templates are account-owned.

CREATE TABLE IF NOT EXISTS public.message_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  cat         VARCHAR(50) NOT NULL DEFAULT 'Utility',
  body        TEXT NOT NULL,
  protected   BOOLEAN NOT NULL DEFAULT FALSE,
  template_key TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT;

UPDATE public.message_templates
SET template_key = CASE name
  WHEN 'GST documents request' THEN 'docs'
  WHEN 'Missing document' THEN 'pending'
  WHEN 'ITR documents' THEN 'itr'
  ELSE template_key
END
WHERE protected = TRUE AND template_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_shared_template_key_idx
  ON public.message_templates(template_key)
  WHERE user_id IS NULL AND template_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_templates_user_id_idx
  ON public.message_templates(user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_no_protected_private_defaults;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_no_protected_private_defaults
  CHECK (NOT (
    user_id IS NOT NULL
    AND protected = TRUE
    AND template_key IN ('website_link', 'portal_link', 'portal_invite', 'docs', 'pending', 'itr', 'payment_reminder', 'status_update', 'onboarding')
  ));

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_templates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_templates TO authenticated;

DROP POLICY IF EXISTS message_templates_service_role ON public.message_templates;
CREATE POLICY message_templates_service_role
  ON public.message_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed shared default templates once; private templates are created only by the API.
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES
  (NULL, 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}', true),
  (NULL, 'portal_link', 'Client portal website link', 'Client portal', 'Hello {name}, you can sign in to your TaxFlow client portal and upload your requested documents here: {portalLink}', true),
  (NULL, 'docs', 'GST documents request', 'Utility', 'Hello {name}, please upload your {period} sales & purchase invoices through your secure client portal: {portalLink}. Deadline: {due}.', true),
  (NULL, 'pending', 'Missing document', 'Utility', 'Hi {name}, we have not received the {doc} for {period} yet. Please upload it through your secure client portal: {portalLink}.', true),
  (NULL, 'itr', 'ITR documents', 'Utility', 'Hi {name}, to file your ITR please upload Form 16 / 26AS, bank interest certificates, and investment proofs through your secure client portal: {portalLink}.', true),
  (NULL, 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, here is the link to your secure client portal where you can review your tax files and safely upload requested documents: {portalLink}

Use the same email address your CA has on file. Please do not send tax, financial, identity, or other sensitive documents in Telegram.', true)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- Remove only legacy protected copies of these shared defaults.
DELETE FROM public.message_templates
WHERE user_id IS NOT NULL
  AND protected = TRUE
  AND template_key IN ('website_link', 'portal_link', 'docs', 'pending', 'itr', 'portal_invite');

-- Re-assert the shared/private access model for installs that ran older SQL.
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_templates_service_role ON public.message_templates;
CREATE POLICY message_templates_service_role
  ON public.message_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS message_templates_select_policy ON public.message_templates;
CREATE POLICY message_templates_select_policy
  ON public.message_templates FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS message_templates_insert_policy ON public.message_templates;
CREATE POLICY message_templates_insert_policy
  ON public.message_templates FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));
DROP POLICY IF EXISTS message_templates_update_policy ON public.message_templates;
CREATE POLICY message_templates_update_policy
  ON public.message_templates FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()) AND protected = FALSE)
  WITH CHECK (user_id = (select auth.uid()) AND protected = FALSE);
DROP POLICY IF EXISTS message_templates_delete_policy ON public.message_templates;
CREATE POLICY message_templates_delete_policy
  ON public.message_templates FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) AND protected = FALSE);

-- Built-in defaults are maintained in the desktop app by country. Remove any legacy shared seeds.
DELETE FROM public.message_templates WHERE user_id IS NULL;
NOTIFY pgrst, 'reload schema';
