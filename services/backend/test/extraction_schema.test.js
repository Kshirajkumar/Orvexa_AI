const test = require('node:test');
const assert = require('node:assert/strict');
const { getExtractionPrompt, validateExtractionData } = require('../lib/extractionSchema');

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
