const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://client-deletion-tests.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';
process.env.SUPABASE_STORAGE_BUCKET = 'taxflow-intake';

const database = require('../db/supabase');
const { getStorageObjectKey } = require('../lib/documentStorage');
const clientsRouter = require('../routes/clients');

const userId = '11752602-62fa-4252-ae1d-23c4fb3b7312';
const clientId = '20314145-9020-45f0-85a0-68bc63eb359e';
const documentId = '49815d77-b97f-4abf-ae4b-65cd91af0160';

function createSupabaseMock({ databaseDeleteError = null, storageDeleteError = null } = {}) {
  const tables = {
    clients: [{ id: clientId, user_id: userId, name: 'Example Client' }],
    documents_metadata: [{
      id: documentId,
      client_id: clientId,
      source: 'Upload',
      created_at: '2026-11-10T00:00:00.000Z',
      file_name: 'invoice.pdf',
      category: 'GST',
      storage_bucket: 'taxflow-intake',
      storage_object_path: getStorageObjectKey({
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
  const removed = [];

  return {
    tables,
    removed,
    from(table) {
      let operation = 'select';
      const filters = [];
      const query = {
        select() { return this; },
        delete() { operation = 'delete'; return this; },
        eq(field, value) { filters.push(row => row[field] === value); return this; },
        neq(field, value) { filters.push(row => row[field] !== value); return this; },
        maybeSingle() { return this.execute(true); },
        then(resolve, reject) { return this.execute(false).then(resolve, reject); },
        async execute(single) {
          const rows = tables[table] || [];
          const selected = rows.filter(row => filters.every(filter => filter(row)));
          if (operation === 'delete' && databaseDeleteError) return { data: null, error: databaseDeleteError };
          if (operation === 'delete') {
            for (const row of selected) rows.splice(rows.indexOf(row), 1);
          }
          return { data: single ? selected[0] || null : selected, error: null };
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            removed.push({ bucket, paths });
            return { data: null, error: storageDeleteError };
          },
        };
      },
    },
  };
}

async function withDeleteRequest(mock, callback) {
  const previousFrom = database.supabase.from;
  const previousStorage = database.supabase.storage;
  database.supabase.from = mock.from;
  database.supabase.storage = mock.storage;
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
    database.supabase.storage = previousStorage;
  }
}

test('client delete preserves cloud files when the database deletion fails', async () => {
  const mock = createSupabaseMock({ databaseDeleteError: new Error('Database unavailable') });

  await withDeleteRequest(mock, async response => {
    assert.equal(response.status, 500);
    assert.equal(mock.tables.clients.length, 1);
    assert.deepEqual(mock.removed, []);
  });
});

test('client delete reports a cleanup warning if Storage deletion fails after the database deletion', async () => {
  const mock = createSupabaseMock({ storageDeleteError: new Error('Storage unavailable') });

  await withDeleteRequest(mock, async response => {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(mock.tables.clients.length, 0);
    assert.equal(body.data.cleanupWarning, 'Client was deleted, but some private cloud documents could not be removed. Contact support to complete file cleanup.');
    assert.deepEqual(mock.removed, [{
      bucket: 'taxflow-intake',
      paths: [getStorageObjectKey({
        userId,
        clientId,
        year: '2026',
        month: 'November',
        category: 'GST',
        documentId,
        fileName: 'invoice.pdf',
      })],
    }]);
  });
});
