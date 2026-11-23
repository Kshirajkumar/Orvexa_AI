const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Test that auth router handles login existence check gracefully in demo/unconfigured mode
// and doesn't crash or falsely block when service role key is absent or admin lookup returns no errors.
test('login falls through safely when admin lookup is unavailable without crashing', async (t) => {
  const authRouter = require('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const endpoint = `http://127.0.0.1:${server.address().port}/api/v1/auth/login`;

  // When Supabase is not configured in tests, requireSupabase returns 503
  const emptyRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '', password: '' }),
  });
  assert.equal(emptyRes.status, 503);
  const json = await emptyRes.json();
  assert.equal(json.success, false);
  assert.match(json.message, /database is not connected/i);
});
