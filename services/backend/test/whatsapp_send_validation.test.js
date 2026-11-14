const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://whatsapp-validation-tests.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key_for_unit_tests';
process.env.WHATSAPP_ACCESS_TOKEN = 'your_test_token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';

const database = require('../db/supabase');
const whatsappRouter = require('../routes/whatsapp');

test('WhatsApp send rejects phone values with letters or non-string types before lookup', async () => {
  const previousGetUser = database.supabase.auth.getUser;
  const previousFrom = database.supabase.from;
  let databaseCalls = 0;
  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'practice-user', app_metadata: {} } },
    error: null
  });
  database.supabase.from = () => {
    databaseCalls += 1;
    throw new Error('Invalid phone must be rejected before database access.');
  };

  const app = express();
  app.use(express.json());
  app.use(whatsappRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });

  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const toPhone of ['+91call9820011223', ['+919820011223']]) {
      const response = await fetch(`${origin}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-access-token'
        },
        body: JSON.stringify({ toPhone, message: 'Hello', clientId: 'client-1' })
      });
      assert.equal(response.status, 400);
    }
    assert.equal(databaseCalls, 0);
  } finally {
    database.supabase.auth.getUser = previousGetUser;
    database.supabase.from = previousFrom;
    await new Promise((resolve) => server.close(resolve));
  }
});
