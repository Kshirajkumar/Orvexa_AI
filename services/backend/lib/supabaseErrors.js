function getSupabaseConfigurationMessage(error, resource) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === '42501' || /permission denied|not enough privileges|insufficient privilege/.test(message)) {
    return `The backend cannot access ${resource}. Verify Render uses the server-only SUPABASE_SECRET_KEY (not the publishable/anon key), confirm the required service_role grants are installed, then restart the backend.`;
  }
  if (code === 'PGRST205' || code === '42P01' || /could not find the table|relation .* does not exist/.test(message)) {
    return `The Supabase migration for ${resource} is not installed. Apply the required database migration, then restart the backend.`;
  }
  if (/owning ca profile is missing|client portal access cannot be verified|auth account email is missing/.test(message)) {
    return `The CA/client identity migration is incomplete for ${resource}. Run client_identity_profiles.sql and repair the affected account before retrying.`;
  }
  return null;
}

module.exports = { getSupabaseConfigurationMessage };
