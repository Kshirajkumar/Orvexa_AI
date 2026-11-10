const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://email-security-tests.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';

const database = require('../db/supabase');
const notificationsRouter = require('../routes/notifications');

test('transactional email endpoint rejects unsupported templates and unowned recipients', async () => {
  const previousFrom = database.supabase.from;
  const calls = [];
  database.supabase.from = (table) => {
    calls.push(table);
    const query = {
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); }
    };
    return query;
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'practice-user', email: 'staff@example.com' };
    next();
  });
  app.use('/notifications', notificationsRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });

  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const unsupported = await fetch(`${origin}/notifications/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'arbitrary', to: 'victim@example.com' })
    });
    assert.equal(unsupported.status, 400);
    assert.deepEqual(calls, []);

    const unownedRecipient = await fetch(`${origin}/notifications/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'document-upload', to: 'victim@example.com', documentId: 'document-1' })
    });
    assert.equal(unownedRecipient.status, 404);
    assert.deepEqual(calls, ['clients']);
  } finally {
    database.supabase.from = previousFrom;
    await new Promise((resolve) => server.close(resolve));
  }
});
