const crypto = require('node:crypto');
const { supabase } = require('../db/supabase');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getStorageBucket() {
  return String(process.env.SUPABASE_STORAGE_BUCKET || '').trim();
}

function getStorageObjectKey({ userId, clientId, year, month, category, documentId, fileName }) {
  for (const [label, value] of [['user', userId], ['client', clientId], ['document', documentId]]) {
    if (!UUID_PATTERN.test(String(value || ''))) {
      throw new Error(`A valid ${label} UUID is required to create a private document storage path.`);
    }
  }
  const safeName = sanitizeStorageFileName(fileName);
  const folder = category === 'Extracted' || category === 'Generated' ? category : 'Raw';
  return `${userId}/${clientId}/${year}/${month}/${folder}/${documentId}_${safeName}`;
}

function isExpectedDocumentObject({ bucket, objectKey, userId, clientId, documentId, createdAt, fileName, category }) {
  try {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return false;
    const expectedKey = getStorageObjectKey({
      userId,
      clientId,
      year: String(date.getUTCFullYear()),
      month: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date),
      category,
      documentId,
      fileName
    });
    return Boolean(getStorageBucket() && bucket === getStorageBucket() && objectKey === expectedKey);
  } catch {
    return false;
  }
}

function sanitizeStorageFileName(fileName) {
  const safeName = String(fileName || 'document')
    .replace(/[\\/]/g, '_')
    .replace(/[^\w.\- ]/g, '_')
    .trim()
    .slice(0, 120);
  return safeName || 'document';
}

async function saveGeneratedDocument({ userId, clientId, clientName, fileName, category, content, mimeType, assessmentYear }) {
  if (!['Extracted', 'Generated'].includes(category)) throw new Error('Generated document category is invalid.');
  if (!Buffer.isBuffer(content) || !content.length) throw new Error('Generated document content is empty.');
  const createdAt = new Date();
  const id = crypto.randomUUID();
  const safeName = sanitizeStorageFileName(fileName);
  const objectKey = getStorageObjectKey({
    userId,
    clientId,
    year: String(createdAt.getUTCFullYear()),
    month: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(createdAt),
    category,
    documentId: id,
    fileName: safeName
  });
  const uploaded = await uploadDocument(objectKey, content, mimeType);
  const row = {
    id,
    client_id: clientId,
    client_name: clientName,
    file_name: safeName,
    file_type: 'OTHER',
    file_size_kb: Number((content.length / 1024).toFixed(2)),
    category,
    source: 'Upload',
    status: 'Extracted',
    storage_bucket: uploaded.bucket,
    storage_object_path: uploaded.objectKey,
    file_sha256: sha256(content),
    mime_type: normalizeMimeType(mimeType),
    assessment_year: typeof assessmentYear === 'string' ? assessmentYear.slice(0, 10) : null,
    created_at: createdAt.toISOString()
  };
  const { data, error } = await supabase.from('documents_metadata').insert(row).select().single();
  if (error) {
    try {
      await deleteDocument(uploaded.bucket, uploaded.objectKey);
    } catch (cleanupError) {
      console.error('[Document Storage] Generated document rollback failed:', cleanupError.message);
    }
    throw error;
  }
  return data;
}

function normalizeMimeType(value) {
  const mimeType = String(value || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)
    ? mimeType
    : 'application/octet-stream';
}

async function uploadDocument(objectKey, buffer, contentType) {
  const bucket = getStorageBucket();
  if (!supabase || !bucket) {
    const error = new Error('Supabase Storage is not configured.');
    error.status = 503;
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Document content is empty.');
  if (buffer.length > 20 * 1024 * 1024) throw new Error('Document content exceeds the 20 MB limit.');
  const { data: bucketConfig, error: bucketError } = await supabase.storage.getBucket(bucket);
  if (bucketError) {
    const error = new Error(`Could not verify the configured storage bucket: ${bucketError.message}`);
    error.status = 503;
    throw error;
  }
  if (!bucketConfig || bucketConfig.public !== false) {
    const error = new Error('Document storage must use a private Supabase bucket.');
    error.status = 503;
    throw error;
  }

  const { error } = await supabase.storage.from(bucket).upload(objectKey, buffer, {
    contentType: normalizeMimeType(contentType),
    upsert: false
  });
  if (error) throw error;
  return { bucket, objectKey };
}

async function downloadDocument(bucket, objectKey) {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  const { data, error } = await supabase.storage.from(bucket).download(objectKey);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

async function deleteDocument(bucket, objectKey) {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  const { error } = await supabase.storage.from(bucket).remove([objectKey]);
  if (error) throw error;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  deleteDocument,
  downloadDocument,
  getStorageBucket,
  getStorageObjectKey,
  isExpectedDocumentObject,
  normalizeMimeType,
  sanitizeStorageFileName,
  saveGeneratedDocument,
  sha256,
  uploadDocument
};
