const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLegacyCloudReference } = require('../db/migrate_local_vault_documents');

test('legacy cloud references are split into bucket and object key', () => {
  assert.deepEqual(
    parseLegacyCloudReference('supabase://taxflow-intake/user/client/document_file.pdf'),
    { bucket: 'taxflow-intake', objectKey: 'user/client/document_file.pdf' }
  );
  assert.equal(parseLegacyCloudReference('C:\\TaxFlowVault\\clients\\file.pdf'), null);
});

test('malformed legacy cloud references are rejected', () => {
  assert.throws(() => parseLegacyCloudReference('supabase://'));
  assert.throws(() => parseLegacyCloudReference('supabase://taxflow-intake/'));
});
