const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function replaceModule(modulePath, exports) {
  const resolvedPath = require.resolve(modulePath);
  const previous = require.cache[resolvedPath];
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports
  };
  return () => {
    if (previous) require.cache[resolvedPath] = previous;
    else delete require.cache[resolvedPath];
  };
}

test('concurrent invoice export registration removes the losing upload without overwriting the winner', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const clientId = '22222222-2222-4222-8222-222222222222';
  const exportDocumentId = '33333333-3333-4333-8333-333333333333';
  const reservationId = '44444444-4444-4444-8444-444444444444';
  let contentHash;
  const uploadedPaths = [];
  const deletedPaths = [];
  const releasedReservations = [];
  let documentLookups = 0;
  const supabase = {
    async rpc(name) {
      if (name === 'begin_document_upload') return { data: reservationId, error: null };
      if (name === 'create_document_metadata_if_client_active') {
        return { data: null, error: { message: 'A concurrent export registered first.' } };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      assert.equal(table, 'documents_metadata');
      const query = {
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          documentLookups += 1;
          return Promise.resolve({
            data: documentLookups === 1 ? null : {
              id: exportDocumentId,
              client_id: clientId,
              category: 'Extracted',
              file_sha256: contentHash,
              storage_bucket: 'bucket',
              storage_object_path: 'winner-object'
            },
            error: null
          });
        }
      };
      return query;
    }
  };

  const restoreStorage = replaceModule('../lib/documentStorage', {
    getStorageBucket: () => 'bucket',
    getStorageObjectKey: ({ documentId, fileName }) => `${documentId}/${fileName}`,
    getVersionStorageObjectKey: () => 'unused',
    isOwnedDocumentObject: () => true,
    releaseUploadReservation: async (_userId, id) => { releasedReservations.push(id); },
    sha256: value => {
      contentHash = crypto.createHash('sha256').update(value).digest('hex');
      return contentHash;
    },
    deleteDocument: async (_bucket, objectPath) => { deletedPaths.push(objectPath); },
    uploadDocument: async objectPath => { uploadedPaths.push(objectPath); }
  });
  const restoreDatabase = replaceModule('../db/supabase', { supabase });

  try {
    const { saveInvoiceExport } = require('../lib/invoiceExport');
    const savedHash = await saveInvoiceExport({
      request: {
        clientId,
        documentId: '55555555-5555-4555-8555-555555555555',
        exportDocumentId,
        invoiceRecordId: '66666666-6666-4666-8666-666666666666',
        createdAt: '2026-10-10T00:00:00.000Z',
        reviewedBy: 'Reviewer',
        reviewedData: {}
      },
      userId,
      client: { name: 'Client' },
      sourceDocument: { assessment_year: '2026-27' },
      invoiceVersion: 1
    });

    assert.equal(savedHash, contentHash);
    assert.equal(uploadedPaths.length, 1);
    assert.match(uploadedPaths[0], new RegExp(reservationId));
    assert.deepEqual(deletedPaths, uploadedPaths);
    assert.deepEqual(releasedReservations, [reservationId]);
  } finally {
    delete require.cache[require.resolve('../lib/invoiceExport')];
    restoreDatabase();
    restoreStorage();
  }
});
