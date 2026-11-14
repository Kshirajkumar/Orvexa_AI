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

function isUsableSupabaseKey(value) {
  if (value.startsWith('sb_secret_')) return true;
  if (!value.startsWith('eyJ') || value.split('.').length !== 3 || value.length <= 100) return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role' || payload.role === 'supabase_admin';
  } catch {
    return false;
  }
}

const SUPABASE_SERVER_KEY = String(process.env.SUPABASE_SECRET_KEY || '').trim();

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
