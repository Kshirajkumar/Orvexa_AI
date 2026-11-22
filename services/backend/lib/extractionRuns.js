const { supabase } = require('../db/supabase');

function trimText(value, max = 500) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

async function startExtractionRun({ userId, document, provider, model, schemaVersion, usageSource = 'unknown' }) {
  if (!supabase || !document?.id || !document?.client_id) return null;
  const { data, error } = await supabase.from('extraction_runs').insert([{
    user_id: userId,
    client_id: document.client_id,
    document_id: document.id,
    provider,
    model: trimText(model, 200),
    schema_version: trimText(schemaVersion, 100) || 'general-v1',
    usage_source: usageSource,
    status: 'processing',
  }]).select('id').single();
  if (error) {
    console.warn('[Extraction] Could not create durable extraction run:', error.message);
    return null;
  }
  return data?.id || null;
}

async function finishExtractionRun(runId, { status, inputTokens = 0, outputTokens = 0, costUsd = 0, durationMs = null, providerRequestId = null, errorCode = null, errorMessage = null }) {
  if (!supabase || !runId) return;
  const { error } = await supabase.from('extraction_runs').update({
    status,
    input_tokens: Number.isSafeInteger(inputTokens) && inputTokens >= 0 ? inputTokens : 0,
    output_tokens: Number.isSafeInteger(outputTokens) && outputTokens >= 0 ? outputTokens : 0,
    cost_usd: Number.isFinite(Number(costUsd)) && Number(costUsd) >= 0 ? Number(costUsd) : 0,
    duration_ms: Number.isSafeInteger(durationMs) && durationMs >= 0 ? durationMs : null,
    provider_request_id: trimText(providerRequestId, 255),
    error_code: trimText(errorCode, 100),
    error_message: trimText(errorMessage, 2000),
    finished_at: new Date().toISOString(),
  }).eq('id', runId);
  if (error) console.warn('[Extraction] Could not finish durable extraction run:', error.message);
}

module.exports = { startExtractionRun, finishExtractionRun };
