const test = require('node:test');
const assert = require('node:assert/strict');
const { getExtractionPrompt, parseBoundedJsonObject, validateExtractionData } = require('../lib/extractionSchema');

const invoice = {
  invoice_number: 'INV-001',
  invoice_date: null,
  vendor_name: 'Example Supplier',
  vendor_gstin: null,
  buyer_gstin: null,
  taxable_value: 100,
  cgst_rate: 9,
  cgst_amount: 9,
  sgst_rate: 9,
  sgst_amount: 9,
  igst_rate: null,
  igst_amount: null,
  total_gst: 18,
  grand_total: 118,
  place_of_supply: null,
  hsn_codes: ['1234'],
  line_items: [{
    description: 'Service',
    hsn_code: '1234',
    quantity: 1,
    unit: 'unit',
    unit_price: 100,
    taxable_value: 100,
    gst_rate: 18,
    cgst_amount: 9,
    sgst_amount: 9,
    igst_amount: null,
    total_amount: 118,
  }],
};

test('GST extraction accepts the structured line-item contract', () => {
  assert.equal(validateExtractionData(invoice, 'GST'), invoice);
});

test('extraction accepts partial results while preserving strict known-field validation', () => {
  assert.deepEqual(validateExtractionData({ invoice_number: 'INV-001', grand_total: 118 }, 'GST'), {
    invoice_number: 'INV-001',
    grand_total: 118,
  });
  assert.throws(() => validateExtractionData({ invoice_number: 'INV-001', made_up_field: 'value' }, 'GST'));
});

test('GST extraction rejects malformed line items and extra nested fields', () => {
  assert.throws(() => validateExtractionData({
    ...invoice,
    line_items: [{ ...invoice.line_items[0], quantity: 'one' }],
  }, 'GST'));
  assert.throws(() => validateExtractionData({
    ...invoice,
    line_items: [{ ...invoice.line_items[0], unexpected: 'value' }],
  }, 'GST'));
});

test('GST prompt describes the nested line-item object instead of an empty array', () => {
  const prompt = getExtractionPrompt('GST');
  assert.match(prompt, /"description": null/);
  assert.match(prompt, /"unit_price": null/);
  assert.match(prompt, /line_items/);
});

test('unsupported categories fail explicitly instead of falling back to General', () => {
  assert.throws(() => getExtractionPrompt('TDS'), /not supported yet/i);
  assert.throws(() => validateExtractionData({}, 'Audit'), /not supported yet/i);
});

test('bounded provider parsing accepts fenced or briefly prefixed JSON without repairing values', () => {
  assert.deepEqual(parseBoundedJsonObject('Here is the result:\n```json\n{"invoice_number":"INV-1"}\n```'), {
    invoice_number: 'INV-1',
  });
  assert.throws(() => parseBoundedJsonObject('x'.repeat(200_001)));
  assert.throws(() => parseBoundedJsonObject('{"invoice_number":}'));
});
