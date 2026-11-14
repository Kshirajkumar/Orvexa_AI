const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://storage-cleanup-tests.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key_for_unit_tests';

const database = require('../db/supabase');
const storageCleanupRouter = require('../routes/storageCleanup');

const ownerId = '11752602-62fa-4252-ae1d-23c4fb3b7312';
const otherUserId = '20314145-9020-45f0-85a0-68bc63eb359e';
const jobId = '49815d77-b97f-4abf-ae4b-65cd91af0160';

function createSupabaseMock() {
  const jobs = [
    { id: jobId, target_type: 'client', status: 'failed', attempt_count: 10, user_id: ownerId, created_at: '2026-11-10T00:00:00Z', completed_at: null },
    { id: '90f39131-c7ec-45e8-a3a1-c6b1493c64f3', target_type: 'document', status: 'pending', attempt_count: 0, user_id: otherUserId, created_at: '2026-11-10T00:00:00Z', completed_at: null },
  ];
  const rpcCalls = [];
  return {
    jobs,
    rpcCalls,
    from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(field, value) { filters.push(row => row[field] === value); return this; },
        neq(field, value) { filters.push(row => row[field] !== value); return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() { return this.execute(true); },
        then(resolve, reject) { return this.execute(false).then(resolve, reject); },
        async execute(single) {
          const matching = (table === 'storage_cleanup_jobs' ? jobs : []).filter(row => filters.every(filter => filter(row)));
          return { data: single ? matching[0] || null : matching, error: null };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: name === 'retry_storage_cleanup_job' && args.p_job_id === jobId && args.p_user_id === ownerId, error: null };
    },
  };
}

async function withRouter(callback) {
  const mock = createSupabaseMock();
  const previousFrom = database.supabase.from;
  const previousRpc = database.supabase.rpc;
  database.supabase.from = mock.from;
  database.supabase.rpc = mock.rpc;
  const app = express();
  app.use((req, _res, next) => { req.user = { id: ownerId }; next(); });
  app.use('/storage-cleanup', storageCleanupRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    await callback(`http://127.0.0.1:${server.address().port}`, mock);
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.supabase.from = previousFrom;
    database.supabase.rpc = previousRpc;
  }
}

test('cleanup job listing only returns the authenticated user’s pending work', async () => {
  await withRouter(async origin => {
    const response = await fetch(`${origin}/storage-cleanup`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, jobId);
    assert.match(body.data[0].message, /manual retry/i);
  });
});

test('manual cleanup retry is owner-scoped and returns an accepted status', async () => {
  await withRouter(async (origin, mock) => {
    const response = await fetch(`${origin}/storage-cleanup/${jobId}/retry`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.deepEqual(body.data, { id: jobId, status: 'pending' });
    assert.deepEqual(mock.rpcCalls, [{
      name: 'retry_storage_cleanup_job',
      args: { p_job_id: jobId, p_user_id: ownerId },
    }]);

    const inaccessible = await fetch(`${origin}/storage-cleanup/90f39131-c7ec-45e8-a3a1-c6b1493c64f3`);
    assert.equal(inaccessible.status, 404);
  });
});
