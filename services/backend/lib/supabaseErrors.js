const FRIENDLY_BACKEND_CONNECTING_MESSAGE =
  'Connecting to the backend service… Establishing a secure connection can take a few moments. This is not an issue with your account or the app—please try again in a few seconds.';

function getSupabaseConfigurationMessage(error, resource) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === '42501' || /permission denied|not enough privileges|insufficient privilege/.test(message)) {
    console.error(`[Supabase Config] The backend cannot access ${resource}. Verify Render uses the server-only SUPABASE_SECRET_KEY (not the publishable/anon key), confirm the required service_role grants are installed, then restart the backend.`);
    return FRIENDLY_BACKEND_CONNECTING_MESSAGE;
  }
  if (code === 'PGRST205' || code === '42P01' || /could not find the table|relation .* does not exist/.test(message)) {
    console.error(`[Supabase Config] The Supabase migration for ${resource} is not installed. Apply the required database migration, then restart the backend.`);
    return FRIENDLY_BACKEND_CONNECTING_MESSAGE;
  }
  if (/owning ca profile is missing|client portal access cannot be verified|auth account email is missing/.test(message)) {
    console.error(`[Supabase Config] The CA/client identity migration is incomplete for ${resource}. Run client_identity_profiles.sql and repair the affected account before retrying.`);
    return FRIENDLY_BACKEND_CONNECTING_MESSAGE;
  }
  return null;
}

module.exports = { getSupabaseConfigurationMessage, FRIENDLY_BACKEND_CONNECTING_MESSAGE };
