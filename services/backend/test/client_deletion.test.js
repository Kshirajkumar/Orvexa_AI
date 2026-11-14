const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://client-deletion-tests.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key_for_unit_tests';
process.env.SUPABASE_STORAGE_BUCKET = 'taxflow-intake';

const database = require('../db/supabase');
const { getStorageObjectKey } = require('../lib/documentStorage');
const clientsRouter = require('../routes/clients');

const userId = '11752602-62fa-4252-ae1d-23c4fb3b7312';
const clientId = '20314145-9020-45f0-85a0-68bc63eb359e';
const documentId = '49815d77-b97f-4abf-ae4b-65cd91af0160';
const jobId = '90f39131-c7ec-45e8-a3a1-c6b1493c64f3';

function createSupabaseMock({ requestError = null, invalidObject = false } = {}) {
  const tables = {
    clients: [{ id: clientId, user_id: userId, name: 'Example Client', deletion_requested_at: null }],
    documents_metadata: [{
      id: documentId,
      client_id: clientId,
      source: 'Upload',
      created_at: '2026-11-10T00:00:00.000Z',
      file_name: 'invoice.pdf',
      category: 'GST',
      storage_bucket: 'taxflow-intake',
      storage_object_path: invalidObject
        ? `${userId}/${clientId}/other/invoice.pdf`
        : getStorageObjectKey({
          userId,
          clientId,
          year: '2026',
          month: 'November',
          category: 'GST',
          documentId,
          fileName: 'invoice.pdf',
        }),
    }],
  };
  const calls = [];

  return {
    tables,
    calls,
    from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(field, value) { filters.push(row => row[field] === value); return this; },
        neq(field, value) { filters.push(row => row[field] !== value); return this; },
        is(field, value) { filters.push(row => row[field] === value); return this; },
        maybeSingle() { return this.execute(true); },
        single() { return this.execute(true); },
        then(resolve, reject) { return this.execute(false).then(resolve, reject); },
        async execute(single) {
          const selected = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
          return { data: single ? selected[0] || null : selected, error: null };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (requestError) return { data: null, error: requestError };
      if (name === 'request_client_deletion') {
        const client = tables.clients.find(row => row.id === args.p_client_id);
        client.deletion_requested_at = '2026-11-11T00:00:00.000Z';
        return { data: jobId, error: null };
      }
      return { data: null, error: new Error(`Unexpected RPC ${name}`) };
    },
  };
}

async function withDeleteRequest(mock, callback) {
  const previousFrom = database.supabase.from;
  const previousRpc = database.supabase.rpc;
  database.supabase.from = mock.from;
  database.supabase.rpc = mock.rpc;
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use(clientsRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${clientId}`, { method: 'DELETE' });
    await callback(response);
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.supabase.from = previousFrom;
    database.supabase.rpc = previousRpc;
  }
}

test('client deletion queues durable cleanup without deleting metadata or Storage immediately', async () => {
  const mock = createSupabaseMock();

  await withDeleteRequest(mock, async response => {
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.data.deletionJobId, jobId);
    assert.equal(body.data.deletionStatus, 'pending');
    assert.ok(mock.tables.clients[0].deletion_requested_at);
    assert.equal(mock.tables.documents_metadata.length, 1);
    assert.deepEqual(mock.calls, [{
      name: 'request_client_deletion',
      args: { p_user_id: userId, p_client_id: clientId, p_storage_bucket: 'taxflow-intake' },
    }]);
  });
});

test('client deletion refuses invalid Storage references before queuing cleanup', async () => {
  const mock = createSupabaseMock({ invalidObject: true });

  await withDeleteRequest(mock, async response => {
    assert.equal(response.status, 500);
    assert.equal(mock.tables.clients[0].deletion_requested_at, null);
    assert.equal(mock.calls.length, 0);
    assert.equal(mock.tables.documents_metadata.length, 1);
  });
});

test('client deletion reports a failed queue request without removing client data', async () => {
  const mock = createSupabaseMock({ requestError: new Error('Database unavailable') });

  await withDeleteRequest(mock, async response => {
    assert.equal(response.status, 500);
    assert.equal(mock.tables.clients[0].deletion_requested_at, null);
    assert.equal(mock.tables.documents_metadata.length, 1);
  });
});
