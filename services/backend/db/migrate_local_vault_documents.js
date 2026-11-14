const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { supabase } = require('./supabase');
const {
  downloadDocument,
  getStorageBucket,
  getStorageObjectKey,
  normalizeMimeType,
  sha256,
  uploadDocument
} = require('../lib/documentStorage');

const PAGE_SIZE = 200;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MIME_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json'
};

async function fetchAllClients() {
  const clientsById = new Map();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from('clients')
      .select('id,user_id')
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    for (const client of data || []) clientsById.set(client.id, client.user_id);
    if (!data || data.length < PAGE_SIZE) return clientsById;
  }
}

async function resolveLegacyVaultRoot() {
  const configuredPath = process.env.VAULT_PATH;
  if (configuredPath) return fs.realpath(configuredPath);
  const configPath = path.join(__dirname, '..', 'vault', 'config.json');
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (typeof config.vaultPath === 'string') return fs.realpath(config.vaultPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read the legacy vault configuration: ${error.message}`);
  }
  throw new Error('Set VAULT_PATH to the existing local vault directory before migrating documents.');
}

function parseLegacyCloudReference(vaultPath) {
  const prefix = 'supabase://';
  if (!String(vaultPath || '').startsWith(prefix)) return null;
  const reference = String(vaultPath).slice(prefix.length);
  const separator = reference.indexOf('/');
  if (separator <= 0 || separator === reference.length - 1) {
    throw new Error('The legacy Supabase Storage reference is invalid.');
  }
  return { bucket: reference.slice(0, separator), objectKey: reference.slice(separator + 1) };
}

async function migrateDocument(document, clientsById, root, bucket) {
  const userId = clientsById.get(document.client_id);
  if (!userId) throw new Error('The document has no owning client account.');
  const createdAt = new Date(document.created_at);
  if (Number.isNaN(createdAt.getTime())) throw new Error('The document creation date is invalid.');
  const objectKey = getStorageObjectKey({
    userId,
    clientId: document.client_id,
    year: String(createdAt.getUTCFullYear()),
    month: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(createdAt),
    category: document.category,
    documentId: document.id,
    fileName: document.file_name
  });
  const extension = path.extname(document.file_name).slice(1).toLowerCase();
  const mimeType = normalizeMimeType(MIME_TYPES[extension] || 'application/octet-stream');
  const legacyCloudReference = parseLegacyCloudReference(document.vault_path);
  let content;
  let checksum;

  if (legacyCloudReference) {
    if (legacyCloudReference.bucket !== bucket || legacyCloudReference.objectKey !== objectKey) {
      throw new Error('The legacy cloud reference does not match the configured private bucket and expected document path.');
    }
    content = await downloadDocument(bucket, objectKey);
  } else {
    if (!document.vault_path) throw new Error('The document does not have a local source file path.');
    const sourcePath = await fs.realpath(document.vault_path);
    if (!sourcePath.startsWith(`${root}${path.sep}`)) {
      throw new Error('The source file is outside the configured legacy vault.');
    }
    const sourceStat = await fs.stat(sourcePath);
    if (!sourceStat.isFile()) throw new Error('The source path is not a regular file.');
    if (!sourceStat.size || sourceStat.size > MAX_DOCUMENT_BYTES) {
      throw new Error('The source file must be between 1 byte and 20 MB to fit the configured Storage bucket.');
    }
    content = await fs.readFile(sourcePath);
    try {
      await uploadDocument(objectKey, content, mimeType);
    } catch (error) {
      if (!/already exists|duplicate/i.test(error.message)) throw error;
      const existing = await downloadDocument(bucket, objectKey);
      if (sha256(existing) !== sha256(content)) {
        throw new Error('A different cloud file already exists at the expected document path.');
      }
    }
  }

  if (!content.length || content.length > MAX_DOCUMENT_BYTES) {
    throw new Error('The source file must be between 1 byte and 20 MB to fit the configured Storage bucket.');
  }
  checksum = sha256(content);
  if (document.file_sha256 && document.file_sha256 !== checksum) {
    throw new Error('The source file checksum does not match the recorded checksum.');
  }
  const verified = await downloadDocument(bucket, objectKey);
  if (sha256(verified) !== checksum) throw new Error('The cloud copy failed SHA-256 verification.');
  const { data, error } = await supabase.from('documents_metadata')
    .update({
      storage_bucket: bucket,
      storage_object_path: objectKey,
      file_sha256: checksum,
      mime_type: mimeType
    })
    .eq('id', document.id)
    .is('storage_object_path', null)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: current, error: currentError } = await supabase.from('documents_metadata')
      .select('storage_bucket,storage_object_path,file_sha256')
      .eq('id', document.id)
      .single();
    if (currentError) throw currentError;
    if (current.storage_bucket !== bucket || current.storage_object_path !== objectKey || current.file_sha256 !== checksum) {
      throw new Error('Document metadata changed while its cloud copy was being verified.');
    }
  }
}

async function main() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  const bucket = getStorageBucket();
  if (!bucket) throw new Error('SUPABASE_STORAGE_BUCKET is required.');
  const { data: bucketConfig, error: bucketError } = await supabase.storage.getBucket(bucket);
  if (bucketError) throw new Error(`Could not verify the configured storage bucket: ${bucketError.message}`);
  if (!bucketConfig || bucketConfig.public !== false) {
    throw new Error('The configured document storage bucket must be private.');
  }
  let root = null;
  const clientsById = await fetchAllClients();
  let migrated = 0;
  let failed = 0;
  let lastId = '00000000-0000-0000-0000-000000000000';

  for (;;) {
    const { data, error } = await supabase.from('documents_metadata')
      .select('id,client_id,file_name,category,created_at,vault_path,storage_object_path,file_sha256')
      .gt('id', lastId)
      .is('storage_object_path', null)
      .not('vault_path', 'is', null)
      .order('id')
      .limit(PAGE_SIZE);
    if (error) throw error;
    if (!data?.length) break;
    for (const document of data) {
      lastId = document.id;
      try {
        if (!parseLegacyCloudReference(document.vault_path) && !root) {
          root = await resolveLegacyVaultRoot();
        }
        await migrateDocument(document, clientsById, root, bucket);
        migrated += 1;
        console.log(`[Storage migration] Verified document ${document.id}.`);
      } catch (error) {
        failed += 1;
        console.error(`[Storage migration] Document ${document.id} was not migrated: ${error.message}`);
      }
    }
  }

  console.log(`[Storage migration] Complete: ${migrated} migrated, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[Storage migration] Aborted: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseLegacyCloudReference };
