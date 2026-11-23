const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;
const STORAGE_PAGE_SIZE = 100;
const STORAGE_REMOVE_BATCH_SIZE = 100;

async function fetchAllPages(makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function collectStorageFiles(storage, bucket, folder, files, visited) {
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
  if (visited.has(normalizedFolder)) return;
  visited.add(normalizedFolder);

  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await storage.from(bucket).list(normalizedFolder, {
      limit: STORAGE_PAGE_SIZE,
      offset
    });
    if (error) {
      if (/not found/i.test(error.message)) return;
      throw new Error(`Could not enumerate private storage for account deletion: ${error.message}`);
    }
    const entries = data || [];
    for (const entry of entries) {
      if (!entry?.name || entry.name === '.' || entry.name === '..' || entry.name.includes('/')) continue;
      const objectPath = `${normalizedFolder}/${entry.name}`;
      if (entry.id === null) {
        await collectStorageFiles(storage, bucket, objectPath, files, visited);
      } else {
        files.add(objectPath);
      }
    }
    if (entries.length < STORAGE_PAGE_SIZE) return;
  }
}

async function deleteAccountStorage(supabase, userId, configuredBucket) {
  if (!UUID_PATTERN.test(userId || '')) throw new Error('A valid account ID is required for storage cleanup.');

  const clients = await fetchAllPages(() => supabase
    .from('clients')
    .select('id')
    .eq('user_id', userId)
    .order('id'));
  const clientIds = clients.map((client) => client.id).filter(Boolean);
  const docsByClient = [];
  for (let offset = 0; offset < clientIds.length; offset += 100) {
    const clientBatch = clientIds.slice(offset, offset + 100);
    const documents = await fetchAllPages(() => supabase
      .from('documents_metadata')
      .select('storage_bucket,storage_object_path')
      .in('client_id', clientBatch)
      .order('id')
      .not('storage_object_path', 'is', null));
    docsByClient.push(...documents);

    try {
      const versions = await fetchAllPages(() => supabase
        .from('document_versions')
        .select('storage_bucket,storage_object_path')
        .in('client_id', clientBatch)
        .order('id')
        .not('storage_object_path', 'is', null));
      docsByClient.push(...versions);
    } catch {
      // document_versions table may not exist in all environments
    }
  }

  const objectsByBucket = new Map();
  const addObject = (bucket, objectPath) => {
    if (!bucket || !objectPath) return;
    const safePath = String(objectPath).replace(/^\/+/, '');
    if (!safePath.startsWith(`${userId}/`) && !safePath.startsWith('undefined/')) {
      throw new Error('Account deletion stopped because a linked cloud file path is outside the account storage namespace.');
    }
    if (!objectsByBucket.has(bucket)) objectsByBucket.set(bucket, new Set());
    objectsByBucket.get(bucket).add(safePath);
  };

  for (const document of docsByClient) {
    addObject(document.storage_bucket, document.storage_object_path);
  }

  if (configuredBucket) {
    if (!objectsByBucket.has(configuredBucket)) objectsByBucket.set(configuredBucket, new Set());
    await collectStorageFiles(
      supabase.storage,
      configuredBucket,
      userId,
      objectsByBucket.get(configuredBucket),
      new Set()
    );
  }

  let deletedObjectCount = 0;
  for (const [bucket, objectPaths] of objectsByBucket) {
    const paths = Array.from(objectPaths);
    for (let offset = 0; offset < paths.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE));
      if (error && !/not found/i.test(error.message)) throw new Error(`Could not remove private account files from bucket "${bucket}": ${error.message}`);
      deletedObjectCount += Math.min(STORAGE_REMOVE_BATCH_SIZE, paths.length - offset);
    }
  }

  return { deletedObjectCount };
}

async function deleteAccountVaultSecrets(supabase, userId) {
  try {
    const integrations = await fetchAllPages(() => supabase
      .from('integration_secrets')
      .select('id,vault_secret_id')
      .eq('owner_user_id', userId)
      .order('id'));
    const secretIds = Array.from(new Set(integrations.map((integration) => integration.vault_secret_id).filter(Boolean)));
    if (!secretIds.length) return { deletedSecretCount: 0 };

    let deletedSecretCount = 0;
    for (let offset = 0; offset < secretIds.length; offset += 100) {
      const { data, error } = await supabase.rpc('delete_account_vault_secrets', {
        p_owner_user_id: userId,
        p_secret_ids: secretIds.slice(offset, offset + 100)
      });
      if (error) {
        throw new Error(`Could not remove account-owned integration secrets from Supabase Vault: ${error.message}`);
      }
      if (!Number.isSafeInteger(data) || data < 0) {
        throw new Error('Supabase Vault returned an invalid result while deleting account integration secrets.');
      }
      deletedSecretCount += data;
    }

    return { deletedSecretCount };
  } catch (err) {
    if (/relation.*does not exist|not found/i.test(err.message)) {
      return { deletedSecretCount: 0 };
    }
    throw err;
  }
}

/**
 * Discovers all client portal auth user IDs (auth.users.id) linked to this CA's clients.
 */
async function collectClientPortalAuthUserIds(supabase, userId) {
  if (!UUID_PATTERN.test(userId || '')) return [];

  const portalUserIds = new Set();
  try {
    const clients = await fetchAllPages(() => supabase
      .from('clients')
      .select('id')
      .eq('user_id', userId)
      .order('id'));
    const clientIds = clients.map((c) => c.id).filter(Boolean);

    if (clientIds.length > 0) {
      for (let offset = 0; offset < clientIds.length; offset += 100) {
        const batch = clientIds.slice(offset, offset + 100);

        // 1. client_portal_access
        try {
          const { data: accessRows } = await supabase
            .from('client_portal_access')
            .select('user_id')
            .in('client_id', batch)
            .not('user_id', 'is', null);
          (accessRows || []).forEach(r => { if (r.user_id && r.user_id !== userId) portalUserIds.add(r.user_id); });
        } catch { /* ignore if table missing */ }

        // 2. client_user_profiles
        try {
          const { data: profileRows } = await supabase
            .from('client_user_profiles')
            .select('user_id')
            .in('client_id', batch)
            .not('user_id', 'is', null);
          (profileRows || []).forEach(r => { if (r.user_id && r.user_id !== userId) portalUserIds.add(r.user_id); });
        } catch { /* ignore if table missing */ }

        // 3. client_portal_invites
        try {
          const { data: inviteRows } = await supabase
            .from('client_portal_invites')
            .select('claimed_by_user_id')
            .in('client_id', batch)
            .not('claimed_by_user_id', 'is', null);
          (inviteRows || []).forEach(r => { if (r.claimed_by_user_id && r.claimed_by_user_id !== userId) portalUserIds.add(r.claimed_by_user_id); });
        } catch { /* ignore if table missing */ }

        // 4. storage_cleanup_jobs
        try {
          const { data: jobRows } = await supabase
            .from('storage_cleanup_jobs')
            .select('portal_user_id')
            .in('client_id', batch)
            .not('portal_user_id', 'is', null);
          (jobRows || []).forEach(r => { if (r.portal_user_id && r.portal_user_id !== userId) portalUserIds.add(r.portal_user_id); });
        } catch { /* ignore if table missing */ }
      }
    }
  } catch (err) {
    console.warn('[AUTH] Warning collecting client portal auth user IDs:', err.message);
  }

  return Array.from(portalUserIds);
}

/**
 * Removes all database records associated with the CA user and their clients.
 * Uses atomic RPC delete_ca_user_all_data if present, or executes sequential table cleanup.
 */
async function deleteAccountDatabaseRecords(supabase, userId) {
  if (!UUID_PATTERN.test(userId || '')) throw new Error('A valid account ID is required for database cleanup.');

  // Try the atomic database RPC first
  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('delete_ca_user_all_data', {
      p_ca_user_id: userId
    });

    if (!rpcError && rpcResult?.success) {
      const portalUserIds = Array.isArray(rpcResult.portalUserIds) ? rpcResult.portalUserIds.filter(Boolean) : [];
      return {
        success: true,
        clientCount: rpcResult.clientCount || 0,
        portalUserIds,
        portalUserCount: rpcResult.portalUserCount || portalUserIds.length
      };
    }

    if (rpcError && !/function.*delete_ca_user_all_data.*does not exist|PGRST202/i.test(rpcError.message)) {
      console.warn('[AUTH] delete_ca_user_all_data RPC returned error, falling back to direct database cleanup:', rpcError.message);
    }
  } catch (err) {
    console.warn('[AUTH] delete_ca_user_all_data RPC failed, falling back to direct cleanup:', err.message);
  }

  // Fallback: direct table-by-table cascade in proper dependency order
  const clients = await fetchAllPages(() => supabase
    .from('clients')
    .select('id')
    .eq('user_id', userId)
    .order('id'));
  const clientIds = clients.map((c) => c.id).filter(Boolean);

  if (clientIds.length > 0) {
    for (let offset = 0; offset < clientIds.length; offset += 100) {
      const batch = clientIds.slice(offset, offset + 100);

      // Child tables
      const safeDelete = async (table, column = 'client_id') => {
        try {
          await supabase.from(table).delete().in(column, batch);
        } catch { /* ignore missing optional tables */ }
      };

      await safeDelete('document_file_activity');
      await safeDelete('extraction_runs');
      await safeDelete('extracted_fields');
      await safeDelete('invoice_records');
      await safeDelete('ai_usage_log');
      await safeDelete('whatsapp_messages');
      await safeDelete('compliance_tasks');
      await safeDelete('document_sync_receipts');
      await safeDelete('document_upload_reservations');
      await safeDelete('document_versions');
      await safeDelete('documents_metadata');
      await safeDelete('client_portal_invites');
      await safeDelete('client_portal_access');
      await safeDelete('ca_client_relationships');
      await safeDelete('client_user_profiles');
      await safeDelete('client_deletion_audit');
      await safeDelete('storage_cleanup_jobs');
      await safeDelete('clients', 'id');
    }
  }

  // CA-level tables
  const safeDeleteUser = async (table, column = 'user_id') => {
    try {
      await supabase.from(table).delete().eq(column, userId);
    } catch { /* ignore missing optional tables */ }
  };

  await safeDeleteUser('document_file_activity');
  await safeDeleteUser('storage_cleanup_jobs');
  await safeDeleteUser('telegram_message_schedules');
  await safeDeleteUser('telegram_messages');
  await safeDeleteUser('telegram_chats');
  await safeDeleteUser('telegram_link_tokens');
  await safeDeleteUser('notifications');
  await safeDeleteUser('message_templates');
  await safeDeleteUser('auth_email_verification_challenges');
  await safeDeleteUser('integration_secrets', 'owner_user_id');
  await safeDeleteUser('client_deletion_audit', 'owner_user_id');
  await safeDeleteUser('ca_user_profiles');
  await safeDeleteUser('user_profiles', 'id');

  return {
    success: true,
    clientCount: clientIds.length,
    portalUserIds: [],
    portalUserCount: 0
  };
}

/**
 * Permanently deletes client portal Auth users from Supabase Auth admin API.
 */
async function deleteClientPortalAuthUsers(supabase, portalUserIds) {
  if (!Array.isArray(portalUserIds) || !portalUserIds.length) {
    return { deletedPortalCount: 0 };
  }

  let deletedPortalCount = 0;
  for (const portalUserId of portalUserIds) {
    if (!UUID_PATTERN.test(portalUserId || '')) continue;
    try {
      const { error } = await supabase.auth.admin.deleteUser(portalUserId);
      if (!error || /not found|does not exist/i.test(error.message)) {
        deletedPortalCount++;
      } else {
        console.warn(`[AUTH] Could not delete client portal Auth account ${portalUserId}:`, error.message);
      }
    } catch (err) {
      console.warn(`[AUTH] Exception deleting client portal Auth account ${portalUserId}:`, err.message);
    }
  }

  return { deletedPortalCount };
}

/**
 * Master orchestrator for complete, production-grade permanent account deletion.
 * Cleans private storage, Vault secrets, database rows, client portal auth accounts, and the CA auth user.
 */
async function purgeAccountCompletely(supabase, userId, storageBucket) {
  if (!UUID_PATTERN.test(userId || '')) {
    throw new Error('A valid account ID is required for permanent account deletion.');
  }

  // Step 1: Pre-collect client portal Auth user IDs
  const preCollectedPortalUserIds = await collectClientPortalAuthUserIds(supabase, userId);

  // Step 2: Delete private cloud storage objects
  const { deletedObjectCount } = await deleteAccountStorage(supabase, userId, storageBucket);

  // Step 3: Delete account Vault integration secrets
  const { deletedSecretCount } = await deleteAccountVaultSecrets(supabase, userId);

  // Step 4: Delete all relational rows (clients, documents, tasks, messages, profiles)
  const dbCleanup = await deleteAccountDatabaseRecords(supabase, userId);

  // Combine discovered client portal user IDs
  const combinedPortalUserIds = Array.from(new Set([
    ...preCollectedPortalUserIds,
    ...(dbCleanup.portalUserIds || [])
  ])).filter((id) => id && id !== userId);

  // Step 5: Delete all client portal Auth accounts
  const { deletedPortalCount } = await deleteClientPortalAuthUsers(supabase, combinedPortalUserIds);

  // Step 6: Finally delete the CA user's own Auth account
  const { error: authDeleteError } = await supabase.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    console.error(`[AUTH] CA Auth account deletion failed for ${userId}:`, authDeleteError.message);
    throw new Error(`Cloud data was removed, but sign-in account deletion encountered an issue: ${authDeleteError.message}. Contact support if you cannot sign in.`);
  }

  return {
    deletedObjectCount,
    deletedSecretCount,
    deletedPortalCount,
    clientCount: dbCleanup.clientCount,
    success: true
  };
}

module.exports = {
  deleteAccountStorage,
  deleteAccountVaultSecrets,
  collectClientPortalAuthUserIds,
  deleteAccountDatabaseRecords,
  deleteClientPortalAuthUsers,
  purgeAccountCompletely
};
