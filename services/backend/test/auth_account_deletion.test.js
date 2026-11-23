const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://account-deletion-test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key_for_unit_tests';

const database = require('../db/supabase');
const authRouter = require('../routes/auth');

test('account deletion requires configured cloud storage, exact phrase, and a valid password challenge', async (t) => {
  const previousBucket = process.env.SUPABASE_STORAGE_BUCKET;
  const originalGetUser = database.supabase.auth.getUser;
  const originalFrom = database.supabase.from;
  database.supabase.auth.getUser = async () => ({
    data: { user: { id: '11752602-62fa-4252-ae1d-23c4fb3b7312', email: 'user@example.com' } },
    error: null
  });
  database.supabase.from = (table) => {
    if (table !== 'client_portal_access') return originalFrom.call(database.supabase, table);
    return {
      select() { return this; },
      eq() { return this; },
      limit() { return this; },
      async maybeSingle() { return { data: null, error: null }; }
    };
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.auth.getUser = originalGetUser;
    database.supabase.from = originalFrom;
    if (previousBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = previousBucket;
  });

  const url = `http://127.0.0.1:${server.address().port}/api/v1/auth/delete-account/confirm`;
  const request = (body) => fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer valid-test-session', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  delete process.env.SUPABASE_STORAGE_BUCKET;
  const missingBucket = await request({ confirmation: 'DELETE MY ACCOUNT', challenge: 'invalid' });
  assert.equal(missingBucket.status, 503);
  assert.match((await missingBucket.json()).message, /SUPABASE_STORAGE_BUCKET/);

  process.env.SUPABASE_STORAGE_BUCKET = 'taxflow-intake';
  const wrongPhrase = await request({ confirmation: 'delete my account', challenge: 'invalid' });
  assert.equal(wrongPhrase.status, 400);

  const invalidChallenge = await request({ confirmation: 'DELETE MY ACCOUNT', challenge: 'invalid' });
  assert.equal(invalidChallenge.status, 401);

  // Valid challenge deletion
  const crypto = require('node:crypto');
  const testUserId = '11752602-62fa-4252-ae1d-23c4fb3b7312';
  const payload = {
    sub: testUserId,
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: crypto.randomBytes(24).toString('base64url')
  };
  const secret = process.env.SUPABASE_SECRET_KEY;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const validChallenge = `${encodedPayload}.${signature}`;

  const deletedUserCalls = [];
  database.supabase.auth.admin = {
    async deleteUser(id) {
      deletedUserCalls.push(id);
      return { error: null };
    }
  };
  database.supabase.rpc = async (name) => {
    if (name === 'delete_ca_user_all_data') {
      return { data: { success: true, clientCount: 0, portalUserIds: [] }, error: null };
    }
    return { data: null, error: null };
  };
  database.supabase.storage = {
    from() {
      return {
        async list() { return { data: [], error: null }; },
        async remove(paths) { return { data: paths, error: null }; }
      };
    }
  };

  database.supabase.from = () => ({
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    not() { return this; },
    order() { return this; },
    delete() { return this; },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    async range() { return { data: [], error: null }; }
  });

  const validResponse = await request({ confirmation: 'DELETE MY ACCOUNT', challenge: validChallenge });
  assert.equal(validResponse.status, 200);
  const body = await validResponse.json();
  assert.equal(body.success, true);
  assert.match(body.message, /permanently deleted/i);
  assert.ok(deletedUserCalls.includes(testUserId));
});
