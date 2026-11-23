const crypto = require('node:crypto');
const contracts = require('../../../packages/extraction-contracts/contracts.json');

const FIELD_ALIASES = {
  GST: {
    'invoice no': 'invoice_number',
    'bill no': 'invoice_number',
    'invoice date': 'invoice_date',
    'bill date': 'invoice_date',
    'supplier name': 'vendor_name',
    'seller name': 'vendor_name',
    'supplier gstin': 'vendor_gstin',
    'seller gstin': 'vendor_gstin',
    'customer gstin': 'buyer_gstin',
    'buyer gstin': 'buyer_gstin',
    'total taxable value': 'taxable_value',
    'total tax': 'total_gst',
    'invoice total': 'grand_total',
    'total invoice value': 'grand_total',
  },
  Form16: {
    'gross salary': 'gross_salary',
    'salary.gross_salary': 'gross_salary',
    'gross pay': 'gross_salary',
    'total salary': 'gross_salary',
    'employee name': 'employee_name',
    'taxpayer name': 'employee_name',
    'taxpayer.name': 'employee_name',
    'name of employee': 'employee_name',
    'pan no': 'employee_pan',
    'pan number': 'employee_pan',
    'taxpayer.pan': 'employee_pan',
    'permanent account number': 'employee_pan',
    'tax deducted': 'total_tds',
    'tds deducted': 'total_tds',
    'tax.tds_deducted': 'total_tds',
    'tds': 'total_tds',
  },
  BankStatement: {
    'account number': 'account_number',
    'account.account_number': 'account_number',
    'a/c number': 'account_number',
    'account no': 'account_number',
    'account holder': 'account_holder',
    'account.holder_name': 'account_holder',
    'account holder name': 'account_holder',
    'opening balance': 'opening_balance',
    'balances.opening_balance': 'opening_balance',
    'closing balance': 'closing_balance',
    'balances.closing_balance': 'closing_balance',
    'interest earned': 'total_credits',
    'savings interest': 'total_credits',
  },
  IncomeTax: {
    'taxpayer name': 'taxpayer_name',
    'taxpayer.name': 'taxpayer_name',
    'name of taxpayer': 'taxpayer_name',
    'pan no': 'pan',
    'pan number': 'pan',
    'taxpayer.pan': 'pan',
    'gross total income': 'gross_total_income',
    'income.gross_total_income': 'gross_total_income',
    'total income': 'total_income',
    'tds deducted': 'tds_deducted',
    'tax.tds_deducted': 'tds_deducted',
  },
  ITR1: {
    'taxpayer name': 'name',
    'taxpayer.name': 'name',
    'name': 'name',
    'pan no': 'pan',
    'pan number': 'pan',
    'taxpayer.pan': 'pan',
    'gross total income': 'gross_total_income',
    'total income': 'total_income',
    'tds deducted': 'tds_total',
  },
  ITR2: {
    'taxpayer name': 'name',
    'taxpayer.name': 'name',
    'name': 'name',
    'pan no': 'pan',
    'pan number': 'pan',
    'taxpayer.pan': 'pan',
    'gross total income': 'gross_total_income',
    'total income': 'total_income',
    'tds deducted': 'tds_total',
  },
};

const LEGACY_PATH_MIRRORS = {
  gross_salary: 'salary.gross_salary',
  employee_pan: 'taxpayer.pan',
  pan: 'taxpayer.pan',
  employee_name: 'taxpayer.name',
  total_tds: 'tax.tds_deducted',
  account_number: 'account.account_number',
  account_holder: 'account.holder_name',
  opening_balance: 'balances.opening_balance',
  closing_balance: 'balances.closing_balance',
  gross_total_income: 'income.gross_total_income',
};

const KNOWN_FIELDS = Object.fromEntries(Object.entries(contracts.categories).map(([category, schema]) => [
  category,
  new Set(Object.keys(schema.properties || {})),
]));

function normalizeLabel(label) {
  return String(label || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()\[\]{}:.,#]/g, ' ')
    .replace(/\b(number|no\.)\b/g, 'no')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeFields(data, category) {
  const aliases = FIELD_ALIASES[category] || {};
  const fields = {};
  const extraFields = {};
  const normalizationEvents = [];

  for (const [rawKey, value] of Object.entries(data || {})) {
    const normalized = normalizeLabel(rawKey);
    const canonicalPath = aliases[normalized] || rawKey;
    const entry = {
      value,
      normalized_value: value,
      raw_label: rawKey,
      raw_text: typeof value === 'string' ? value : null,
      confidence: null,
      page: null,
      status: value === null ? 'not_present' : 'found',
      normalization_rule: canonicalPath === rawKey ? null : `${category}.aliases.v1`,
    };

    if (aliases[normalized] || canonicalPath.includes('.') || KNOWN_FIELDS[category]?.has(rawKey) || KNOWN_FIELDS[category]?.has(canonicalPath)) {
      if (fields[canonicalPath]) {
        extraFields[rawKey] = value;
        normalizationEvents.push({ raw_label: rawKey, canonical_path: null, status: 'ambiguous' });
      } else {
        fields[canonicalPath] = entry;
        // Mirror legacy dotted path for backwards compatibility
        const legacyMirror = LEGACY_PATH_MIRRORS[canonicalPath];
        if (legacyMirror && !fields[legacyMirror]) {
          fields[legacyMirror] = { ...entry };
        }
        normalizationEvents.push({ raw_label: rawKey, canonical_path: canonicalPath, status: aliases[normalized] ? 'mapped' : 'canonical' });
      }
    } else {
      extraFields[rawKey] = value;
      normalizationEvents.push({ raw_label: rawKey, canonical_path: null, status: 'unmapped' });
    }
  }

  return { fields, extra_fields: extraFields, normalization_events: normalizationEvents };
}

function calculateExtractionScore(envelope) {
  const values = Object.values(envelope.fields || {});
  const found = values.filter(field => field.status === 'found' || (field.value !== null && field.value !== undefined)).length;
  const presentRatio = values.length ? found / values.length : 0;
  const warningPenalty = Math.min(0.25, (envelope.warnings || []).length * 0.03);
  const completeness = Number(Math.max(0, Math.min(1, presentRatio)).toFixed(4));

  // High confidence fields: confidence >= 0.80 and no warning on this field
  const warningFields = new Set((envelope.warnings || []).map(w => w.path || w.field).filter(Boolean));
  const highConfidenceCount = values.filter(field => {
    const isFound = field.status === 'found' || (field.value !== null && field.value !== undefined);
    const conf = toFiniteNumber(field.confidence);
    const hasWarning = warningFields.has(field.raw_label) || warningFields.has(field.canonical_path);
    return isFound && (conf === null || conf >= 0.80) && !hasWarning;
  }).length;

  const reviewScore = Number(Math.max(0, Math.min(1, (values.length ? (highConfidenceCount / values.length) : 0) - warningPenalty)).toFixed(4));
  const computedScore = Math.max(0, Math.min(1, presentRatio - warningPenalty));

  const providerScores = values.map(field => toFiniteNumber(field.confidence)).filter(score => score !== null);
  const providerScore = providerScores.length
    ? Number((providerScores.reduce((sum, score) => sum + score, 0) / providerScores.length).toFixed(4))
    : null;

  return {
    provider_score: providerScore,
    computed_score: Number(computedScore.toFixed(4)),
    review_score: reviewScore,
    completeness,
    model_confidence: providerScore,
    score_basis: ['confidence_threshold_0.80', 'field_presence', 'format_checks', 'source_evidence'],
  };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getFieldsNeedingReview(envelope) {
  const needsReview = [];
  const warningFields = new Set((envelope.warnings || []).map(w => w.path || w.field).filter(Boolean));
  for (const [path, field] of Object.entries(envelope.fields || {})) {
    // Skip mirrored dotted duplicates to keep needs_review clean
    if (path.includes('.') && Object.values(LEGACY_PATH_MIRRORS).includes(path)) continue;
    const conf = toFiniteNumber(field.confidence);
    const isFound = field.status === 'found' || (field.value !== null && field.value !== undefined);
    const hasWarn = warningFields.has(path) || warningFields.has(field.raw_label);
    if (!isFound || (conf !== null && conf < 0.80) || hasWarn || field.status === 'ambiguous' || field.status === 'unreadable') {
      needsReview.push({
        field: path,
        status: field.status || (isFound ? 'found' : 'missing'),
        confidence: conf,
        raw_text: field.raw_text,
        warning: hasWarn,
      });
    }
  }
  return needsReview;
}

function buildExtractionEnvelope({
  data,
  category,
  documentId,
  document = null,
  assessmentYear,
  versionNumber = 1,
  versionKind = 'ai',
  providerScore = null,
  providerRaw = null,
  fieldConfidence = {},
  fieldEvidence = {},
  validationWarnings = [],
  fileName = null,
  mimeType = null,
  sizeBytes = null,
  sha256 = null,
}) {
  const canonical = canonicalizeFields(data, category);
  const envelope = {
    document_id: documentId,
    jurisdiction: 'IN',
    return_type: ['IncomeTax', 'ITR1', 'ITR2'].includes(category) ? 'ITR-1/ITR-2' : null,
    document_type: category,
    assessment_year: assessmentYear || null,
    schema_version: `${String(category || 'General').toLowerCase()}-v1`,
    version_number: versionNumber,
    version_kind: versionKind,
    file_name: fileName || document?.file_name || null,
    mime_type: mimeType || document?.mime_type || null,
    size_bytes: sizeBytes || (document?.file_size_kb ? Math.round(document.file_size_kb * 1024) : null),
    sha256: sha256 || document?.file_sha256 || null,
    prompt_version: 'orvexa-extraction-v2',
    source_data: data,
    fields: canonical.fields,
    extra_fields: canonical.extra_fields,
    warnings: Array.isArray(validationWarnings) ? validationWarnings : [],
    provider_raw: providerRaw,
    normalization_events: canonical.normalization_events,
  };

  for (const [path, confidence] of Object.entries(fieldConfidence || {})) {
    const numericConfidence = toFiniteNumber(confidence);
    if (envelope.fields[path] && numericConfidence !== null) {
      envelope.fields[path].confidence = Math.max(0, Math.min(1, numericConfidence));
    }
    const legacyPath = LEGACY_PATH_MIRRORS[path];
    if (legacyPath && envelope.fields[legacyPath] && numericConfidence !== null) {
      envelope.fields[legacyPath].confidence = Math.max(0, Math.min(1, numericConfidence));
    }
  }

  for (const [path, evidence] of Object.entries(fieldEvidence || {})) {
    const targetFields = [envelope.fields[path], envelope.fields[LEGACY_PATH_MIRRORS[path]]].filter(Boolean);
    if (!targetFields.length || !evidence || typeof evidence !== 'object') continue;
    for (const field of targetFields) {
      if (Number.isInteger(evidence.page) && evidence.page > 0) field.page = evidence.page;
      const quote = evidence.quote ?? evidence.text ?? evidence.raw_text;
      if (typeof quote === 'string' && quote.trim()) field.raw_text = quote.trim().slice(0, 2000);
    }
  }

  envelope.overall_score = calculateExtractionScore(envelope);
  const numericProviderScore = toFiniteNumber(providerScore);
  if (numericProviderScore !== null) {
    envelope.overall_score.provider_score = numericProviderScore;
    envelope.overall_score.model_confidence = numericProviderScore;
  }
  envelope.needs_review = getFieldsNeedingReview(envelope);
  envelope.scores = {
    model_confidence: envelope.overall_score.provider_score,
    completeness: envelope.overall_score.completeness,
    review_score: envelope.overall_score.review_score,
  };
  envelope.validation = envelope.warnings;

  return envelope;
}

function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function diffFields(before, after) {
  const paths = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...paths].filter(path => JSON.stringify(before?.[path]) !== JSON.stringify(after?.[path]));
}

function compareExtractionVersions(before, after) {
  const beforeFields = before?.fields || {};
  const afterFields = after?.fields || {};
  const paths = new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)]);
  const changes = [...paths]
    .filter(path => JSON.stringify(beforeFields[path]?.normalized_value) !== JSON.stringify(afterFields[path]?.normalized_value)
      || beforeFields[path]?.status !== afterFields[path]?.status)
    .sort()
    .map(path => ({
      path,
      before: beforeFields[path] || null,
      after: afterFields[path] || null,
    }));
  return { changedFieldPaths: changes.map(change => change.path), changes };
}

module.exports = {
  buildExtractionEnvelope,
  calculateExtractionScore,
  canonicalizeFields,
  contentHash,
  diffFields,
  compareExtractionVersions,
  normalizeLabel,
  getFieldsNeedingReview,
};
