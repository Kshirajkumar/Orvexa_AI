const contracts = require('../../../packages/extraction-contracts/contracts.json');

const EXTRACTION_SCHEMAS = contracts.categories;
const SUPPORTED_EXTRACTION_CATEGORIES = Object.freeze(Object.keys(EXTRACTION_SCHEMAS));
const MAX_PROVIDER_JSON_CHARS = 200_000;

function getSchema(category) {
  return EXTRACTION_SCHEMAS[category] || null;
}

function promptShape(schema) {
  if (schema?.type === 'object') {
    if (schema.additionalProperties) return {};
    return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, value]) => [key, promptShape(value)]));
  }
  if (schema?.type === 'array') {
    if (schema.items?.type !== 'object' || schema.items.additionalProperties) return [];
    return [promptShape(schema.items)];
  }
  return null;
}

function getExtractionPrompt(category) {
  const schema = getSchema(category);
  if (!schema) throw new Error(`The extraction category "${category}" is not supported yet.`);
  const accuracyInstruction = category === 'GST'
    ? 'Return the exact object shape only.'
    : 'Return {"data": <the object shape above>, "accuracy_score": <number from 0 to 1>, "field_confidence": {"canonical_field_name": <number from 0 to 1>}, "field_evidence": {"canonical_field_name": {"page": <positive integer>, "quote": <short visible source text>}}}.';
  return `Extract the visible information from this document. ${accuracyInstruction}\n${JSON.stringify(promptShape(schema), null, 2)}\n\nRules: preserve names, identifiers, dates, and amounts as shown; do not calculate, infer, normalize, or invent missing values. Use null for unreadable or absent scalar values and empty arrays/objects when no entries are present. Represent amounts and counts as JSON numbers without separators, and identifiers such as PAN, GSTIN, IFSC, invoice numbers, and HSN codes as strings to preserve leading zeroes. Use YYYY-MM-DD dates only when the full date is unambiguous; otherwise preserve the visible date text. Put each line item in line_items with its visible description and values. Confidence must reflect uncertainty in reading the source, not tax correctness.`;
}

function parseBoundedJsonObject(rawText) {
  if (typeof rawText !== 'string' || rawText.length > MAX_PROVIDER_JSON_CHARS) {
    throw new Error('The provider response is too large or is not text.');
  }
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const candidates = [cleaned];
  const firstObject = cleaned.indexOf('{');
  const lastObject = cleaned.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject && cleaned.slice(firstObject, lastObject + 1) !== cleaned) {
    candidates.push(cleaned.slice(firstObject, lastObject + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next bounded candidate; no field values are repaired here.
    }
  }
  throw new Error('The provider response is not a valid JSON object.');
}

function matchesValue(value, schema) {
  if (value === null) return true;
  if (schema?.type === 'array') return Array.isArray(value) && value.every(item => matchesValue(item, schema.items));
  if (schema?.type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.additionalProperties) return true;
    const properties = schema.properties || {};
    return Object.entries(value).every(([key, child]) => Object.prototype.hasOwnProperty.call(properties, key)
      && matchesValue(child, properties[key]));
  }
  if (schema?.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return schema?.type === 'string' ? typeof value === 'string' : false;
}

function validateExtractionData(data, category) {
  const schema = getSchema(category);
  if (!schema) throw new Error(`The extraction category "${category}" is not supported yet.`);
  if (!matchesValue(data, schema)) throw new Error('The AI result does not match the required extraction fields and types.');
  return data;
}

module.exports = {
  EXTRACTION_SCHEMAS,
  SUPPORTED_EXTRACTION_CATEGORIES,
  getExtractionPrompt,
  parseBoundedJsonObject,
  validateExtractionData,
};
