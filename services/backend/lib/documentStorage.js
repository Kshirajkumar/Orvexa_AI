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

function getVersionStorageObjectKey({ userId, clientId, documentId, versionId, fileName }) {
  for (const [label, value] of [['user', userId], ['client', clientId], ['document', documentId], ['version', versionId]]) {
    if (!UUID_PATTERN.test(String(value || ''))) {
      throw new Error(`A valid ${label} UUID is required to create a private document version path.`);
    }
  }
  return `${userId}/${clientId}/documents/${documentId}/${versionId}_${sanitizeStorageFileName(fileName)}`;
}

function isOwnedDocumentObject({ bucket, objectKey, userId, clientId, documentId }) {
  if (!getStorageBucket() || bucket !== getStorageBucket()) return false;
  for (const value of [userId, clientId, documentId]) {
    if (!UUID_PATTERN.test(String(value || ''))) return false;
  }
  const parts = String(objectKey || '').split('/');
  if (parts[0] !== userId || parts[1] !== clientId) return false;

  if (
    parts.length === 5
    && parts[2] === 'documents'
    && parts[3] === documentId
    && UUID_PATTERN.test(parts[4].slice(0, 36))
    && parts[4][36] === '_'
    && parts[4].length > 37
  ) return true;

  const months = new Set([
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]);
  return parts.length === 6
    && /^\d{4}$/.test(parts[2])
    && months.has(parts[3])
    && ['Raw', 'Extracted', 'Generated'].includes(parts[4])
    && parts[5].startsWith(`${documentId}_`)
    && parts[5].length > documentId.length + 1;
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

async function releaseUploadReservation(userId, reservationId) {
  try {
    const { error } = await supabase.rpc('release_document_upload', {
      p_user_id: userId,
      p_reservation_id: reservationId
    });
    if (error) throw error;
  } catch (error) {
    console.error('[Document Storage] Failed to release generated upload reservation:', error.message);
  }
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
  const { data: reservationId, error: reservationError } = await supabase.rpc('begin_document_upload', {
    p_user_id: userId,
    p_client_id: clientId,
    p_document_id: id,
    p_created_by: userId
  });
  if (reservationError) throw reservationError;

  let uploaded;
  try {
    uploaded = await uploadDocument(objectKey, content, mimeType);
  } catch (error) {
    await releaseUploadReservation(userId, reservationId);
    throw error;
  }
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
  const { data, error } = await supabase.rpc('create_document_metadata_if_client_active', {
    p_user_id: userId,
    p_reservation_id: reservationId,
    p_document: row
  });
  if (error || !data) {
    try {
      await deleteDocument(uploaded.bucket, uploaded.objectKey);
    } catch (cleanupError) {
      console.error('[Document Storage] Generated document rollback failed:', cleanupError.message);
    }
    await releaseUploadReservation(userId, reservationId);
    throw error || new Error('Generated document metadata was not saved.');
  }
  return Array.isArray(data) ? data[0] : data;
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
  getVersionStorageObjectKey,
  isOwnedDocumentObject,
  isExpectedDocumentObject,
  normalizeMimeType,
  sanitizeStorageFileName,
  saveGeneratedDocument,
  sha256,
  uploadDocument
};
