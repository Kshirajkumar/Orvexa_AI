/**
 * TaxFlow.AI — Deep Extraction Engine Module
 *
 * Encapsulates the entire document extraction lifecycle:
 * - Document content retrieval from private storage
 * - Provider prompt construction (system prompt + domain category prompt)
 * - Resilient provider request execution with retries and timeout protection
 * - Extraction parsing, sanitization, and schema validation
 * - Quality validation against extraction contracts
 * - Immutable extraction version envelope construction and RPC persistence
 * - Provider adapter seam: GeminiProviderAdapter (production) and MockProviderAdapter (tests)
 */

const { supabase: defaultSupabase } = require('../db/supabase');
const {
  getCategoryUserPrompt,
  parseBoundedJsonObject,
  sanitizeExtractionCandidate,
  validateExtractionData,
  SUPPORTED_EXTRACTION_CATEGORIES,
} = require('./extractionSchema');
const { ORVEXA_EXTRACTION_SYSTEM_PROMPT } = require('./systemPrompt');
const { buildExtractionEnvelope } = require('./extractionVersioning');
const { validateExtractedDataQuality } = require('./extractionValidation');
const { fetchWithRetry } = require('./providerRequest');
const { downloadDocument } = require('./documentStorage');

/**
 * Saves an immutable extraction version envelope via Supabase RPC.
 */
async function saveExtractionVersion({
  userId,
  document,
  data,
  category,
  versionKind = 'ai',
  baseVersion = null,
  note = null,
  providerScore = null,
  providerRaw = null,
  fieldConfidence = {},
  fieldEvidence = {},
  validationWarnings = [],
  extractionRunId = null,
  supabaseClient = defaultSupabase,
}) {
  const envelope = buildExtractionEnvelope({
    data,
    category,
    documentId: document.id,
    document,
    assessmentYear: document.assessment_year,
    versionKind,
    providerScore,
    providerRaw,
    fieldConfidence,
    fieldEvidence,
    validationWarnings,
    fileName: document.file_name,
    mimeType: document.mime_type,
    sizeBytes: document.file_size_kb ? Math.round(document.file_size_kb * 1024) : null,
    sha256: document.file_sha256,
  });
  if (extractionRunId) envelope.extraction_run_id = extractionRunId;
  const { data: version, error } = await supabaseClient.rpc('save_extraction_version', {
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
 * Parses raw provider text, extracts confidence/evidence, sanitizes, and validates schema.
 */
function parseAndValidateExtractionOutput(rawText, docCategory) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    const emptyResponseError = new Error('The AI extraction provider returned no usable text.');
    emptyResponseError.status = 502;
    throw emptyResponseError;
  }

  let providerPayload;
  let fieldConfidence = {};
  let fieldEvidence = {};
  try {
    providerPayload = parseBoundedJsonObject(rawText);
    let candidateData = {};
    if (providerPayload?.fields && typeof providerPayload.fields === 'object' && !Array.isArray(providerPayload.fields)) {
      for (const [key, fieldObj] of Object.entries(providerPayload.fields)) {
        if (fieldObj && typeof fieldObj === 'object' && ('value' in fieldObj || 'confidence' in fieldObj)) {
          candidateData[key] = fieldObj.value ?? null;
          if (fieldObj.confidence !== undefined) fieldConfidence[key] = fieldObj.confidence;
          if (fieldObj.page || fieldObj.raw_text) {
            fieldEvidence[key] = { page: fieldObj.page, quote: fieldObj.raw_text };
          }
        } else {
          candidateData[key] = fieldObj;
        }
      }
      if (providerPayload.line_items && typeof providerPayload.line_items === 'object') {
        candidateData.line_items = providerPayload.line_items;
      }
    } else if (providerPayload?.data && typeof providerPayload.data === 'object' && !Array.isArray(providerPayload.data)) {
      candidateData = { ...providerPayload.data };
      fieldConfidence = providerPayload.field_confidence || {};
      fieldEvidence = providerPayload.field_evidence || {};
    } else {
      candidateData = { ...providerPayload };
    }

    const sanitized = sanitizeExtractionCandidate(candidateData, docCategory);
    const extractedData = validateExtractionData(sanitized.validData, docCategory);
    return {
      extractedData,
      providerPayload,
      fieldConfidence,
      fieldEvidence,
    };
  } catch (err) {
    if (err.status) throw err;
    const invalidOutputError = new Error('The AI extraction provider returned data that did not match the required format. Please retry.');
    invalidOutputError.status = 502;
    throw invalidOutputError;
  }
}

/**
 * Default production Gemini provider adapter.
 */
class GeminiProviderAdapter {
  constructor({ apiKey, model, fetchImpl = fetchWithRetry, timeoutMs = 30000 }) {
    this.apiKey = apiKey;
    this.model = model || 'gemini-1.5-flash';
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async extract({ mimeType, base64Content, docCategory, assessmentYear, clientName }) {
    const userPrompt = getCategoryUserPrompt(docCategory, { assessmentYear, clientName });
    const payload = {
      systemInstruction: { parts: [{ text: ORVEXA_EXTRACTION_SYSTEM_PROMPT }] },
      contents: [{
        parts: [
          { text: userPrompt },
          { inline_data: { mime_type: mimeType, data: base64Content } }
        ]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    let response;
    try {
      response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(payload),
        },
        { timeoutMs: this.timeoutMs }
      );
    } catch (error) {
      const providerError = new Error(error.code === 'PROVIDER_TIMEOUT' || error.name === 'AbortError'
        ? 'The AI extraction provider took too long to respond. Please try again.'
        : 'The AI extraction provider could not be reached. Please try again.');
      providerError.status = error.code === 'PROVIDER_TIMEOUT' || error.name === 'AbortError' ? 504 : 502;
      throw providerError;
    }

    let json;
    try {
      json = await response.json();
    } catch {
      const invalidResponseError = new Error('The AI extraction provider returned an invalid response.');
      invalidResponseError.status = 502;
      throw invalidResponseError;
    }

    if (!response.ok) {
      const error = new Error(response.status === 429
        ? 'The AI extraction provider is rate limited. Please wait and try again.'
        : 'The AI extraction provider could not process this document.');
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }

    const rawText = json.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    const inputTokens = json.usageMetadata?.promptTokenCount || 0;
    const outputTokens = json.usageMetadata?.candidatesTokenCount || 0;
    const providerRequestId = response.headers?.get ? response.headers.get('x-request-id') : null;

    return {
      rawText,
      inputTokens,
      outputTokens,
      providerRequestId,
    };
  }
}

/**
 * Mock provider adapter for fast, deterministic, zero-cost unit testing.
 */
class MockProviderAdapter {
  constructor(mockOutput = {}) {
    this.mockOutput = mockOutput;
  }

  async extract() {
    return {
      rawText: typeof this.mockOutput === 'string' ? this.mockOutput : JSON.stringify(this.mockOutput),
      inputTokens: 100,
      outputTokens: 50,
      providerRequestId: 'mock-request-id-123',
    };
  }
}

/**
 * Deep extraction execution function.
 * Coordinates document downloading, provider extraction, output parsing,
 * quality validation, and envelope version persistence.
 */
async function processDocumentExtraction({
  userId,
  document,
  category,
  providerAdapter,
  downloadFn = downloadDocument,
  supabaseClient = defaultSupabase,
  extractionRunId = null,
}) {
  const docCategory = category || document.category || 'General';
  if (!SUPPORTED_EXTRACTION_CATEGORIES.includes(docCategory)) {
    const error = new Error(`The extraction category "${docCategory}" is not supported yet.`);
    error.status = 422;
    throw error;
  }

  const mimeType = document.mime_type || (document.file_type === 'PDF' ? 'application/pdf' : 'image/jpeg');
  const fileBuffer = await downloadFn(document.storage_bucket, document.storage_object_path);
  const base64Content = fileBuffer.toString('base64');

  const { rawText, inputTokens, outputTokens, providerRequestId } = await providerAdapter.extract({
    mimeType,
    base64Content,
    docCategory,
    assessmentYear: document.assessment_year,
    clientName: document.client_name,
  });

  const {
    extractedData,
    providerPayload,
    fieldConfidence,
    fieldEvidence,
  } = parseAndValidateExtractionOutput(rawText, docCategory);

  const validationWarnings = validateExtractedDataQuality(extractedData, docCategory);

  const versionResult = await saveExtractionVersion({
    userId,
    document,
    data: extractedData,
    category: docCategory,
    versionKind: document.current_extraction_version ? 'ai_rerun' : 'ai',
    providerScore: providerPayload?.model_overall_confidence ?? providerPayload?.accuracy_score ?? providerPayload?.confidence_score,
    providerRaw: providerPayload,
    fieldConfidence,
    fieldEvidence,
    validationWarnings,
    extractionRunId,
    supabaseClient,
  });

  return {
    extractedData,
    docCategory,
    inputTokens,
    outputTokens,
    providerRequestId,
    versionResult,
  };
}

module.exports = {
  saveExtractionVersion,
  parseAndValidateExtractionOutput,
  processDocumentExtraction,
  GeminiProviderAdapter,
  MockProviderAdapter,
};
