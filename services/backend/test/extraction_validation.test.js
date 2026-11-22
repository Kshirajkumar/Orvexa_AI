const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExtractedDataQuality } = require('../lib/extractionValidation');

test('extraction quality validation flags malformed identifiers without rejecting data', () => {
  const warnings = validateExtractedDataQuality({ pan: 'BADPAN', gstin: 'BADGSTIN', ifsc: 'NOPE' }, 'IncomeTax');
  assert.deepEqual(warnings.map(warning => warning.code), ['invalid_pan', 'invalid_gstin', 'invalid_ifsc']);
});

test('extraction quality validation checks GST arithmetic as a review warning', () => {
  const warnings = validateExtractedDataQuality({ taxable_value: 1000, total_gst: 180, grand_total: 1000 }, 'GST');
  assert.equal(warnings.some(warning => warning.code === 'gst_total_mismatch'), true);
});

test('extraction quality validation accepts valid identifiers and dates', () => {
  const warnings = validateExtractedDataQuality({
    pan: 'ABCDE1234F',
    gstin: '27ABCDE1234F1Z5',
    ifsc: 'HDFC0001234',
    invoice_date: '2026-11-22',
  }, 'GST');
  assert.deepEqual(warnings, []);
});
