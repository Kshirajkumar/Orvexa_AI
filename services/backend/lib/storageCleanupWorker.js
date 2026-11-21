const { supabase, isConnected } = require('../db/supabase');
const { isOwnedDocumentObject } = require('./documentStorage');

const POLL_INTERVAL_MS = 15_000;
const STORAGE_PAGE_SIZE = 100;
const STORAGE_REMOVE_BATCH_SIZE = 100;
let pollTimer = null;
let polling = false;

async function collectStorageObjects(storage, bucket, folder, objects, visited) {
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
  if (!normalizedFolder || visited.has(normalizedFolder)) return;
  visited.add(normalizedFolder);

  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await storage.from(bucket).list(normalizedFolder, {
      limit: STORAGE_PAGE_SIZE,
      offset
    });
    if (error) throw new Error(`Could not enumerate client cloud storage: ${error.message}`);
    const entries = data || [];
    for (const entry of entries) {
      if (!entry?.name || entry.name === '.' || entry.name === '..' || entry.name.includes('/')) continue;
      const objectPath = `${normalizedFolder}/${entry.name}`;
      if (entry.id === null) {
        await collectStorageObjects(storage, bucket, objectPath, objects, visited);
      } else {
        objects.add(objectPath);
      }
    }
    if (entries.length < STORAGE_PAGE_SIZE) return;
  }
}

async function removeClientPortalAuthUser(job) {
  if (!job.portal_user_id) return false;

  // Supabase's admin signOut endpoint accepts a session JWT, not a user ID.
  // The portal middleware therefore revokes access through the database state
  // check immediately, and the Auth user is deleted here as the final phase.
  const { error: deleteError } = await supabase.auth.admin.deleteUser(job.portal_user_id);
  if (deleteError && deleteError.status !== 404 && deleteError.code !== 'user_not_found') {
    throw deleteError;
  }
  return true;
}

async function removeJobObjects(job) {
  const objects = new Set();
  if (job.target_type === 'client') {
    const prefix = `${job.user_id}/${job.client_id}`;
    await collectStorageObjects(supabase.storage, job.storage_bucket, prefix, objects, new Set());
  } else {
    for (const objectPath of job.object_paths || []) {
      if (!isOwnedDocumentObject({
        bucket: job.storage_bucket,
        objectKey: objectPath,
        userId: job.user_id,
        clientId: job.client_id,
        documentId: job.target_id
      })) {
        throw new Error('A document version path is outside the expected client storage namespace.');
      }
      objects.add(objectPath);
    }
  }

  const paths = Array.from(objects);
  for (let offset = 0; offset < paths.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
    const { error } = await supabase.storage.from(job.storage_bucket)
      .remove(paths.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE));
    if (error) throw new Error(`Could not remove private cloud files: ${error.message}`);
  }
  return paths.length;
}

async function processStorageCleanupJob(job) {
  if (job.target_type === 'client' && job.status === 'auth_cleanup_pending') {
    try {
      const deleted = await removeClientPortalAuthUser(job);
      const { data: completed, error } = await supabase.rpc('complete_client_cleanup_job', { p_job_id: job.id });
      if (error) throw error;
      if (!completed) throw new Error('The client Auth cleanup job could not be finalized.');
      console.info(`[Storage Cleanup] Completed portal account cleanup ${job.id}; auth account deleted=${deleted}.`);
    } catch (error) {
      console.error(`[Storage Cleanup] Portal account cleanup ${job.id} failed:`, error.message);
      const { error: retryError } = await supabase.rpc('retry_client_auth_cleanup_job', {
        p_job_id: job.id,
        p_error: error.message
      });
      if (retryError) console.error(`[Storage Cleanup] Could not record Auth cleanup failure for ${job.id}:`, retryError.message);
    }
    return;
  }

  let databaseFinalized = false;
  try {
    const removedCount = await removeJobObjects(job);

    const { data: completed, error } = await supabase.rpc('complete_storage_cleanup_job', { p_job_id: job.id });
    if (error) throw error;
    if (!completed) throw new Error('The cleanup job could not be finalized.');
    databaseFinalized = job.target_type === 'client';

    if (job.target_type === 'client') {
      const deleted = await removeClientPortalAuthUser(job);
      const { data: authCompleted, error: authError } = await supabase.rpc('complete_client_cleanup_job', { p_job_id: job.id });
      if (authError) throw authError;
      if (!authCompleted) throw new Error('The client Auth cleanup job could not be finalized.');
      console.info(`[Storage Cleanup] Completed client cleanup ${job.id}; removed ${removedCount} cloud objects; auth account deleted=${deleted}.`);
    } else {
      console.info(`[Storage Cleanup] Completed ${job.target_type} cleanup ${job.id}; removed ${removedCount} cloud objects.`);
    }
  } catch (error) {
    console.error(`[Storage Cleanup] ${job.target_type} cleanup ${job.id} failed:`, error.message);
    if (job.target_type === 'client' && databaseFinalized) {
      const { error: retryError } = await supabase.rpc('retry_client_auth_cleanup_job', {
        p_job_id: job.id,
        p_error: error.message
      });
      if (retryError) console.error(`[Storage Cleanup] Could not record Auth cleanup failure for ${job.id}:`, retryError.message);
      return;
    }
    const { data: status, error: failError } = await supabase.rpc('fail_storage_cleanup_job', {
      p_job_id: job.id,
      p_error: error.message
    });
    if (failError) {
      console.error(`[Storage Cleanup] Could not record failure for job ${job.id}:`, failError.message);
      return;
    }
    if (status === 'failed') {
      console.error(`[Storage Cleanup] Job ${job.id} exhausted automatic retries and needs manual retry.`);
    }
  }
}

async function processStorageCleanupJobs() {
  if (!isConnected || !supabase || polling) return;
  polling = true;
  try {
    for (let processed = 0; processed < 10; processed += 1) {
      const { data, error } = await supabase.rpc('claim_storage_cleanup_job');
      if (error) throw error;
      const job = Array.isArray(data) ? data[0] : data;
      if (!job) break;
      await processStorageCleanupJob(job);
    }
  } catch (error) {
    console.error('[Storage Cleanup] Could not claim cleanup jobs:', error.message);
  } finally {
    polling = false;
  }
}

function startStorageCleanupWorker() {
  if (pollTimer || !isConnected || !supabase) return;
  void processStorageCleanupJobs();
  pollTimer = setInterval(() => void processStorageCleanupJobs(), POLL_INTERVAL_MS);
  pollTimer.unref?.();
  console.log('[Storage Cleanup] Durable cleanup worker started (15-second polling).');
}

function stopStorageCleanupWorker() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

module.exports = {
  collectStorageObjects,
  processStorageCleanupJob,
  processStorageCleanupJobs,
  removeJobObjects,
  startStorageCleanupWorker,
  stopStorageCleanupWorker
};
