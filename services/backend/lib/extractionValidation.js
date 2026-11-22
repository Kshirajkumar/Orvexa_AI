const IDENTIFIER_RULES = [
  { pattern: /(?:^|[._])pan$|pan(?:_number)?$/i, code: 'invalid_pan', test: /^[A-Z]{5}[0-9]{4}[A-Z]$/i, message: 'PAN does not match the expected format.' },
  { pattern: /gstin/i, code: 'invalid_gstin', test: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i, message: 'GSTIN does not match the expected format.' },
  { pattern: /(?:^|[._])tan$|tan$/i, code: 'invalid_tan', test: /^[A-Z]{4}[0-9]{5}[A-Z]$/i, message: 'TAN does not match the expected format.' },
  { pattern: /ifsc/i, code: 'invalid_ifsc', test: /^[A-Z]{4}0[A-Z0-9]{6}$/i, message: 'IFSC does not match the expected format.' },
  { pattern: /hsn/i, code: 'invalid_hsn', test: /^[0-9]{4,8}$/, message: 'HSN code should contain 4 to 8 digits.' },
];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === value;
}

function validateExtractedDataQuality(data, category) {
  const warnings = [];

  function add(path, code, message) {
    warnings.push({ path, code, message, status: 'review' });
  }

  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;

    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (typeof child === 'string' && child.trim()) {
        const rule = IDENTIFIER_RULES.find(candidate => candidate.pattern.test(key));
        if (rule && !rule.test.test(child.trim())) add(childPath, rule.code, rule.message);
        if (/(?:date|period_from|period_to|due_date)$/i.test(key) && !isValidIsoDate(child.trim())) {
          add(childPath, 'invalid_date', 'Date uses YYYY-MM-DD but is not a real calendar date.');
        }
      }
      if (typeof child === 'number' && !isFiniteNumber(child)) {
        add(childPath, 'non_finite_number', 'Financial or count value is not finite.');
      }
      walk(child, childPath);
    }
  }

  walk(data, '');

  if (category === 'GST' && data && typeof data === 'object') {
    const taxable = data.taxable_value;
    const tax = data.total_gst;
    const total = data.grand_total;
    if ([taxable, tax, total].every(isFiniteNumber) && total + 1 < taxable + tax) {
      add('grand_total', 'gst_total_mismatch', 'Grand total is lower than taxable value plus total GST.');
    }
  }

  return warnings;
}

module.exports = { validateExtractedDataQuality };
