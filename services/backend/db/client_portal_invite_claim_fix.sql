-- Repair migration for installations that already have client_portal_invites.
-- Run with the backend's server-only Supabase key after client_portal_invites.sql.
-- This is idempotent and preserves invite, client, and auth data.

CREATE OR REPLACE FUNCTION public.claim_client_portal_invite(
  p_user_id UUID,
  p_token_hash TEXT
)
RETURNS TABLE (client_id UUID, invited_email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_invite public.client_portal_invites%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_access public.client_portal_access%ROWTYPE;
  v_user auth.users%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid portal invitation';
  END IF;

  SELECT * INTO v_user FROM auth.users
  WHERE id = p_user_id
    AND (raw_app_meta_data ->> 'role' = 'client'
      OR raw_app_meta_data ->> 'taxflow_client_portal' = 'true');
  IF NOT FOUND THEN RAISE EXCEPTION 'This account is not authorized for client portal enrollment'; END IF;

  SELECT * INTO v_invite FROM public.client_portal_invites WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'This portal invitation is invalid or expired'; END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_invite.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This portal invitation is no longer valid'; END IF;

  SELECT * INTO v_invite FROM public.client_portal_invites
  WHERE id = v_invite.id AND token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND
    OR v_invite.consumed_at IS NOT NULL
    OR v_invite.revoked_at IS NOT NULL
    OR v_invite.expires_at <= clock_timestamp()
    OR lower(btrim(v_user.email)) IS DISTINCT FROM lower(btrim(v_invite.invited_email)) THEN
    RAISE EXCEPTION 'This portal invitation is invalid or expired';
  END IF;

  IF v_client.status IS DISTINCT FROM 'Active'
    OR lower(btrim(v_client.email)) IS DISTINCT FROM lower(btrim(v_invite.invited_email)) THEN
    RAISE EXCEPTION 'This portal invitation is no longer valid';
  END IF;

  SELECT * INTO v_access FROM public.client_portal_access
  WHERE public.client_portal_access.client_id = v_client.id FOR UPDATE;
  IF FOUND THEN
    IF v_access.active AND v_access.user_id IS NOT NULL AND v_access.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Client portal access is already linked to another account';
    END IF;
    UPDATE public.client_portal_access
    SET user_id = p_user_id, invited_email = lower(btrim(v_invite.invited_email)),
        active = TRUE, access_status = 'active', invitation_pending = FALSE, updated_at = clock_timestamp()
    WHERE id = v_access.id;
  ELSE
    INSERT INTO public.client_portal_access
      (client_id, user_id, invited_email, active, access_status, invitation_pending, created_by)
    VALUES
      (v_client.id, p_user_id, lower(btrim(v_invite.invited_email)), TRUE, 'active', FALSE, v_invite.created_by);
  END IF;

  UPDATE public.client_portal_invites SET consumed_at = clock_timestamp() WHERE id = v_invite.id;
  UPDATE public.client_portal_invites
  SET revoked_at = clock_timestamp()
  WHERE public.client_portal_invites.client_id = v_client.id
    AND public.client_portal_invites.id <> v_invite.id
    AND consumed_at IS NULL AND revoked_at IS NULL;
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('taxflow_portal_invite_claimed', TRUE)
  WHERE id = p_user_id;

  RETURN QUERY SELECT v_client.id, lower(btrim(v_invite.invited_email));
END;
$$;

REVOKE ALL ON FUNCTION public.claim_client_portal_invite(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_client_portal_invite(UUID, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
