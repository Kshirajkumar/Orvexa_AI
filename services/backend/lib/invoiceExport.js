const {
  getStorageBucket,
  getStorageObjectKey,
  getVersionStorageObjectKey,
  isOwnedDocumentObject,
  releaseUploadReservation,
  sha256,
  uploadDocument
} = require('./documentStorage');
const { supabase } = require('../db/supabase');

const JSON_MIME_TYPE = 'application/json';

function getStorageDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('The invoice approval date is invalid.');
  return {
    year: String(date.getUTCFullYear()),
    month: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date)
  };
}

function assertExportDocument(document, request, userId) {
  if (!document
    || document.client_id !== request.clientId
    || document.category !== 'Extracted'
    || !isOwnedDocumentObject({
      bucket: document.storage_bucket,
      objectKey: document.storage_object_path,
      userId,
      clientId: request.clientId,
      documentId: request.exportDocumentId
    })) {
    const error = new Error('The existing invoice export is not in the expected private client folder.');
    error.status = 409;
    throw error;
  }
}

async function findExportDocument(request) {
  const { data, error } = await supabase.from('documents_metadata')
    .select('id, client_id, category, file_name, file_type, file_sha256, storage_bucket, storage_object_path, created_at')
    .eq('id', request.exportDocumentId)
    .eq('client_id', request.clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveNewExport({ request, userId, client, sourceDocument, fileName, content, contentHash }) {
  const { year, month } = getStorageDate(request.createdAt);
  const objectKey = getStorageObjectKey({
    userId,
    clientId: request.clientId,
    year,
    month,
    category: 'Extracted',
    documentId: request.exportDocumentId,
    fileName
  });
  let reservationId = null;
  try {
    const { data: reservation, error: reservationError } = await supabase.rpc('begin_document_upload', {
      p_user_id: userId,
      p_client_id: request.clientId,
      p_document_id: request.exportDocumentId,
      p_created_by: userId
    });
    if (reservationError) throw reservationError;
    reservationId = reservation;
    await uploadDocument(objectKey, content, JSON_MIME_TYPE, true);

    const { error: saveError } = await supabase.rpc('create_document_metadata_if_client_active', {
      p_user_id: userId,
      p_reservation_id: reservationId,
      p_document: {
        id: request.exportDocumentId,
        client_id: request.clientId,
        client_name: client.name,
        file_name: fileName,
        file_type: 'OTHER',
        file_size_kb: Number((content.length / 1024).toFixed(2)),
        category: 'Extracted',
        source: 'Upload',
        status: 'Verified',
        storage_bucket: getStorageBucket(),
        storage_object_path: objectKey,
        file_sha256: contentHash,
        mime_type: JSON_MIME_TYPE,
        assessment_year: sourceDocument.assessment_year || null,
        created_at: request.createdAt
      }
    });
    if (saveError) {
      const existing = await findExportDocument(request);
      if (!existing || existing.file_sha256 !== contentHash) throw saveError;
      await releaseUploadReservation(userId, reservationId);
    }
    reservationId = null;
  } finally {
    if (reservationId) await releaseUploadReservation(userId, reservationId);
  }
}

async function saveExportVersion({ request, userId, fileName, content, contentHash, existingDocument }) {
  assertExportDocument(existingDocument, request, userId);

  const { data: existingVersion, error: versionError } = await supabase.from('document_versions')
    .select('id, file_sha256, storage_object_path')
    .eq('id', request.exportFileVersionId)
    .eq('document_id', request.exportDocumentId)
    .maybeSingle();
  if (versionError) throw versionError;
  if (existingVersion) {
    if (existingVersion.file_sha256 !== contentHash) {
      const error = new Error('The saved invoice export version does not match this review. Keep the review open and contact support.');
      error.status = 409;
      throw error;
    }
    return;
  }

  const objectKey = getVersionStorageObjectKey({
    userId,
    clientId: request.clientId,
    documentId: request.exportDocumentId,
    versionId: request.exportFileVersionId,
    fileName
  });
  let reservationId = null;
  try {
    const { data: reservation, error: reservationError } = await supabase.rpc('begin_document_upload', {
      p_user_id: userId,
      p_client_id: request.clientId,
      p_document_id: request.exportDocumentId,
      p_created_by: userId
    });
    if (reservationError) throw reservationError;
    reservationId = reservation;
    await uploadDocument(objectKey, content, JSON_MIME_TYPE, true);

    const { error: registerError } = await supabase.rpc('register_invoice_export_version', {
      p_user_id: userId,
      p_reservation_id: reservationId,
      p_document_id: request.exportDocumentId,
      p_version_id: request.exportFileVersionId,
      p_storage_bucket: getStorageBucket(),
      p_storage_object_path: objectKey,
      p_file_name: fileName,
      p_file_size_kb: Number((content.length / 1024).toFixed(2)),
      p_file_sha256: contentHash,
      p_mime_type: JSON_MIME_TYPE
    });
    if (registerError) {
      const { data: savedVersion, error: lookupError } = await supabase.from('document_versions')
        .select('id, file_sha256')
        .eq('id', request.exportFileVersionId)
        .eq('document_id', request.exportDocumentId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!savedVersion || savedVersion.file_sha256 !== contentHash) throw registerError;
      await releaseUploadReservation(userId, reservationId);
    }
    reservationId = null;
  } finally {
    if (reservationId) await releaseUploadReservation(userId, reservationId);
  }
}

async function saveInvoiceExport({ request, userId, client, sourceDocument, invoiceVersion }) {
  const fileName = `invoice_${request.invoiceRecordId}.json`;
  const content = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    invoiceRecordId: request.invoiceRecordId,
    version: invoiceVersion,
    sourceDocumentId: request.documentId,
    reviewedAt: request.createdAt,
    reviewedBy: request.reviewedBy,
    invoice: request.reviewedData
  }, null, 2), 'utf8');
  const contentHash = sha256(content);
  const existingDocument = await findExportDocument(request);

  if (!existingDocument) {
    if (request.exportFileVersionId) {
      const error = new Error('The previous invoice export is missing; the review cannot safely append a version.');
      error.status = 409;
      throw error;
    }
    await saveNewExport({ request, userId, client, sourceDocument, fileName, content, contentHash });
    return contentHash;
  }

  assertExportDocument(existingDocument, request, userId);
  if (request.exportFileVersionId) {
    await saveExportVersion({ request, userId, fileName, content, contentHash, existingDocument });
    return contentHash;
  }
  if (existingDocument.file_sha256 !== contentHash) {
    const error = new Error('The existing invoice export differs from the pending approval. The review was not finalized.');
    error.status = 409;
    throw error;
  }
  return contentHash;
}

module.exports = { saveInvoiceExport };
