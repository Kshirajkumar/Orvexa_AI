const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildExtractionEnvelope,
  calculateExtractionScore,
  canonicalizeFields,
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
  assert.ok(envelope.overall_score.computed_score > 0);
  assert.equal(envelope.fields['salary.gross_salary'].status, 'found');
});

test('computes changed field paths', () => {
  assert.deepEqual(diffFields({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }), ['b', 'c']);
});

test('score remains bounded and penalizes warnings', () => {
  const score = calculateExtractionScore({ fields: { a: { status: 'found' } }, warnings: ['x', 'y'] });
  assert.ok(score.computed_score >= 0 && score.computed_score <= 1);
});
