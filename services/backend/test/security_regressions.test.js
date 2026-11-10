const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { captureWhatsAppWebhookBody, verifyWhatsAppWebhookSignature } = require('../lib/whatsappWebhookSecurity');
const { validateTaskPatch } = require('../lib/deadlinePatch');

test('WhatsApp signature verification covers raw body and rejects malformed signatures', () => {
  const body = Buffer.from('{"entry":[]}', 'utf8');
  const secret = 'test-secret';
  const digest = crypto.createHmac('sha256', secret).update(body).digest('hex');

  assert.equal(verifyWhatsAppWebhookSignature(body, `sha256=${digest}`, secret), true);
  assert.equal(verifyWhatsAppWebhookSignature(Buffer.from('{"entry":[1]}'), `sha256=${digest}`, secret), false);
  assert.equal(verifyWhatsAppWebhookSignature(body, digest, secret), false);
  assert.equal(verifyWhatsAppWebhookSignature(body, `sha256=${digest}`, ''), false);
});

test('WhatsApp raw body is captured only for the webhook route', () => {
  const webhookRequest = { originalUrl: '/api/v1/whatsapp/webhook?source=test' };
  const otherRequest = { originalUrl: '/api/v1/clients' };
  const body = Buffer.from('payload');

  captureWhatsAppWebhookBody(webhookRequest, {}, body);
  captureWhatsAppWebhookBody(otherRequest, {}, body);

  assert.deepEqual(webhookRequest.rawBody, body);
  assert.equal(Object.hasOwn(otherRequest, 'rawBody'), false);
});

test('deadline patch accepts allowed values and rejects ownership or invalid fields', () => {
  assert.deepEqual(validateTaskPatch({
    status: 'In Progress',
    progress: 50,
    due_date: '2026-10-31',
    notes: 'Waiting for documents'
  }), {
    status: 'In Progress',
    progress: 50,
    due_date: '2026-10-31',
    notes: 'Waiting for documents'
  });

  for (const patch of [
    { client_id: 'another-client' },
    { status: 'Unknown' },
    { progress: 101 },
    { due_date: '2026-02-30' },
    { unexpected: 'value' },
    {}
  ]) {
    assert.throws(() => validateTaskPatch(patch));
  }
});

test('invoice export SQL keeps source invoices GST and export documents Extracted', () => {
  const sqlPath = path.join(__dirname, '..', 'db', 'invoice_review_workflow.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const reviewStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.begin_invoice_review(');
  const exportStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.register_invoice_export_version(');
  const exportBodyStart = sql.indexOf('AS $$', exportStart);
  const exportEnd = sql.indexOf('$$;', exportBodyStart);

  assert.notEqual(reviewStart, -1);
  assert.notEqual(exportStart, -1);
  assert.match(sql.slice(reviewStart, exportStart), /AND d\.category = 'GST'/);
  assert.match(sql.slice(exportStart, exportEnd), /AND d\.category = 'Extracted'/);
  assert.doesNotMatch(sql.slice(exportStart, exportEnd), /AND d\.category = 'GST'/);
});
