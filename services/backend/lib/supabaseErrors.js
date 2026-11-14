function getSupabaseConfigurationMessage(error, resource) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === '42501' || /permission denied|not enough privileges|insufficient privilege/.test(message)) {
    return `The backend Supabase server key cannot access ${resource}. Configure SUPABASE_SECRET_KEY with a server-only key, then restart the backend.`;
  }
  if (code === 'PGRST205' || code === '42P01' || /could not find the table|relation .* does not exist/.test(message)) {
    return `The Supabase migration for ${resource} is not installed. Apply the required database migration, then restart the backend.`;
  }
  return null;
}

module.exports = { getSupabaseConfigurationMessage };
