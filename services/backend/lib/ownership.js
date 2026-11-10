const { supabase } = require('../db/supabase');

async function getOwnedClientIds(userId) {
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', userId)
    .is('deletion_requested_at', null);
  if (error) throw error;
  return (data || []).map(client => client.id);
}

async function assertOwnedClient(userId, clientId) {
  if (!clientId) return false;
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_id', userId)
    .is('deletion_requested_at', null)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

module.exports = { getOwnedClientIds, assertOwnedClient };