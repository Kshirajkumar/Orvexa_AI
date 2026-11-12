const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const telegramRouter = require('../routes/telegram');

test('Telegram webhook secret comparison rejects missing and incorrect values', () => {
  const { secretMatches } = telegramRouter._test;
  assert.equal(secretMatches('', 'configured-secret'), false);
  assert.equal(secretMatches('wrong-secret', 'configured-secret'), false);
  assert.equal(secretMatches('configured-secret', 'configured-secret'), true);
});

test('Telegram setup recognizes missing Postgres and Supabase REST schema objects', () => {
  const { isMissingDatabaseSchema, getMissingDatabaseTable, getMissingDatabaseColumn } = telegramRouter._test;
  assert.equal(isMissingDatabaseSchema({ code: '42P01', message: 'relation does not exist' }), true);
  assert.equal(isMissingDatabaseSchema({ code: 'PGRST205', message: 'table missing from schema cache' }), true);
  assert.equal(isMissingDatabaseSchema({ code: 'PGRST204', message: "Could not find the 'created_by' column of 'telegram_link_tokens' in the schema cache" }), true);
  assert.equal(isMissingDatabaseSchema({ code: '28P01', message: 'password authentication failed' }), false);
  assert.equal(isMissingDatabaseSchema(new Error('Temporary network failure')), false);
  assert.equal(getMissingDatabaseTable({ code: '42P01', message: 'relation "public.telegram_link_tokens" does not exist' }), 'telegram_link_tokens');
  assert.equal(getMissingDatabaseTable({ code: 'PGRST205', message: "Could not find the table 'public.client_portal_invites' in the schema cache" }), 'client_portal_invites');
  assert.deepEqual(
    getMissingDatabaseColumn({ code: 'PGRST204', message: "Could not find the 'created_by' column of 'telegram_link_tokens' in the schema cache" }),
    { column: 'created_by', table: 'telegram_link_tokens' }
  );
  assert.deepEqual(
    getMissingDatabaseColumn({ code: '42703', message: 'column telegram_link_tokens.created_by does not exist' }),
    { table: 'telegram_link_tokens', column: 'created_by' }
  );
});

test('Telegram setup derives only a valid HTTPS relay webhook URL', () => {
  const { expectedWebhookUrl } = telegramRouter._test;
  const previous = {
    autoConfigure: process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE,
    relayUrl: process.env.TELEGRAM_WEBHOOK_RELAY_URL,
    publicUrl: process.env.PUBLIC_URL
  };
  try {
    process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE = 'false';
    process.env.TELEGRAM_WEBHOOK_RELAY_URL = 'https://relay.example/telegram/webhook';
    assert.equal(expectedWebhookUrl(), 'https://relay.example/telegram/webhook');
    process.env.TELEGRAM_WEBHOOK_RELAY_URL = 'http://relay.example/telegram/webhook';
    assert.equal(expectedWebhookUrl(), null);
    process.env.TELEGRAM_WEBHOOK_RELAY_URL = '';
    process.env.PUBLIC_URL = 'https://taxflow.example/';
    assert.equal(expectedWebhookUrl(), 'https://taxflow.example/api/v1/telegram/webhook');
  } finally {
    if (previous.autoConfigure === undefined) delete process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE;
    else process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE = previous.autoConfigure;
    if (previous.relayUrl === undefined) delete process.env.TELEGRAM_WEBHOOK_RELAY_URL;
    else process.env.TELEGRAM_WEBHOOK_RELAY_URL = previous.relayUrl;
    if (previous.publicUrl === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = previous.publicUrl;
  }
});

test('Telegram webhook diagnostics do not present errors older than one day as recent', () => {
  const { getRecentWebhookError } = telegramRouter._test;
  const now = Date.now();
  assert.deepEqual(
    getRecentWebhookError({ last_error_message: '503 Service Unavailable', last_error_date: Math.floor((now - 5 * 60 * 1000) / 1000) }, now),
    { message: '503 Service Unavailable', occurredAt: new Date(Math.floor((now - 5 * 60 * 1000) / 1000) * 1000).toISOString() }
  );
  assert.equal(
    getRecentWebhookError({ last_error_message: '503 Service Unavailable', last_error_date: Math.floor((now - 25 * 60 * 60 * 1000) / 1000) }, now),
    null
  );
  assert.deepEqual(
    getRecentWebhookError({ last_error_message: '503 Service Unavailable' }, now),
    { message: '503 Service Unavailable', occurredAt: null }
  );
});

test('Telegram message projection never exposes legacy attachment fields', () => {
  const { publicTelegramMessage } = telegramRouter._test;
  const projected = publicTelegramMessage({
    id: 'message-1',
    body: 'legacy attachment',
    telegram_file_id: 'private-document',
    telegram_file_name: 'private.pdf',
  });
  assert.equal(projected.message_type, 'text');
  assert.match(projected.body, /text messages only/i);
  assert.equal(Object.hasOwn(projected, 'telegram_file_id'), false);
});

test('Telegram media updates are classified without downloading or forwarding files', () => {
  const { getTelegramMediaMessageType } = telegramRouter._test;
  for (const type of ['photo', 'document', 'video', 'animation', 'video_note', 'audio', 'voice', 'sticker', 'paid_media']) {
    assert.equal(getTelegramMediaMessageType({ [type]: {} }), type);
  }
  assert.equal(getTelegramMediaMessageType({ text: 'hello' }), null);
});

test('Telegram sends an invitation only before portal enrollment', () => {
  const { createTelegramPortalAccessMessage } = telegramRouter._test;
  const invitation = createTelegramPortalAccessMessage(false, 'https://portal.example/portal#invite=abc');
  assert.match(invitation, /invitation/i);
  assert.match(invitation, /#invite=abc/);

  const existingAccount = createTelegramPortalAccessMessage(true, 'https://portal.example/portal');
  assert.match(existingAccount, /already active/i);
  assert.doesNotMatch(existingAccount, /#invite=/i);
});

test('Telegram webhook rejects a request with the wrong secret', async () => {
  const previous = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = 'configured-secret';
  const app = express();
  app.use('/api/v1/telegram', telegramRouter);
  const server = await new Promise((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong-secret' }, body: '{}' });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = previous;
  }
});

test('Telegram webhook reports missing secret configuration instead of accepting updates', async () => {
  const previous = process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const app = express();
  app.use('/api/v1/telegram', telegramRouter);
  const server = await new Promise((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, message: 'Telegram webhook is not configured.' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = previous;
  }
});
