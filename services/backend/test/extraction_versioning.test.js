const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildExtractionEnvelope,
  calculateExtractionScore,
  canonicalizeFields,
  compareExtractionVersions,
  diffFields,
  normalizeLabel,
} = require('../lib/extractionVersioning');

test('normalizes labels deterministically', () => {
  assert.equal(normalizeLabel('PAN Number:'), 'pan no');
  assert.equal(normalizeLabel('  Gross   Salary '), 'gross salary');
});

test('maps supported aliases while retaining original labels', () => {
  const result = canonicalizeFields({ 'Gross Salary': 1250000, 'PAN Number': 'ABCDE1234F' }, 'Form16');
  assert.equal(result.fields['salary.gross_salary'].value, 1250000);
  assert.equal(result.fields['taxpayer.pan'].raw_label, 'PAN Number');
  assert.equal(result.extra_fields['PAN Number'], undefined);
});

test('maps common GST headings and keeps unknown labels outside canonical fields', () => {
  const result = canonicalizeFields({
    'Invoice No.': 'INV-10',
    'Supplier GSTIN': '22AAAAA0000A1Z5',
    'New Bank Label': 'keep this source value',
  }, 'GST');
  assert.equal(result.fields.invoice_number.value, 'INV-10');
  assert.equal(result.fields.vendor_gstin.value, '22AAAAA0000A1Z5');
  assert.equal(result.fields['New Bank Label'], undefined);
  assert.equal(result.extra_fields['New Bank Label'], 'keep this source value');
  assert.equal(result.normalization_events.at(-1).status, 'unmapped');
});

test('builds a scored immutable extraction envelope', () => {
  const envelope = buildExtractionEnvelope({
    data: { 'Gross Salary': 100, 'PAN Number': 'ABCDE1234F' },
    category: 'Form16',
    documentId: 'doc-1',
    assessmentYear: '2026-27',
    providerScore: 0.93,
  });
  assert.equal(envelope.document_id, 'doc-1');
  assert.equal(envelope.overall_score.provider_score, 0.93);
  assert.deepEqual(envelope.source_data, { 'Gross Salary': 100, 'PAN Number': 'ABCDE1234F' });
  assert.ok(envelope.overall_score.computed_score > 0);
  assert.equal(envelope.fields['salary.gross_salary'].status, 'found');
});

test('preserves provider page and quote evidence on canonical fields', () => {
  const envelope = buildExtractionEnvelope({
    data: { invoice_number: 'INV-1', invoice_date: '2026-11-22', vendor_name: 'Example' },
    category: 'GST',
    documentId: 'doc-1',
    fieldEvidence: { invoice_number: { page: 2, quote: 'Invoice No: INV-1' } },
  });
  assert.equal(envelope.fields.invoice_number.page, 2);
  assert.equal(envelope.fields.invoice_number.raw_text, 'Invoice No: INV-1');
});

test('preserves an explicit zero provider score', () => {
  const envelope = buildExtractionEnvelope({
    data: { invoice_number: 'INV-1' },
    category: 'GST',
    documentId: 'doc-1',
    providerScore: 0,
  });
  assert.equal(envelope.overall_score.provider_score, 0);
});

test('computes changed field paths', () => {
  assert.deepEqual(diffFields({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }), ['b', 'c']);
});

test('compares canonical values without treating confidence metadata as a value change', () => {
  const before = { fields: { total: { normalized_value: 100, status: 'found', confidence: 0.7 } } };
  const after = { fields: { total: { normalized_value: 100, status: 'found', confidence: 0.9 } } };
  assert.deepEqual(compareExtractionVersions(before, after).changedFieldPaths, []);
  assert.deepEqual(compareExtractionVersions(before, { fields: { total: { normalized_value: 120, status: 'found' } } }).changedFieldPaths, ['total']);
});

test('score remains bounded and penalizes warnings', () => {
  const score = calculateExtractionScore({ fields: { a: { status: 'found' } }, warnings: ['x', 'y'] });
  assert.ok(score.computed_score >= 0 && score.computed_score <= 1);
});
