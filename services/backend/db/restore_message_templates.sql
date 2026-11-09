-- ==============================================================================
-- TaxFlow.AI: Message Templates Restoration & Setup Script
-- Run this in your Supabase SQL Editor. Safe to run multiple times (Idempotent).
--
-- Logic:
-- 1. If user_id IS NULL -> Shared / Default template visible to all users.
-- 2. If user_id IS NOT NULL -> Private template visible and loaded only for that user.
-- ==============================================================================

-- 1. Ensure Table Structure
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

-- Ensure nullable user_id (NULL = default template for all users)
ALTER TABLE public.message_templates 
  ALTER COLUMN user_id DROP NOT NULL;

-- Ensure template_key column exists
ALTER TABLE public.message_templates 
  ADD COLUMN IF NOT EXISTS template_key TEXT;

-- Ensure partial unique index on template_key for shared default templates
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_shared_template_key_idx
  ON public.message_templates(template_key)
  WHERE user_id IS NULL AND template_key IS NOT NULL;

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_no_protected_private_defaults;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_no_protected_private_defaults
  CHECK (NOT (
    user_id IS NOT NULL
    AND protected = TRUE
    AND template_key IN ('website_link', 'portal_link', 'portal_invite', 'docs', 'pending', 'itr', 'payment_reminder', 'status_update', 'onboarding')
  ));

-- 2. Clean up any accidental orphaned/duplicate shared templates
DELETE FROM public.message_templates
WHERE protected = TRUE 
  AND user_id IS NOT NULL 
  AND template_key IN (
    'website_link', 'portal_link', 'portal_invite', 'docs', 
    'pending', 'itr', 'payment_reminder', 'status_update', 'onboarding'
  );

-- 3. Insert / Restore All Default Message Templates (user_id = NULL)

-- 1. Website link
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'website_link', 
  'Website link', 
  'Links', 
  'Hello {name}, you can visit our client portal and website at: {portalLink}', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 2. Client portal website link
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'portal_link', 
  'Client portal website link', 
  'Client portal', 
  'Hello {name}, you can sign in to your TaxFlow client portal and upload your requested documents here: {portalLink}', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 3. Secure portal invitation / access (Professional short message with website link)
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'portal_invite', 
  'Secure portal invitation', 
  'Client portal', 
  'Hello {name}, here is the link to your secure client portal where you can review your tax files and safely upload requested documents: {portalLink}

Use the same email address your CA has on file. Please do not send tax, financial, identity, or other sensitive documents in Telegram.', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 4. GST documents request
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'docs', 
  'GST documents request', 
  'Utility', 
  'Hello {name}, please upload your {period} sales & purchase invoices through your secure client portal: {portalLink}. Deadline: {due}.', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 5. Missing document follow-up
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'pending', 
  'Missing document', 
  'Utility', 
  'Hi {name}, we have not received the {doc} for {period} yet. Please upload it through your secure client portal: {portalLink}.', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 6. ITR filing documents
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'itr', 
  'ITR documents', 
  'Utility', 
  'Hi {name}, to file your ITR please upload Form 16 / 26AS, bank interest certificates, and investment proofs through your secure client portal: {portalLink}.', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 7. Fee & invoice payment reminder
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'payment_reminder', 
  'Fee & invoice reminder', 
  'Payment', 
  'Hi {name}, this is a gentle reminder regarding the professional fee invoice for {period}. Please review and complete payment at your convenience.', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 8. Tax filing status update
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'status_update', 
  'Tax filing status update', 
  'General', 
  'Hello {name}, your {filing} for {period} has been prepared and filed. You can check the acknowledgement on your client portal: {portalLink}.', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 9. New client welcome & onboarding checklist
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (
  NULL, 
  'onboarding', 
  'New client welcome', 
  'Client portal', 
  'Hello {name}, welcome to our tax and compliance practice! Please access your client portal here to complete your onboarding and review required documents: {portalLink}', 
  TRUE
)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body, protected = TRUE, updated_at = NOW();

-- 4. Enable Row Level Security (RLS) & Policies
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- ⚠️  IMPORTANT: Do NOT use FORCE ROW LEVEL SECURITY on this table.
-- The backend uses the service_role key and manually scopes queries
-- with .or('user_id.is.null,user_id.eq.<userId>'). FORCE RLS would block
-- service_role from reading private user templates because auth.uid() is
-- NULL in service_role context.
-- (If FORCE RLS was previously set, remove it:)
ALTER TABLE public.message_templates NO FORCE ROW LEVEL SECURITY;

-- DROP all existing policies and recreate cleanly
DROP POLICY IF EXISTS message_templates_select_policy ON public.message_templates;
DROP POLICY IF EXISTS message_templates_insert_policy ON public.message_templates;
DROP POLICY IF EXISTS message_templates_update_policy ON public.message_templates;
DROP POLICY IF EXISTS message_templates_delete_policy ON public.message_templates;
DROP POLICY IF EXISTS message_templates_service_role_policy ON public.message_templates;

-- Service role policy: full access (backend trusted server, manually filters by user_id)
CREATE POLICY message_templates_service_role_policy ON public.message_templates
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- SELECT policy: Authenticated users see shared defaults (user_id IS NULL) + own private templates
CREATE POLICY message_templates_select_policy ON public.message_templates
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT policy: Authenticated users can only insert their own private templates
CREATE POLICY message_templates_insert_policy ON public.message_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE policy: Users can only update their own non-protected private templates
CREATE POLICY message_templates_update_policy ON public.message_templates
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND protected = FALSE)
  WITH CHECK (user_id = auth.uid() AND protected = FALSE);

-- DELETE policy: Users can only delete their own non-protected private templates
CREATE POLICY message_templates_delete_policy ON public.message_templates
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() AND protected = FALSE);

-- Built-in defaults are maintained in the desktop app by country. Remove any legacy shared seeds.
DELETE FROM public.message_templates WHERE user_id IS NULL;

-- Output confirmation: private templates only
SELECT id, template_key, name, cat, user_id, protected, created_at 
FROM public.message_templates
ORDER BY user_id NULLS FIRST, created_at ASC;
