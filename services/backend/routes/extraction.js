/**
 * TaxFlow.AI — AI Extraction Routes
 *
 * This module handles:
 *  1. Sending a document from private Supabase Storage to Gemini AI for OCR + data extraction
 *  2. Saving extracted structured fields to Supabase
 *  3. Logging every AI API call to the ai_usage_log table (for analytics & billing)
 *
 * Gemini Integration:
 *  - Model: gemini-1.5-flash (fastest, cost-effective for OCR tasks)
 *  - The physical file is read from private Supabase Storage and sent as base64 to Gemini
 *  - Gemini returns structured JSON fields which are saved to Supabase metadata
 */

const express = require('express');
const { isDeepStrictEqual } = require('node:util');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { getGeminiConfig } = require('../lib/aiProvider');
const { getExtractionPrompt, validateExtractionData, SUPPORTED_EXTRACTION_CATEGORIES } = require('../lib/extractionSchema');
const { TAXFLOW_SYSTEM_PROMPT } = require('../lib/systemPrompt');
const { getOwnedClientIds } = require('../lib/ownership');
const { downloadDocument, isOwnedDocumentObject } = require('../lib/documentStorage');
const { saveInvoiceExport } = require('../lib/invoiceExport');
const { buildExtractionEnvelope, compareExtractionVersions } = require('../lib/extractionVersioning');
const { startExtractionRun, finishExtractionRun } = require('../lib/extractionRuns');
const { validateExtractedDataQuality } = require('../lib/extractionValidation');
const { fetchWithRetry } = require('../lib/providerRequest');

async function saveExtractionVersion({ userId, document, data, category, versionKind = 'ai', baseVersion = null, note = null, providerScore = null, providerRaw = null, fieldConfidence = {}, fieldEvidence = {}, validationWarnings = [], extractionRunId = null }) {
  const envelope = buildExtractionEnvelope({
    data,
    category,
    documentId: document.id,
    assessmentYear: document.assessment_year,
    versionKind,
    providerScore,
    providerRaw,
    fieldConfidence,
    fieldEvidence,
    validationWarnings,
  });
  if (extractionRunId) envelope.extraction_run_id = extractionRunId;
  const { data: version, error } = await supabase.rpc('save_extraction_version', {
    p_user_id: userId,
    p_document_id: document.id,
    p_version_kind: versionKind,
    p_data: envelope,
    p_provider_score: envelope.overall_score.provider_score,
    p_computed_score: envelope.overall_score.computed_score,
    p_schema_version: envelope.schema_version,
    p_base_version: baseVersion,
    p_note: note,
    p_changed_field_paths: [],
  });
  if (error) throw error;
  return { envelope, version };
}

/**
 * POST /api/v1/extraction/process
 * Read file from private Supabase Storage → Send to Gemini AI → Save result to Supabase
 * Body: { documentId, category? }
 */
router.post('/process', async (req, res) => {
  const startTime = Date.now();
  const { documentId, category } = req.body;

  if (!documentId) {
    return res.status(400).json({ success: false, message: 'documentId is required' });
  }

  let ownedDocument = null;
  let extractionRunId = null;
  try {
    // Step 1: Fetch document metadata from Supabase (or fallback)
    let doc = null;
    if (isConnected) {
      const ownedClientIds = await getOwnedClientIds(req.user.id);
      const { data, error } = await supabase
        .from('documents_metadata').select('*').eq('id', documentId).is('deletion_requested_at', null)
        .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000']).single();
      if (error) throw new Error(`Document not found in database: ${error.message}`);
      doc = data;
      ownedDocument = doc;
    } else {
      return res.status(503).json({
        success: false,
        message: 'AI extraction is not configured in this environment. Enable a local OpenRouter key or configure the backend AI provider.',
      });
    }

    if (doc.source === 'Telegram') {
      return res.status(404).json({ success: false, message: 'Telegram files are not available for extraction. Use the secure client portal for document uploads.' });
    }
    const docCategory = doc.category || category || 'General';
    if (!SUPPORTED_EXTRACTION_CATEGORIES.includes(docCategory)) {
      return res.status(422).json({ success: false, message: `The extraction category "${docCategory}" is not supported yet.` });
    }

    const { error: processingError } = await supabase.from('documents_metadata')
      .update({ extraction_status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', doc.id)
      .eq('client_id', doc.client_id);
    if (processingError) throw processingError;

    // Step 2: Read only from this user's private object namespace.
    if (!doc.storage_bucket || !doc.storage_object_path || !isOwnedDocumentObject({
        bucket: doc.storage_bucket,
        objectKey: doc.storage_object_path,
        userId: req.user.id,
        clientId: doc.client_id,
        documentId: doc.id
      })) {
      console.error(`[Extraction] Refusing unexpected cloud storage reference for document ${doc.id}.`);
      return res.status(409).json({ success: false, message: 'This document has not been migrated to private cloud storage.' });
    }
    const fileBuffer = await downloadDocument(doc.storage_bucket, doc.storage_object_path);

    // Step 3: Call Gemini AI if API key is available
    let extractedData = null;
    let inputTokens = 0, outputTokens = 0;
    let aiSuccess = false;
    const geminiConfig = await getGeminiConfig(req.user.id);
    extractionRunId = await startExtractionRun({
      userId: req.user.id,
      document: doc,
      provider: 'gemini',
      model: geminiConfig?.model || 'database-configured',
      schemaVersion: `${docCategory.toLowerCase()}-v1`,
      usageSource: 'provider_response',
    });
    const base64Content = fileBuffer.toString('base64');
    const mimeType = doc.mime_type || getMimeType(doc.file_type || 'PDF');
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
      return res.status(415).json({ success: false, message: 'AI extraction currently supports PDF, PNG, JPEG, and WEBP documents.' });
    }
    const geminiPayload = {
      systemInstruction: { parts: [{ text: TAXFLOW_SYSTEM_PROMPT }] },
      contents: [{
        parts: [
          { text: getExtractionPrompt(docCategory) },
          { inline_data: { mime_type: mimeType, data: base64Content } }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    };

    let geminiRes;
    try {
      geminiRes = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiConfig.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiConfig.apiKey },
          body: JSON.stringify(geminiPayload),
        },
        { timeoutMs: 30000 }
      );
    } catch (error) {
      const providerError = new Error(error.code === 'PROVIDER_TIMEOUT' || error.name === 'AbortError'
        ? 'The AI extraction provider took too long to respond. Please try again.'
        : 'The AI extraction provider could not be reached. Please try again.');
      providerError.status = error.code === 'PROVIDER_TIMEOUT' || error.name === 'AbortError' ? 504 : 502;
      throw providerError;
    } finally {
      clearTimeout(timeout);
    }
    let geminiJson;
    try {
      geminiJson = await geminiRes.json();
    } catch {
      const invalidResponseError = new Error('The AI extraction provider returned an invalid response.');
      invalidResponseError.status = 502;
      throw invalidResponseError;
    }
    if (!geminiRes.ok) {
      const error = new Error(geminiRes.status === 429
        ? 'The AI extraction provider is rate limited. Please wait and try again.'
        : 'The AI extraction provider could not process this document.');
      error.status = geminiRes.status === 429 ? 429 : 502;
      throw error;
    }

    const rawText = geminiJson.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!rawText) {
      const emptyResponseError = new Error('The AI extraction provider returned no usable text.');
      emptyResponseError.status = 502;
      throw emptyResponseError;
    }
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let providerPayload;
    try {
      providerPayload = JSON.parse(jsonText);
      const candidateData = providerPayload?.data && typeof providerPayload.data === 'object'
        && !Array.isArray(providerPayload.data) ? providerPayload.data : providerPayload;
      extractedData = validateExtractionData(candidateData, docCategory);
    } catch {
      const invalidOutputError = new Error('The AI extraction provider returned data that did not match the required format. Please retry.');
      invalidOutputError.status = 502;
      throw invalidOutputError;
    }
    aiSuccess = true;
    inputTokens = geminiJson.usageMetadata?.promptTokenCount || 0;
    outputTokens = geminiJson.usageMetadata?.candidatesTokenCount || 0;
    const duration = Date.now() - startTime;
    const confidenceScore = null;

    // Step 4: Save an immutable extraction version. Keep the flat mirror temporarily
    // because the existing review screen and GST workflow still consume it.
    const versionResult = await saveExtractionVersion({
      userId: req.user.id,
      document: doc,
      data: extractedData,
      category: docCategory,
      versionKind: doc.current_extraction_version ? 'ai_rerun' : 'ai',
      providerScore: providerPayload?.accuracy_score ?? providerPayload?.confidence_score,
      providerRaw: providerPayload,
      fieldConfidence: providerPayload?.field_confidence,
      fieldEvidence: providerPayload?.field_evidence,
      validationWarnings: validateExtractedDataQuality(extractedData, docCategory),
      extractionRunId,
    });
    const { data: updatedDoc, error: updateErr } = await supabase
      .from('documents_metadata')
      .update({
        status: 'Extracted',
        extracted_data: extractedData,
        confidence_score: versionResult?.envelope.overall_score.computed_score ?? confidenceScore,
      })
      .eq('id', doc.id)
      .eq('client_id', doc.client_id)
      .select().single();
    if (updateErr) throw updateErr;

    // Step 5: Log AI usage to Supabase ai_usage_log. The usage_source column is
    // additive; preserve extraction success if an older deployment has not run
    // the compatibility migration yet.
    const { error: usageError } = await supabase.from('ai_usage_log').insert([{
      client_id: doc.client_id, document_id: documentId,
      operation: 'extraction', model_used: geminiConfig?.model || 'database-configured',
      input_tokens: inputTokens, output_tokens: outputTokens,
      cost_usd: ((inputTokens * 0.000075 + outputTokens * 0.0003) / 1000),
      duration_ms: duration, success: aiSuccess, usage_source: 'provider_response'
    }]);
    if (usageError) console.warn('[Extraction] AI usage logging was skipped:', usageError.message);
    await finishExtractionRun(extractionRunId, {
      status: 'succeeded',
      inputTokens,
      outputTokens,
      costUsd: ((inputTokens * 0.000075 + outputTokens * 0.0003) / 1000),
      durationMs: duration,
      providerRequestId: geminiRes.headers.get('x-request-id'),
    });

    // Step 6: Increment AI call counter for this client
    try {
      await supabase.rpc('increment_client_ai_calls', { cid: doc.client_id });
    } catch (rpcError) {
      console.warn('[Extraction] Could not increment client AI call count:', rpcError.message);
    }

    res.json({
      success: true, source: 'supabase',
      message: 'Document extracted. Review all values before use.',
      data: {
        ...updatedDoc,
        extraction_version: versionResult?.version || null,
        extraction_envelope: versionResult?.envelope || null,
      }
    });

  } catch (err) {
    if (ownedDocument && supabase) {
      try {
        await supabase.from('documents_metadata')
          .update({ extraction_status: 'extraction_failed', updated_at: new Date().toISOString() })
          .eq('id', ownedDocument.id)
          .eq('client_id', ownedDocument.client_id);
      } catch (statusError) {
        console.warn('[Extraction] Could not record failed extraction status:', statusError.message);
      }
    }
    await finishExtractionRun(extractionRunId, {
      status: 'failed',
      durationMs: Date.now() - startTime,
      errorCode: err.status ? String(err.status) : 'EXTRACTION_FAILED',
      errorMessage: err.message,
    });
    console.error('[Extraction] Error:', err.message);
    res.status(Number.isInteger(err.status) ? err.status : 500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/extraction/save
 * Save results created directly by the desktop app without receiving an AI key.
 */
router.post('/save', async (req, res) => {
  const { documentId, extractedData } = req.body || {};
  const category = typeof req.body.category === 'string' ? req.body.category : 'General';
  if (typeof documentId !== 'string' || !documentId.trim()) {
    return res.status(400).json({ success: false, message: 'A document ID is required.' });
  }
  if (!extractedData || typeof extractedData !== 'object' || Array.isArray(extractedData)) {
    return res.status(400).json({ success: false, message: 'Extraction results must be a JSON object.' });
  }
  let extractionRunId = null;
  try {
    validateExtractionData(extractedData, category);
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  let serializedData;
  try {
    serializedData = JSON.stringify(extractedData);
  } catch {
    return res.status(400).json({ success: false, message: 'Extraction results are not valid JSON.' });
  }
  if (!serializedData || serializedData.length > 200_000) {
    return res.status(413).json({ success: false, message: 'Extraction results are too large to save.' });
  }

  if (!isConnected || !supabase) {
    return res.status(503).json({ success: false, message: 'Cloud extraction storage is unavailable. Reconnect to Supabase and try again.' });
  }

  try {
    const ownedClientIds = await getOwnedClientIds(req.user.id);
    if (!ownedClientIds.length) {
      return res.status(404).json({ success: false, message: 'This document was not found in your workspace.' });
    }

    const { data: document, error: documentError } = await supabase
      .from('documents_metadata')
      .select('id, client_id, client_name, file_name, source, category, current_extraction_version, created_at')
      .eq('id', documentId.trim())
      .in('client_id', ownedClientIds)
      .maybeSingle();
    if (documentError) throw documentError;
    if (!document || document.source === 'Telegram') {
      return res.status(404).json({ success: false, message: 'This document was not found or is not available for extraction.' });
    }

    const { data: documentWithOwnership, error: ownershipError } = await supabase
      .from('documents_metadata')
      .select('id, client_id, client_name, file_name, source, category, current_extraction_version, created_at, assessment_year')
      .eq('id', document.id)
      .eq('client_id', document.client_id)
      .single();
    if (ownershipError) throw ownershipError;
    const model = typeof req.body.model === 'string' ? req.body.model.slice(0, 200) : 'OpenRouter';
    const inputTokens = Number.isSafeInteger(req.body.inputTokens) && req.body.inputTokens >= 0 ? req.body.inputTokens : 0;
    const outputTokens = Number.isSafeInteger(req.body.outputTokens) && req.body.outputTokens >= 0 ? req.body.outputTokens : 0;
    const durationMs = Number.isSafeInteger(req.body.durationMs) && req.body.durationMs >= 0 ? req.body.durationMs : 0;
    extractionRunId = await startExtractionRun({
      userId: req.user.id,
      document: documentWithOwnership,
      provider: 'openrouter_local',
      model,
      schemaVersion: `${category.toLowerCase()}-v1`,
      usageSource: 'client_reported',
    });
    const versionResult = await saveExtractionVersion({
      userId: req.user.id,
      document: documentWithOwnership,
      data: extractedData,
      category,
      providerScore: req.body.providerScore,
      fieldEvidence: req.body.fieldEvidence,
      validationWarnings: validateExtractedDataQuality(extractedData, category),
      extractionRunId,
    });
    const { data: updatedDocument, error: updateError } = await supabase
      .from('documents_metadata')
      .update({
        status: 'Extracted',
        extracted_data: extractedData,
        confidence_score: versionResult?.envelope.overall_score.computed_score ?? null,
      })
      .eq('id', document.id)
      .eq('client_id', document.client_id)
      .select()
      .single();
    if (updateError) throw updateError;

    try {
      const { error: usageError } = await supabase.from('ai_usage_log').insert([{
        client_id: document.client_id,
        document_id: document.id,
        operation: 'extraction',
        model_used: `openrouter/${model}`,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: 0,
        duration_ms: durationMs,
        success: true,
        usage_source: 'client_reported',
      }]);
      if (usageError) throw usageError;
    } catch (usageError) {
      console.warn('[Extraction] Could not record local-key AI usage:', usageError.message);
    }
    await finishExtractionRun(extractionRunId, {
      status: 'succeeded',
      inputTokens,
      outputTokens,
      durationMs,
    });

    try {
      await supabase.rpc('increment_client_ai_calls', { cid: document.client_id });
    } catch (rpcError) {
      console.warn('[Extraction] Could not increment client AI call count:', rpcError.message);
    }

    return res.json({
      success: true,
      source: 'supabase',
      message: 'Document extracted with your local OpenRouter key.',
      data: {
        ...updatedDocument,
        extraction_version: versionResult?.version || null,
        extraction_envelope: versionResult?.envelope || null,
      },
    });
  } catch (error) {
    await finishExtractionRun(extractionRunId, {
      status: 'failed',
      errorCode: 'LOCAL_EXTRACTION_SAVE_FAILED',
      errorMessage: error.message,
    });
    console.error('[Extraction] Could not save local-key results:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save extraction results. Try again.' });
  }
});

router.post('/review', async (req, res) => {
  const { documentId, correctedData, existingInvoiceId } = req.body || {};
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof documentId !== 'string' || !uuidPattern.test(documentId)) {
    return res.status(400).json({ success: false, message: 'A valid source document ID is required.' });
  }
  if (existingInvoiceId !== undefined && (typeof existingInvoiceId !== 'string' || !uuidPattern.test(existingInvoiceId))) {
    return res.status(400).json({ success: false, message: 'The selected existing invoice is invalid.' });
  }
  try {
    validateExtractionData(correctedData, 'GST');
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  const serializedData = JSON.stringify(correctedData);
  if (serializedData.length > 200_000) {
    return res.status(413).json({ success: false, message: 'Reviewed invoice data is too large to save.' });
  }
  if (!isConnected || !supabase) {
    return res.status(503).json({ success: false, message: 'Invoice approval requires the cloud database and private document storage.' });
  }

  try {
    const { data: review, error: reviewError } = await supabase.rpc('begin_invoice_review', {
      p_user_id: req.user.id,
      p_document_id: documentId,
      p_reviewed_data: correctedData,
      p_existing_invoice_id: existingInvoiceId || null,
      p_reviewed_by: req.user.email || req.user.id
    });
    if (reviewError) {
      if (reviewError.code === 'P0002') return res.status(404).json({ success: false, message: reviewError.message });
      if (reviewError.code === '22023') return res.status(409).json({ success: false, message: reviewError.message });
      throw reviewError;
    }

    if (review?.status === 'duplicate_exact' || review?.status === 'duplicate_match') {
      return res.status(409).json({
        success: false,
        code: review.status === 'duplicate_exact' ? 'DUPLICATE_EXACT' : 'DUPLICATE_MATCH',
        message: review.status === 'duplicate_exact'
          ? 'This original file is already part of an approved invoice. No invoice or export was changed.'
          : 'An approved invoice with this supplier and invoice number already exists. Review the existing values before choosing whether to update it.',
        data: review
      });
    }
    if (review?.status === 'review_in_progress') {
      return res.status(409).json({
        success: false,
        code: 'REVIEW_IN_PROGRESS',
        message: 'This invoice is already being saved. Wait briefly, then retry this review.'
      });
    }
    if (!review || !['pending_export', 'completed'].includes(review.status)) {
      throw new Error('The invoice review could not be started.');
    }
    if (review.status === 'completed') {
      return res.json({ success: true, source: 'supabase', message: 'This invoice was already saved successfully.', data: review });
    }
    if (!isDeepStrictEqual(correctedData, review.reviewedData)) {
      return res.status(409).json({
        success: false,
        code: 'PENDING_REVIEW_DATA',
        message: 'A previous save attempt has a saved review snapshot. We restored it below; verify it and retry.',
        data: { reviewedData: review.reviewedData }
      });
    }

    const [{ data: client, error: clientError }, { data: sourceDocument, error: sourceError }, { data: invoice, error: invoiceError }] = await Promise.all([
      supabase.from('clients').select('id, name').eq('id', review.clientId).eq('user_id', req.user.id).maybeSingle(),
      supabase.from('documents_metadata').select('id, assessment_year, created_at').eq('id', documentId).eq('client_id', review.clientId).maybeSingle(),
      supabase.from('invoice_records').select('current_version').eq('id', review.invoiceRecordId).eq('client_id', review.clientId).maybeSingle()
    ]);
    if (clientError) throw clientError;
    if (sourceError) throw sourceError;
    if (invoiceError) throw invoiceError;
    if (!client || !sourceDocument || !invoice) {
      throw new Error('The client, source document, or pending invoice record is no longer available.');
    }

    const invoiceVersion = Number(invoice.current_version || 0) + 1;
    const exportSha256 = await saveInvoiceExport({
      request: {
        ...review,
        clientId: review.clientId,
        createdAt: review.createdAt || sourceDocument.created_at,
        reviewedBy: review.reviewedBy || req.user.email || req.user.id
      },
      userId: req.user.id,
      client,
      sourceDocument,
      invoiceVersion
    });

    const { data: completed, error: completionError } = await supabase.rpc('complete_invoice_review', {
      p_user_id: req.user.id,
      p_document_id: documentId,
      p_export_sha256: exportSha256
    });
    if (completionError) throw completionError;
    if (completed?.status !== 'completed') throw new Error('The invoice export was saved, but approval could not be finalized.');

    return res.json({
      success: true,
      source: 'supabase',
      message: review.action === 'update'
        ? 'The existing invoice was updated. Its previous version remains in history.'
        : 'The invoice, review history, and private Extracted-folder export were saved.',
      data: completed
    });
  } catch (error) {
    console.error(`[Extraction] Invoice review could not be finalized for ${documentId}:`, error.message);
    return res.status(Number.isInteger(error.status) ? error.status : 503).json({
      success: false,
      code: 'INVOICE_REVIEW_PENDING',
      message: 'The invoice is not marked approved yet. Keep this review open and retry the save.'
    });
  }
});

async function getOwnedExtractionDocument(userId, documentId) {
  const ownedClientIds = await getOwnedClientIds(userId);
  const { data, error } = await supabase
    .from('documents_metadata')
    .select('id, client_id, category, extraction_status, current_extraction_version, approved_extraction_version')
    .eq('id', documentId)
    .is('deletion_requested_at', null)
    .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * GET /api/v1/extraction/versions/:documentId
 * Read immutable extraction history, distinct from physical file versions.
 */
router.get('/versions/:documentId', async (req, res) => {
  try {
    if (!isConnected || !supabase) return res.status(503).json({ success: false, message: 'Extraction history requires the cloud database.' });
    const document = await getOwnedExtractionDocument(req.user.id, req.params.documentId);
    if (!document) return res.status(404).json({ success: false, message: 'Document not found.' });
    const { data, error } = await supabase
      .from('extraction_versions')
      .select('*')
      .eq('document_id', document.id)
      .order('version_number', { ascending: true });
    if (error) throw error;
    return res.json({ success: true, source: 'supabase', data: { document, versions: data || [] } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Extraction history could not be loaded.' });
  }
});

/**
 * GET /api/v1/extraction/versions/:documentId/compare?from=1&to=2
 */
router.get('/versions/:documentId/compare', async (req, res) => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < 1 || from === to) {
    return res.status(400).json({ success: false, message: 'Choose two different positive extraction version numbers.' });
  }
  try {
    if (!isConnected || !supabase) return res.status(503).json({ success: false, message: 'Extraction comparison requires the cloud database.' });
    const document = await getOwnedExtractionDocument(req.user.id, req.params.documentId);
    if (!document) return res.status(404).json({ success: false, message: 'Document not found.' });
    const { data, error } = await supabase.from('extraction_versions')
      .select('version_number, version_kind, data, created_by, created_at')
      .eq('document_id', document.id)
      .in('version_number', [from, to]);
    if (error) throw error;
    const before = (data || []).find(version => version.version_number === from);
    const after = (data || []).find(version => version.version_number === to);
    if (!before || !after) return res.status(404).json({ success: false, message: 'One or both extraction versions were not found.' });
    return res.json({ success: true, source: 'supabase', data: {
      document,
      from: before,
      to: after,
      comparison: compareExtractionVersions(before.data, after.data),
    } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Extraction versions could not be compared.' });
  }
});

/**
 * POST /api/v1/extraction/versions/:documentId/restore
 * Restore creates a new immutable version; it never overwrites history.
 */
router.post('/versions/:documentId/restore', async (req, res) => {
  const sourceVersion = Number(req.body?.versionNumber);
  const expectedCurrentVersion = Number(req.body?.expectedCurrentVersion);
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
    return res.status(400).json({ success: false, message: 'A positive source extraction version is required.' });
  }
  if (!Number.isInteger(expectedCurrentVersion) || expectedCurrentVersion < 1) {
    return res.status(400).json({ success: false, message: 'The current extraction version is required for safe restore.' });
  }
  try {
    if (!isConnected || !supabase) return res.status(503).json({ success: false, message: 'Extraction restore requires the cloud database.' });
    const document = await getOwnedExtractionDocument(req.user.id, req.params.documentId);
    if (!document) return res.status(404).json({ success: false, message: 'Document not found.' });
    const { data, error } = await supabase.rpc('restore_extraction_version', {
      p_user_id: req.user.id,
      p_document_id: document.id,
      p_source_version: sourceVersion,
      p_expected_current_version: expectedCurrentVersion,
      p_note: typeof req.body.note === 'string' ? req.body.note.slice(0, 2000) : null,
    });
    if (error) {
      if (error.code === 'P0002') return res.status(404).json({ success: false, message: error.message });
      if (error.code === '40001') return res.status(409).json({ success: false, message: error.message });
      if (error.code === '22023') return res.status(409).json({ success: false, message: error.message });
      throw error;
    }
    return res.json({ success: true, source: 'supabase', message: 'A new restored extraction version was created and the document requires review again.', data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'The extraction version could not be restored.' });
  }
});

/**
 * GET /api/v1/extraction/pending
 * Get all documents awaiting CA review/verification
 */
router.get('/pending', async (req, res) => {
  try {
    if (isConnected) {
      const { data, error } = await supabase
        .from('documents_metadata')
        .select('*')
        .in('client_id', (await getOwnedClientIds(req.user.id)).length ? await getOwnedClientIds(req.user.id) : ['00000000-0000-0000-0000-000000000000'])
        .in('status', ['Extracted'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data });
    }
    res.json({ success: true, count: 1, source: 'demo', data: [
      { id: 'doc-101', file_name: 'GST_Invoice_Sep_2026.pdf', status: 'Extracted', confidence_score: 96, category: 'GST' }
    ]});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/v1/extraction/ai-usage
 * Get AI usage statistics (total calls, tokens, cost)
 */
router.get('/ai-usage', async (req, res) => {
  try {
    if (isConnected) {
      const { data, error } = await supabase
        .from('ai_usage_log')
        .select('operation, model_used, input_tokens, output_tokens, cost_usd, success, created_at')
        .in('client_id', (await getOwnedClientIds(req.user.id)).length ? await getOwnedClientIds(req.user.id) : ['00000000-0000-0000-0000-000000000000'])
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;

      const totalCost = data.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
      const totalCalls = data.length;
      return res.json({ success: true, source: 'supabase', totalCalls, totalCostUSD: totalCost.toFixed(4), data });
    }
    res.json({
      success: true, source: 'demo',
      totalCalls: 22, totalCostUSD: '0.0034',
      data: [{ operation: 'extraction', model_used: 'database-configured', success: true, created_at: new Date().toISOString() }]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Helpers ---

function getMimeType(fileType) {
  const map = { 'PDF': 'application/pdf', 'PNG': 'image/png', 'JPG': 'image/jpeg', 'JPEG': 'image/jpeg', 'WEBP': 'image/webp' };
  return map[fileType?.toUpperCase()] || 'application/pdf';
}

module.exports = router;
