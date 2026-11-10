const test = require('node:test');
const assert = require('node:assert/strict');

const { collectStorageObjects } = require('../lib/storageCleanupWorker');

test('client cleanup recursively enumerates objects without mistaking files for folders', async () => {
  const listings = new Map([
    ['user/client', [
      { name: 'invoice.pdf', id: 'object-1' },
      { name: 'documents', id: null },
      { name: '..', id: null },
    ]],
    ['user/client/documents', [{ name: 'document-id', id: null }]],
    ['user/client/documents/document-id', [{ name: 'version.pdf', id: 'object-2' }]],
  ]);
  const calls = [];
  const storage = {
    from(bucket) {
      return {
        async list(folder, options) {
          calls.push({ bucket, folder, options });
          return { data: listings.get(folder) || [], error: null };
        },
      };
    },
  };
  const objects = new Set();
  const visited = new Set();

  await collectStorageObjects(storage, 'taxflow-intake', 'user/client', objects, visited);

  assert.deepEqual([...objects].sort(), [
    'user/client/documents/document-id/version.pdf',
    'user/client/invoice.pdf',
  ]);
  assert.deepEqual([...visited].sort(), [
    'user/client',
    'user/client/documents',
    'user/client/documents/document-id',
  ]);
  assert.ok(calls.every(call => call.bucket === 'taxflow-intake' && call.options.limit === 100));
});
