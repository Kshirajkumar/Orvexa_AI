const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, formatValue } = require('../lib/logger');

test('logger redacts secrets recursively', () => {
  const result = sanitize({ token: 'secret-value', nested: { apiKey: 'another-secret', status: 200 } });
  assert.deepEqual(result, { token: '[redacted]', nested: { apiKey: '[redacted]', status: 200 } });
});

test('logger formats human-readable values without exposing JSON noise', () => {
  assert.equal(formatValue('GET'), 'GET');
  assert.equal(formatValue('hello world'), '"hello world"');
  assert.equal(formatValue(500), '500');
});
