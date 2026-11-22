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
    'gross salary': 'salary.gross_salary',
    'gross pay': 'salary.gross_salary',
    'total salary': 'salary.gross_salary',
    'employee name': 'taxpayer.name',
    'taxpayer name': 'taxpayer.name',
    'name of employee': 'taxpayer.name',
    'pan no': 'taxpayer.pan',
    'pan number': 'taxpayer.pan',
    'permanent account number': 'taxpayer.pan',
    'tax deducted': 'tax.tds_deducted',
    'tds deducted': 'tax.tds_deducted',
    'tds': 'tax.tds_deducted',
  },
  BankStatement: {
    'account number': 'account.account_number',
    'a/c number': 'account.account_number',
    'account no': 'account.account_number',
    'account holder': 'account.holder_name',
    'account holder name': 'account.holder_name',
    'opening balance': 'balances.opening_balance',
    'closing balance': 'balances.closing_balance',
    'interest earned': 'income.interest',
    'savings interest': 'income.interest',
  },
  IncomeTax: {
    'taxpayer name': 'taxpayer.name',
    'name of taxpayer': 'taxpayer.name',
    'pan no': 'taxpayer.pan',
    'pan number': 'taxpayer.pan',
    'gross total income': 'income.gross_total_income',
    'total income': 'income.gross_total_income',
    'tds deducted': 'tax.tds_deducted',
  },
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

    if (aliases[normalized] || canonicalPath.includes('.') || KNOWN_FIELDS[category]?.has(rawKey)) {
      if (fields[canonicalPath]) {
        extraFields[rawKey] = value;
        normalizationEvents.push({ raw_label: rawKey, canonical_path: null, status: 'ambiguous' });
      } else {
        fields[canonicalPath] = entry;
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
  const found = values.filter(field => field.status === 'found').length;
  const presentRatio = values.length ? found / values.length : 0;
  const warningPenalty = Math.min(0.25, (envelope.warnings || []).length * 0.03);
  const computedScore = Math.max(0, Math.min(1, presentRatio - warningPenalty));
  const providerScores = values.map(field => toFiniteNumber(field.confidence)).filter(score => score !== null);
  const providerScore = providerScores.length
    ? providerScores.reduce((sum, score) => sum + score, 0) / providerScores.length
    : null;
  return {
    provider_score: providerScore,
    computed_score: Number(computedScore.toFixed(4)),
    review_score: null,
    score_basis: ['field_presence', 'format_checks', 'source_evidence'],
  };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildExtractionEnvelope({ data, category, documentId, assessmentYear, versionNumber = 1, versionKind = 'ai', providerScore = null, providerRaw = null, fieldConfidence = {}, fieldEvidence = {}, validationWarnings = [] }) {
  const canonical = canonicalizeFields(data, category);
  const envelope = {
    document_id: documentId,
    jurisdiction: 'IN',
    return_type: category === 'IncomeTax' ? 'ITR-1/ITR-2' : null,
    document_type: category,
    assessment_year: assessmentYear || null,
    schema_version: `${String(category || 'General').toLowerCase()}-v1`,
    version_number: versionNumber,
    version_kind: versionKind,
    source_data: data,
    fields: canonical.fields,
    extra_fields: canonical.extra_fields,
    warnings: Array.isArray(validationWarnings) ? validationWarnings : [],
    provider_raw: providerRaw,
    normalization_events: canonical.normalization_events,
  };
  for (const [path, confidence] of Object.entries(fieldConfidence || {})) {
    const numericConfidence = toFiniteNumber(confidence);
    if (envelope.fields[path] && numericConfidence !== null) envelope.fields[path].confidence = Math.max(0, Math.min(1, numericConfidence));
  }
  for (const [path, evidence] of Object.entries(fieldEvidence || {})) {
    if (!envelope.fields[path] || !evidence || typeof evidence !== 'object') continue;
    if (Number.isInteger(evidence.page) && evidence.page > 0) envelope.fields[path].page = evidence.page;
    const quote = evidence.quote ?? evidence.text ?? evidence.raw_text;
    if (typeof quote === 'string' && quote.trim()) envelope.fields[path].raw_text = quote.trim().slice(0, 2000);
  }
  envelope.overall_score = calculateExtractionScore(envelope);
  const numericProviderScore = toFiniteNumber(providerScore);
  if (numericProviderScore !== null) envelope.overall_score.provider_score = numericProviderScore;
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
};
