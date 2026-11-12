/**
 * TaxFlow.AI — Supabase Cloud Database Client
 *
 * PURPOSE: Supabase stores structured metadata and private document objects:
 *   - Client records (name, PAN, GSTIN, phone, entity type)
 *   - Document metadata and private Storage objects
 *   - AI usage counters (queries per client, per month)
 *   - WhatsApp message logs
 *   - Compliance tasks & deadlines
 *   - Extraction results (structured JSON fields)
 *
 * Document binaries are stored in the configured private Storage bucket.
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
// Supabase's new server-only key replaces the legacy service_role key.
// Keep the legacy name as a fallback while projects migrate.
const SUPABASE_SERVER_KEY = String(
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim();

function isUsableSupabaseKey(value) {
  return value.startsWith('sb_secret_')
    || (value.startsWith('eyJ') && value.split('.').length === 3 && value.length > 100);
}

if (!SUPABASE_URL || !isUsableSupabaseKey(SUPABASE_SERVER_KEY) || SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
  const reason = !SUPABASE_URL
    ? 'SUPABASE_URL is missing'
    : SUPABASE_URL.includes('YOUR_PROJECT_ID')
      ? 'SUPABASE_URL is still a placeholder'
      : 'SUPABASE_SECRET_KEY is missing or not a valid server key';
  logger.warn('SUPABASE', 'cloud database disabled; running in demo mode', {
    reason,
    fix: 'Set SUPABASE_URL and SUPABASE_SECRET_KEY in services/backend/.env'
  });
}

let supabase = null;
let isConnected = false;

try {
  if (SUPABASE_URL && isUsableSupabaseKey(SUPABASE_SERVER_KEY) && !SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
      auth: { persistSession: false }
    });
    isConnected = true;
    logger.info('SUPABASE', 'cloud database client initialized', { project: SUPABASE_URL });
  }
} catch (err) {
  logger.error('SUPABASE', 'client initialization failed', { error: err });
}

module.exports = { supabase, isConnected, SUPABASE_SERVER_KEY };
