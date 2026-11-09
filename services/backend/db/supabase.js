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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
  console.warn('[Supabase] ⚠️  WARNING: Supabase credentials not configured in .env');
  console.warn('[Supabase] Running in DEMO MODE with in-memory fallback data.');
  console.warn('[Supabase] Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env to enable cloud database.');
}

let supabase = null;
let isConnected = false;

try {
  if (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
    isConnected = true;
    console.log('[Supabase] ✅ Connected to cloud database:', SUPABASE_URL);
  }
} catch (err) {
  console.error('[Supabase] ❌ Connection failed:', err.message);
}

module.exports = { supabase, isConnected };
