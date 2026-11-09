const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const express = require('express');
const extractionRouter = require('../routes/extraction');

test('extraction save validates JSON and refuses local-only fallback when cloud storage is unavailable', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/extraction', (req, _res, next) => {
    req.user = { id: 'local-user' };
    next();
  }, extractionRouter);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/v1/extraction/save`;

  const invalid = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: 'document-1', extractedData: [] }),
  });
  assert.equal(invalid.status, 400);

  const invalidSchema = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: 'document-1', category: 'General', extractedData: { total: 1200 } }),
  });
  assert.equal(invalidSchema.status, 400);

  const extractedData = {
    document_type: 'Invoice',
    document_date: '2026-04-14',
    names: [],
    identifiers: {},
    amounts: {},
    line_items: [],
    other_fields: [],
    unreadable_fields: [],
  };
  const saved = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: 'document-1', category: 'General', extractedData }),
  });
  assert.equal(saved.status, 503);
  const result = await saved.json();
  assert.equal(result.success, false);
  assert.match(result.message, /cloud extraction storage is unavailable/i);
});
