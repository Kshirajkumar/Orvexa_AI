const STRING = '';
const NUMBER = 0;

const EXTRACTION_SCHEMAS = {
  GST: {
    invoice_number: STRING, invoice_date: STRING, vendor_name: STRING, vendor_gstin: STRING, buyer_gstin: STRING,
    taxable_value: NUMBER, cgst_rate: NUMBER, cgst_amount: NUMBER, sgst_rate: NUMBER, sgst_amount: NUMBER,
    igst_rate: NUMBER, igst_amount: NUMBER, total_gst: NUMBER, grand_total: NUMBER, place_of_supply: STRING,
    hsn_codes: [], line_items: [],
  },
  IncomeTax: {
    document_type: STRING, assessment_year: STRING, pan: STRING, taxpayer_name: STRING,
    gross_total_income: NUMBER, deductions_80c: NUMBER, deductions_80d: NUMBER, other_deductions: NUMBER,
    taxable_income: NUMBER, tax_payable: NUMBER, tds_deducted: NUMBER, advance_tax: NUMBER, refund_due: NUMBER,
  },
  Form16: {
    employer_name: STRING, employer_tan: STRING, employee_name: STRING, employee_pan: STRING,
    assessment_year: STRING, gross_salary: NUMBER, hra_exemption: NUMBER, lta_exemption: NUMBER,
    standard_deduction: NUMBER, professional_tax: NUMBER, section_80c: NUMBER, section_80d: NUMBER,
    net_taxable_income: NUMBER, tax_deducted: NUMBER, surcharge: NUMBER, cess: NUMBER, total_tds: NUMBER,
  },
  BankStatement: {
    bank_name: STRING, account_holder: STRING, account_number: STRING, ifsc: STRING,
    period_from: STRING, period_to: STRING, opening_balance: NUMBER, closing_balance: NUMBER,
    total_credits: NUMBER, total_debits: NUMBER, transaction_count: NUMBER,
  },
  Notice: {
    notice_type: STRING, section: STRING, notice_date: STRING, due_date: STRING, authority: STRING,
    taxpayer_name: STRING, pan: STRING, assessment_year: STRING, demand_amount: NUMBER,
    reason: STRING, action_required: STRING,
  },
  General: {
    document_type: STRING, document_date: STRING, names: [], identifiers: {}, amounts: {},
    line_items: [], other_fields: [], unreadable_fields: [],
  },
};

function getExtractionPrompt(category) {
  const schema = EXTRACTION_SCHEMAS[category] || EXTRACTION_SCHEMAS.General;
  return `Extract the visible information from this document and return exactly one JSON object with exactly these keys and value types:\n${JSON.stringify(schema, null, 2)}\n\nRules: preserve names, identifiers, dates, and amounts as shown; do not calculate, infer, normalize, or invent missing values. Use null for unreadable or absent scalar values and empty arrays/objects when no entries are present. Represent amounts and counts as JSON numbers without separators, and identifiers such as PAN, GSTIN, IFSC, invoice numbers, and HSN codes as strings to preserve leading zeroes. Use YYYY-MM-DD dates only when the full date is unambiguous; otherwise preserve the visible date text. Put each line item in line_items with its visible description and values. Return no markdown, commentary, confidence score, or extra keys.`;
}

function matchesSchema(value, schema) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(schema).length
    && Object.keys(schema).every(key => {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
      const actual = value[key];
      const expected = schema[key];
      if (actual === null) return typeof expected === 'string' || typeof expected === 'number';
      if (Array.isArray(expected)) return Array.isArray(actual);
      if (typeof expected === 'object') return actual !== null && typeof actual === 'object' && !Array.isArray(actual);
      return typeof actual === typeof expected && (typeof actual !== 'number' || Number.isFinite(actual));
    });
}

function validateExtractionData(data, category) {
  const schema = EXTRACTION_SCHEMAS[category] || EXTRACTION_SCHEMAS.General;
  if (!matchesSchema(data, schema)) {
    throw new Error('The AI result does not match the required extraction fields and types.');
  }
  return data;
}

module.exports = { getExtractionPrompt, validateExtractionData };
