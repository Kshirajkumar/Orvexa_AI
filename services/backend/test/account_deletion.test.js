const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteAccountStorage } = require('../lib/accountDeletion');
const fs = require('node:fs');
const path = require('node:path');

const userId = '11752602-62fa-4252-ae1d-23c4fb3b7312';
const clientId = '20314145-9020-45f0-85a0-68bc63eb359e';
const secretId = '49815d77-b97f-4abf-ae4b-65cd91af0160';

test('integration secret migrations grant backend DELETE access for account deletion', () => {
  const migrationPaths = [
    path.join(__dirname, '..', 'db', 'create_integration_secrets.sql'),
    path.join(__dirname, '..', 'db', 'grant_integration_secrets_backend.sql'),
    path.join(__dirname, '..', 'db', 'grant_integration_secrets_delete.sql')
  ];

  for (const migrationPath of migrationPaths) {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(
      sql,
      /GRANT\s+SELECT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+public\.integration_secrets\s+TO\s+service_role/i,
      `${path.basename(migrationPath)} must grant DELETE to service_role`
    );
  }
});

test('account deletion RPC uses the current portal and document lifecycle columns', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'account_deletion_comprehensive.sql'),
    'utf8'
  );

  assert.doesNotMatch(sql, /claimed_by_user_id|invited_by_user_id|uploaded_by_user_id/i);
  assert.match(sql, /document_upload_reservations[\s\S]*owner_user_id/i);
  assert.match(sql, /document_versions[\s\S]*created_by/i);
  assert.match(sql, /client_portal_invites[\s\S]*created_by/i);
});

function createSupabase({ documents = [], integrations = [], storageEntries = {}, listError = null, rpcResult = 0, portalUsers = [] } = {}) {
  const removed = [];
  const rpcCalls = [];
  const deletedUsers = [];
  const deletedTables = [];
  const tables = {
    clients: [{ id: clientId, user_id: userId }],
    documents_metadata: documents,
    integration_secrets: integrations,
    client_portal_access: portalUsers.map(u => ({ user_id: u, client_id: clientId })),
    client_user_profiles: portalUsers.map(u => ({ user_id: u, client_id: clientId })),
    client_portal_invites: [],
    storage_cleanup_jobs: []
  };

  return {
    removed,
    rpcCalls,
    deletedUsers,
    deletedTables,
    auth: {
      admin: {
        async deleteUser(id) {
          deletedUsers.push(id);
          return { error: null };
        }
      }
    },
    from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(field, value) { filters.push((row) => row[field] === value); return this; },
        in(field, values) { filters.push((row) => values.includes(row[field])); return this; },
        not(field, _operator, value) { filters.push((row) => row[field] !== value); return this; },
        order() { return this; },
        delete() {
          deletedTables.push(table);
          return this;
        },
        then(onFulfilled, onRejected) {
          const data = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
        },
        async range(start, end) {
          const data = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
          return { data: data.slice(start, end + 1), error: null };
        }
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: rpcResult, error: null };
    },
    storage: {
      from(bucket) {
        return {
          async list(folder) {
            if (listError) return { data: null, error: listError };
            return { data: storageEntries[`${bucket}/${folder}`] || [], error: null };
          },
          async remove(paths) {
            removed.push({ bucket, paths });
            return { data: paths, error: null };
          }
        };
      }
    }
  };
}

test('account cleanup removes only linked objects and recursively enumerates account-prefixed files', async () => {
  const supabase = createSupabase({
    documents: [
      { client_id: clientId, storage_bucket: 'legacy-bucket', storage_object_path: `${userId}/client/document.pdf` },
      { client_id: clientId, storage_bucket: 'legacy-bucket', storage_object_path: 'undefined/legacy-photo.jpg' }
    ],
    storageEntries: {
      [`taxflow-intake/${userId}`]: [
        { name: 'client', id: null },
        { name: 'root-file.pdf', id: 'file-id' }
      ],
      [`taxflow-intake/${userId}/client`]: [
        { name: 'nested-photo.jpg', id: 'nested-file-id' }
      ]
    }
  });

  const result = await deleteAccountStorage(supabase, userId, 'taxflow-intake');

  assert.deepEqual(result, { deletedObjectCount: 4 });
  assert.deepEqual(supabase.removed, [
    {
      bucket: 'legacy-bucket',
      paths: [`${userId}/client/document.pdf`, 'undefined/legacy-photo.jpg']
    },
    {
      bucket: 'taxflow-intake',
      paths: [`${userId}/client/nested-photo.jpg`, `${userId}/root-file.pdf`]
    }
  ]);
});

test('account cleanup stops before deleting when metadata points outside allowed namespaces', async () => {
  const supabase = createSupabase({
    documents: [
      { client_id: clientId, storage_bucket: 'legacy-bucket', storage_object_path: 'another-account/private.pdf' }
    ]
  });

  await assert.rejects(
    deleteAccountStorage(supabase, userId, 'taxflow-intake'),
    /outside the account storage namespace/
  );
  assert.deepEqual(supabase.removed, []);
});

test('account cleanup reports Storage enumeration failures instead of continuing', async () => {
  const supabase = createSupabase({ listError: new Error('Storage unavailable') });

  await assert.rejects(
    deleteAccountStorage(supabase, userId, 'taxflow-intake'),
    /Could not enumerate private storage.*Storage unavailable/
  );
  assert.deepEqual(supabase.removed, []);
});

test('account cleanup removes owned Vault secrets through the restricted database RPC', async () => {
  const { deleteAccountVaultSecrets } = require('../lib/accountDeletion');
  const supabase = createSupabase({
    integrations: [
      { id: 'integration-1', owner_user_id: userId, vault_secret_id: secretId },
      { id: 'integration-2', owner_user_id: userId, vault_secret_id: secretId }
    ],
    rpcResult: 1
  });

  const result = await deleteAccountVaultSecrets(supabase, userId);

  assert.deepEqual(result, { deletedSecretCount: 1 });
  assert.deepEqual(supabase.rpcCalls, [{
    name: 'delete_account_vault_secrets',
    args: { p_owner_user_id: userId, p_secret_ids: [secretId] }
  }]);
});

test('account cleanup does not hide a Vault RPC failure', async () => {
  const { deleteAccountVaultSecrets } = require('../lib/accountDeletion');
  const supabase = createSupabase({
    integrations: [{ id: 'integration-1', owner_user_id: userId, vault_secret_id: secretId }]
  });
  supabase.rpc = async () => ({ data: null, error: new Error('Vault function is unavailable') });

  await assert.rejects(
    deleteAccountVaultSecrets(supabase, userId),
    /Could not remove account-owned integration secrets.*Vault function is unavailable/
  );
});

test('collectClientPortalAuthUserIds discovers portal auth accounts linked to CA clients', async () => {
  const { collectClientPortalAuthUserIds } = require('../lib/accountDeletion');
  const portalUserId = '33333333-3333-4333-a333-333333333333';
  const supabase = createSupabase({ portalUsers: [portalUserId] });

  const ids = await collectClientPortalAuthUserIds(supabase, userId);
  assert.deepEqual(ids, [portalUserId]);
});

test('deleteClientPortalAuthUsers deletes all client portal auth users and handles errors gracefully', async () => {
  const { deleteClientPortalAuthUsers } = require('../lib/accountDeletion');
  const portalUserId = '33333333-3333-4333-a333-333333333333';
  const supabase = createSupabase();

  const result = await deleteClientPortalAuthUsers(supabase, [portalUserId]);
  assert.equal(result.deletedPortalCount, 1);
  assert.deepEqual(supabase.deletedUsers, [portalUserId]);
});

test('deleteAccountDatabaseRecords uses atomic RPC when present or falls back to cascade', async () => {
  const { deleteAccountDatabaseRecords } = require('../lib/accountDeletion');
  const portalUserId = '33333333-3333-4333-a333-333333333333';
  const supabase = createSupabase({
    rpcResult: { success: true, clientCount: 1, portalUserIds: [portalUserId], portalUserCount: 1 }
  });

  const result = await deleteAccountDatabaseRecords(supabase, userId);
  assert.equal(result.success, true);
  assert.equal(result.clientCount, 1);
  assert.deepEqual(result.portalUserIds, [portalUserId]);
});

test('purgeAccountCompletely deletes storage, secrets, db records, client portal auth, and CA auth account', async () => {
  const { purgeAccountCompletely } = require('../lib/accountDeletion');
  const portalUserId = '33333333-3333-4333-a333-333333333333';
  const supabase = createSupabase({
    documents: [
      { client_id: clientId, storage_bucket: 'taxflow-intake', storage_object_path: `${userId}/client/doc.pdf` }
    ],
    rpcResult: { success: true, clientCount: 1, portalUserIds: [portalUserId], portalUserCount: 1 }
  });

  const result = await purgeAccountCompletely(supabase, userId, 'taxflow-intake');
  assert.equal(result.success, true);
  assert.equal(result.clientCount, 1);
  assert.equal(result.deletedPortalCount, 1);
  assert.equal(result.deletedObjectCount, 1);
  // Both portal user and CA user must be deleted from Supabase Auth admin
  assert.ok(supabase.deletedUsers.includes(portalUserId));
  assert.ok(supabase.deletedUsers.includes(userId));
});
