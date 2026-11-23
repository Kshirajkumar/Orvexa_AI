const contracts = require('../../../packages/extraction-contracts/contracts.json');

const EXTRACTION_SCHEMAS = contracts.categories;
const SUPPORTED_EXTRACTION_CATEGORIES = Object.freeze(Object.keys(EXTRACTION_SCHEMAS));
const MAX_PROVIDER_JSON_CHARS = 200_000;

function normalizeCategory(category) {
  if (!category || typeof category !== 'string') return 'General';
  const clean = category.trim();
  if (EXTRACTION_SCHEMAS[clean]) return clean;
  const upper = clean.toUpperCase().replace(/[-_\s]/g, '');
  if (upper === 'ITR1' || upper === 'ITR-1') return 'ITR1';
  if (upper === 'ITR2' || upper === 'ITR-2') return 'ITR2';
  if (upper === 'FORM16') return 'Form16';
  if (upper === 'GST' || upper === 'INVOICE') return 'GST';
  if (upper === 'BANKSTATEMENT' || upper === 'BANK') return 'BankStatement';
  if (upper === 'NOTICE') return 'Notice';
  if (upper === 'INCOMETAX') return 'IncomeTax';
  return clean;
}

function getSchema(category) {
  const norm = normalizeCategory(category);
  return EXTRACTION_SCHEMAS[norm] || EXTRACTION_SCHEMAS[category] || null;
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
  const norm = normalizeCategory(category);
  const schema = getSchema(norm);
  if (!schema) throw new Error(`The extraction category "${category}" is not supported yet.`);
  const accuracyInstruction = 'Return {"data": <the object shape above>, "accuracy_score": <number from 0 to 1>, "field_confidence": {"canonical_field_name": <number from 0 to 1>}, "field_evidence": {"canonical_field_name": {"page": <positive integer>, "quote": <short visible source text>}}}.';
  return `Extract the visible information from this document. ${accuracyInstruction}\n${JSON.stringify(promptShape(schema), null, 2)}\n\nRules: preserve names, identifiers, dates, and amounts as shown; do not calculate, infer, normalize, or invent missing values. Use null for unreadable or absent scalar values and empty arrays/objects when no entries are present. Represent amounts and counts as JSON numbers without separators, and identifiers such as PAN, GSTIN, IFSC, invoice numbers, and HSN codes as strings to preserve leading zeroes. Use YYYY-MM-DD dates only when the full date is unambiguous; otherwise preserve the visible date text. Put each line item in line_items with its visible description and values. Confidence must reflect uncertainty in reading the source, not tax correctness.`;
}

function getCategoryUserPrompt(category, { assessmentYear = '2026-27', clientName = '' } = {}) {
  const norm = normalizeCategory(category);
  if (norm === 'ITR1' || norm === 'ITR2' || norm === 'IncomeTax') {
    return `Document type: ${norm === 'ITR2' ? 'ITR-2' : 'ITR-1'} (filed return or ITR-V acknowledgement)\n` +
      `Assessment year expected: ${assessmentYear}\n` +
      `Client name on file: ${clientName || 'Not specified'} (for matching only; do not copy it into fields unless it is printed)\n\n` +
      `Read the attached document and return the fields below. Field names are fixed.\n\n` +
      `IDENTITY: pan, name, date_of_birth, aadhaar_last4, residential_status, filing_status, assessment_year, form_name, acknowledgement_number, filing_date, filing_section, original_or_revised\n` +
      `INCOME (as printed): salary_gross, house_property_income, other_sources_income, gross_total_income, total_deductions_chapter_vi_a, total_income\n` +
      `ITR-2 ONLY: short_term_capital_gains, long_term_capital_gains, number_of_house_properties, foreign_assets_present (yes or no), agricultural_income_over_5000 (yes or no)\n` +
      `DEDUCTIONS (as printed): ded_80c, ded_80ccd_1b, ded_80d, ded_80g, ded_80tta_ttb, ded_other\n` +
      `TAX (as printed): tax_payable, tds_total, tcs_total, advance_tax, self_assessment_tax, total_taxes_paid, refund_amount, tax_due_amount\n` +
      `BANK: refund_bank_name, refund_bank_ifsc, refund_bank_account_last4\n` +
      `LINE ITEMS: employers (name, tan, gross_salary, tds), tds_entries (deductor_name, deductor_tan, amount_paid, tds_deducted), bank_accounts (bank_name, ifsc, account_last4)\n\n` +
      `For an ITR-1 return mark the ITR-2 ONLY fields as status "missing".\n\n` +
      getExtractionPrompt(norm);
  }
  if (norm === 'Form16') {
    return `Document type: Form 16 Assessment year expected: ${assessmentYear}\n` +
      `Return: employer_name, employer_tan, employer_pan, employee_name, employee_pan, financial_year, assessment_year, certificate_number, gross_salary, allowances_exempt_u_s_10, standard_deduction, professional_tax, income_from_salary, ded_80c, ded_80ccd_1b, ded_80d, other_chapter_vi_a_total, total_taxable_income, tax_on_total_income, rebate_87a, health_and_education_cess, total_tax_payable, tds_deducted_total, quarterly_tds (quarter, receipt_number, amount_paid, tds_deducted, deposited).\n` +
      `If Part A and Part B are both present, read both. If only one is present, mark the other part's fields missing and add a warning.\n\n` +
      getExtractionPrompt(norm);
  }
  return getExtractionPrompt(norm);
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
      // Try next bounded candidate
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

function sanitizeExtractionCandidate(candidate, category) {
  const schema = getSchema(category);
  if (!schema || !candidate || typeof candidate !== 'object') {
    return { validData: candidate, extraFields: {} };
  }
  if (schema.additionalProperties) {
    return { validData: candidate, extraFields: {} };
  }
  const validData = {};
  const extraFields = {};
  const properties = schema.properties || {};

  for (const [key, value] of Object.entries(candidate)) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      if (matchesValue(value, properties[key])) {
        validData[key] = value;
      } else {
        // Value type mismatch: preserve in extraFields or null out if unreadable
        validData[key] = null;
        extraFields[key] = value;
      }
    } else {
      extraFields[key] = value;
    }
  }
  return { validData, extraFields };
}

function validateExtractionData(data, category) {
  const norm = normalizeCategory(category);
  const schema = getSchema(norm);
  if (!schema) throw new Error(`The extraction category "${category}" is not supported yet.`);
  if (!matchesValue(data, schema)) throw new Error('The AI result does not match the required extraction fields and types.');
  return data;
}

module.exports = {
  EXTRACTION_SCHEMAS,
  SUPPORTED_EXTRACTION_CATEGORIES,
  getExtractionPrompt,
  getCategoryUserPrompt,
  normalizeCategory,
  parseBoundedJsonObject,
  sanitizeExtractionCandidate,
  validateExtractionData,
};
