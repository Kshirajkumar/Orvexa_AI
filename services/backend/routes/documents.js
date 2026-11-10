/**
 * TaxFlow.AI — Cloud document routes
 */

const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { supabase, isConnected } = require('../db/supabase');
const { getOwnedClientIds, assertOwnedClient } = require('../lib/ownership');
const { validateExtractionData } = require('../lib/extractionSchema');
const {
  deleteDocument,
  downloadDocument,
  getStorageBucket,
  getStorageObjectKey,
  getVersionStorageObjectKey,
  isOwnedDocumentObject,
  normalizeMimeType,
  sanitizeStorageFileName,
  sha256,
  uploadDocument
} = require('../lib/documentStorage');

function normalizeFileType(fileType, fileName) {
  const extension = String(fileName || '').split('.').pop().toLowerCase();
  const types = {
    pdf: 'PDF', png: 'PNG', jpg: 'JPG', jpeg: 'JPEG', webp: 'WEBP',
    csv: 'CSV', xlsx: 'XLSX', xls: 'XLS', doc: 'DOC', docx: 'DOCX', txt: 'OTHER'
  };
  const expectedType = types[extension];
  if (!expectedType || (fileType && String(fileType).toUpperCase() !== expectedType)) return null;
  return expectedType;
}

function matchesFileSignature(fileType, buffer) {
  const startsWith = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
  switch (fileType) {
    case 'PDF': return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    case 'PNG': return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'JPG':
    case 'JPEG': return startsWith(0xff, 0xd8, 0xff);
    case 'WEBP': return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'XLS':
    case 'DOC': return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    case 'XLSX':
    case 'DOCX': return startsWith(0x50, 0x4b, 0x03, 0x04);
    case 'CSV':
    case 'OTHER':
      try {
        return !buffer.includes(0) && new TextDecoder('utf-8', { fatal: true }).decode(buffer).length > 0;
      } catch {
        return false;
      }
    default: return false;
  }
}
// --- In-Memory Fallback ---
let fallbackDocuments = [
  {
    id: 'doc-101',
    client_id: '11111111-1111-1111-1111-111111111111',
    client_name: 'Reliable Motors Pvt Ltd',
    file_name: 'GST_Invoice_Sep_2026.pdf',
    file_type: 'PDF', file_size_kb: 420,
    category: 'GST', source: 'WhatsApp', status: 'Extracted',
    assessment_year: '2026-27', confidence_score: 96,
    extracted_data: {
      invoice_number: 'INV-2026-889', vendor_name: 'Mahindra Auto Parts',
      vendor_gstin: '27AAACM1122K1Z9', taxable_value: 450000,
      gst_amount: 81000, total_amount: 531000, invoice_date: '2026-09-28'
    },
    created_at: '2026-10-08T10:30:00Z'
  }
];

function getCloudObject(document, userId) {
  if (!document.storage_bucket || !document.storage_object_path) return null;
  return isOwnedDocumentObject({
    bucket: document.storage_bucket,
    objectKey: document.storage_object_path,
    userId,
    clientId: document.client_id,
    documentId: document.id
  }) ? {
    bucket: document.storage_bucket,
    objectKey: document.storage_object_path,
    mimeType: normalizeMimeType(document.mime_type)
  } : null;
}

router.get('/search', async (req, res) => {
  try {
    const queryText = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (queryText.length < 2 || queryText.length > 100) {
      return res.status(400).json({ success: false, message: 'Search text must be between 2 and 100 characters.' });
    }
    if (!isConnected || !supabase) {
      return res.json({ success: true, source: 'demo', data: [] });
    }

    const ownedClientIds = await getOwnedClientIds(req.user.id);
    if (!ownedClientIds.length) return res.json({ success: true, source: 'supabase', data: [] });
    const { data, error } = await supabase.from('documents_metadata')
      .select('id, client_id, client_name, file_name, file_size_kb, created_at')
      .in('client_id', ownedClientIds)
      .is('deletion_requested_at', null)
      .neq('source', 'Telegram')
      .ilike('file_name', `%${queryText.replace(/[%_]/g, '\\$&')}%`)
      .order('created_at', { ascending: false })
      .limit(12);
    if (error) throw error;

    return res.json({
      success: true,
      source: 'supabase',
      data: (data || []).map(document => ({
        documentId: document.id,
        clientId: document.client_id,
        clientName: document.client_name || 'Client',
        fileName: document.file_name,
        size: Math.max(0, Math.round(Number(document.file_size_kb || 0) * 1024)),
        modifiedAt: document.created_at
      }))
    });
  } catch (error) {
    console.error('[Documents] Cloud filename search failed:', error);
    return res.status(500).json({ success: false, message: 'Cloud documents could not be searched.' });
  }
});

// GET /api/v1/documents — List documents (optional ?clientId= filter)
router.get('/', async (req, res) => {
  try {
    if (isConnected && supabase) {
      const ownedClientIds = await getOwnedClientIds(req.user.id);
      let query = supabase.from('documents_metadata').select('*')
        .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
        .is('deletion_requested_at', null)
        .neq('source', 'Telegram')
        .order('created_at', { ascending: false });
      if (req.query.clientId) query = query.eq('client_id', req.query.clientId);
      if (req.query.status) query = query.eq('status', req.query.status);
      if (req.query.category) query = query.eq('category', req.query.category);
      const { data, error } = await query;
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data });
    }
    let docs = fallbackDocuments;
    if (req.query.clientId) docs = docs.filter(d => d.client_id === req.query.clientId);
    res.json({ success: true, count: docs.length, source: 'demo', data: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/documents/:id — Get single document metadata
router.get('/:id', async (req, res) => {
  try {
    if (isConnected) {
      const ownedClientIds = await getOwnedClientIds(req.user.id);
      const { data, error } = await supabase
        .from('documents_metadata').select('*').eq('id', req.params.id)
        .is('deletion_requested_at', null)
        .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000']).single();
      if (error) throw error;
      if (data.source === 'Telegram') return res.status(404).json({ success: false, message: 'Document not found' });
      return res.json({ success: true, source: 'supabase', data });
    }
    const doc = fallbackDocuments.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    res.json({ success: true, source: 'demo', data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/documents
 * Upload a file to private Supabase Storage and save its metadata.
 * Body: { clientId, clientName, fileName, fileType, category, fileBase64, source, assessmentYear }
 */
router.post('/', async (req, res) => {
  let uploadedObject = null;
  let reservationId = null;
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Cloud document storage is unavailable. Check the Supabase backend configuration and try again.' });
    }
    const { clientId, fileName, fileType, category, fileBase64, source, assessmentYear } = req.body || {};
    if (typeof clientId !== 'string' || typeof fileName !== 'string' || !fileName.trim()) {
      return res.status(400).json({ success: false, message: 'clientId and fileName are required.' });
    }
    if (typeof fileBase64 !== 'string' || !fileBase64.trim()) {
      return res.status(400).json({ success: false, message: 'A file is required for cloud upload.' });
    }
    if (source !== 'Manual' && source !== 'Upload') {
      return res.status(400).json({ success: false, message: 'Document source is invalid.' });
    }

    if (!(await assertOwnedClient(req.user.id, clientId))) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }

    const { data: client, error: clientError } = await supabase.from('clients')
      .select('id, name')
      .eq('id', clientId)
      .eq('user_id', req.user.id)
      .single();
    if (clientError) throw clientError;

    const bucket = getStorageBucket();
    if (!bucket) {
      return res.status(503).json({ success: false, message: 'Cloud document storage is not configured. Set SUPABASE_STORAGE_BUCKET on the backend.' });
    }
    const encodedContent = fileBase64.replace(/^data:[^;,]+;base64,/i, '').trim();
    const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
    if (encodedContent.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4) {
      return res.status(413).json({ success: false, message: 'Files must be 20 MB or smaller.' });
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedContent)) {
      return res.status(400).json({ success: false, message: 'The uploaded file is not valid base64 data.' });
    }
    const buffer = Buffer.from(encodedContent, 'base64');
    if (!buffer.length || buffer.toString('base64') !== encodedContent) {
      return res.status(400).json({ success: false, message: 'The uploaded file is empty or invalid.' });
    }
    if (buffer.length > MAX_DOCUMENT_BYTES) {
      return res.status(413).json({ success: false, message: 'Files must be 20 MB or smaller.' });
    }

    const normalizedCategory = typeof category === 'string' ? category.trim() : '';
    const allowedCategories = new Set(['GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'Audit', 'General', 'Extracted']);
    if (!allowedCategories.has(normalizedCategory)) {
      return res.status(400).json({ success: false, message: 'Document category is invalid.' });
    }
    const normalizedSource = source;
    const createdAt = new Date();
    const documentId = crypto.randomUUID();
    const normalizedFileName = sanitizeStorageFileName(fileName);
    if (!normalizedFileName) return res.status(400).json({ success: false, message: 'A valid file name is required.' });
    const fileTypeName = normalizeFileType(fileType, normalizedFileName);
    if (!fileTypeName) return res.status(400).json({ success: false, message: 'This file type is not supported or does not match its file name.' });
    if (!matchesFileSignature(fileTypeName, buffer)) {
      return res.status(400).json({ success: false, message: 'The file content does not match its extension or supported format.' });
    }
    const mimeTypes = {
      PDF: 'application/pdf', PNG: 'image/png', JPG: 'image/jpeg', JPEG: 'image/jpeg',
      WEBP: 'image/webp', CSV: 'text/csv', XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      XLS: 'application/vnd.ms-excel', DOC: 'application/msword',
      DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', OTHER: 'text/plain'
    };
    const mimeType = normalizeMimeType(mimeTypes[fileTypeName]);
    const objectKey = getStorageObjectKey({
      userId: req.user.id,
      clientId,
      year: String(createdAt.getUTCFullYear()),
      month: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(createdAt),
      category: normalizedCategory,
      documentId,
      fileName: normalizedFileName
    });
    const { data: reservation, error: reservationError } = await supabase.rpc('begin_document_upload', {
      p_user_id: req.user.id,
      p_client_id: clientId,
      p_document_id: documentId,
      p_created_by: req.user.id
    });
    if (reservationError) throw reservationError;
    reservationId = reservation;
    uploadedObject = await uploadDocument(objectKey, buffer, mimeType);
    const docMeta = {
      id: documentId,
      client_id: clientId,
      client_name: client.name,
      file_name: normalizedFileName,
      file_type: fileTypeName,
      file_size_kb: Number((buffer.length / 1024).toFixed(2)),
      category: normalizedCategory,
      source: normalizedSource,
      status: 'Pending',
      storage_bucket: uploadedObject.bucket,
      storage_object_path: uploadedObject.objectKey,
      file_sha256: sha256(buffer),
      mime_type: mimeType,
      assessment_year: typeof assessmentYear === 'string' ? assessmentYear.slice(0, 10) : '2026-27',
      created_at: createdAt.toISOString()
    };
    const { data, error } = await supabase.rpc('create_document_metadata_if_client_active', {
      p_user_id: req.user.id,
      p_reservation_id: reservationId,
      p_document: docMeta
    });
    if (error || !data) throw error || new Error('Document metadata was not saved.');
    reservationId = null;
    try {
      const { error: rpcError } = await supabase.rpc('increment_client_docs', { cid: clientId });
      if (rpcError) throw rpcError;
    } catch (rpcError) {
      console.warn('[Documents] Could not increment client document count:', rpcError.message);
    }
    return res.status(201).json({ success: true, source: 'supabase', message: 'File uploaded securely to private cloud storage.', data: Array.isArray(data) ? data[0] : data });
  } catch (err) {
    if (uploadedObject && supabase) {
      try {
        const { error: cleanupError } = await supabase.storage.from(uploadedObject.bucket).remove([uploadedObject.objectKey]);
        if (cleanupError) throw cleanupError;
      } catch (cleanupError) {
        console.error('[Documents] Upload rollback failed; an unindexed cloud object may remain:', cleanupError.message);
      }
    }
    if (reservationId) {
      try {
        const { error: releaseError } = await supabase.rpc('release_document_upload', {
          p_user_id: req.user.id,
          p_reservation_id: reservationId
        });
        if (releaseError) throw releaseError;
      } catch (releaseError) {
        console.error('[Documents] Failed to release upload reservation:', releaseError.message);
      }
    }
    console.error('[Documents] Cloud upload error:', err.message);
    const status = err.status === 503 ? 503 : 500;
    return res.status(status).json({
      success: false,
      message: status === 503 ? err.message : 'The file could not be saved securely. Please try again.'
    });
  }
});

/**
 * GET /api/v1/documents/:id/file
 * Stream a document from private Supabase Storage.
 */
router.get('/:id/versions', async (req, res) => {
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Cloud document storage is unavailable.' });
    }
    const ownedClientIds = await getOwnedClientIds(req.user.id);
    const { data: document, error: documentError } = await supabase.from('documents_metadata')
      .select('id, client_id, source')
      .eq('id', req.params.id)
      .is('deletion_requested_at', null)
      .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
      .maybeSingle();
    if (documentError) throw documentError;
    if (!document || document.source === 'Telegram') return res.status(404).json({ success: false, message: 'Document not found.' });

    const { data: versions, error } = await supabase.from('document_versions')
      .select('id, version_number, storage_bucket, storage_object_path, file_name, file_type, file_size_kb, mime_type, created_at')
      .eq('document_id', document.id)
      .order('version_number', { ascending: false });
    if (error) throw error;
    const safeVersions = (versions || []).filter(version => {
      const valid = isOwnedDocumentObject({
        bucket: version.storage_bucket,
        objectKey: version.storage_object_path,
        userId: req.user.id,
        clientId: document.client_id,
        documentId: document.id
      });
      if (!valid) console.error(`[Documents] Hiding invalid version ${version.id} for document ${document.id}.`);
      return valid;
    }).map(({ storage_bucket, storage_object_path, ...version }) => version);
    return res.json({ success: true, source: 'supabase', data: safeVersions });
  } catch (error) {
    console.error(`[Documents] Version history failed for ${req.params.id}:`, error.message);
    return res.status(500).json({ success: false, message: 'Document versions could not be loaded.' });
  }
});

router.post('/:id/versions', async (req, res) => {
  let uploadedObject = null;
  let reservationId = null;
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Cloud document storage is unavailable.' });
    }
    const ownedClientIds = await getOwnedClientIds(req.user.id);
    const { data: document, error: lookupError } = await supabase.from('documents_metadata')
      .select('id, client_id, category, source, storage_bucket, storage_object_path, file_name, file_type, vault_path, created_at, deletion_requested_at')
      .eq('id', req.params.id)
      .is('deletion_requested_at', null)
      .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!document || document.source === 'Telegram') return res.status(404).json({ success: false, message: 'Document not found.' });
    if (document.vault_path) return res.status(409).json({ success: false, message: 'Migrate this document to private cloud storage before replacing it.' });
    const currentObject = getCloudObject(document, req.user.id);
    if (!currentObject) return res.status(409).json({ success: false, message: 'This document does not have a valid private cloud file.' });

    const { fileName, fileType, fileBase64 } = req.body || {};
    if (typeof fileName !== 'string' || !fileName.trim() || typeof fileBase64 !== 'string' || !fileBase64.trim()) {
      return res.status(400).json({ success: false, message: 'A replacement file and file name are required.' });
    }
    const encodedContent = fileBase64.replace(/^data:[^;,]+;base64,/i, '').trim();
    const maxDocumentBytes = 20 * 1024 * 1024;
    if (encodedContent.length > Math.ceil(maxDocumentBytes / 3) * 4) {
      return res.status(413).json({ success: false, message: 'Files must be 20 MB or smaller.' });
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedContent)) {
      return res.status(400).json({ success: false, message: 'The replacement file is not valid base64 data.' });
    }
    const buffer = Buffer.from(encodedContent, 'base64');
    if (!buffer.length || buffer.toString('base64') !== encodedContent) {
      return res.status(400).json({ success: false, message: 'The replacement file is empty or invalid.' });
    }
    if (buffer.length > maxDocumentBytes) return res.status(413).json({ success: false, message: 'Files must be 20 MB or smaller.' });

    const normalizedFileName = sanitizeStorageFileName(fileName);
    const normalizedFileType = normalizeFileType(fileType, normalizedFileName);
    if (!normalizedFileType || !matchesFileSignature(normalizedFileType, buffer)) {
      return res.status(400).json({ success: false, message: 'The replacement file content does not match its supported file type.' });
    }
    const mimeTypes = {
      PDF: 'application/pdf', PNG: 'image/png', JPG: 'image/jpeg', JPEG: 'image/jpeg',
      WEBP: 'image/webp', CSV: 'text/csv', XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      XLS: 'application/vnd.ms-excel', DOC: 'application/msword',
      DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', OTHER: 'text/plain'
    };
    const mimeType = normalizeMimeType(mimeTypes[normalizedFileType]);
    const versionId = crypto.randomUUID();
    const objectKey = getVersionStorageObjectKey({
      userId: req.user.id,
      clientId: document.client_id,
      documentId: document.id,
      versionId,
      fileName: normalizedFileName
    });
    const { data: reservation, error: reservationError } = await supabase.rpc('begin_document_upload', {
      p_user_id: req.user.id,
      p_client_id: document.client_id,
      p_document_id: document.id,
      p_created_by: req.user.id
    });
    if (reservationError) throw reservationError;
    reservationId = reservation;
    uploadedObject = await uploadDocument(objectKey, buffer, mimeType);
    const { data: version, error: versionError } = await supabase.rpc('register_document_version', {
      p_user_id: req.user.id,
      p_reservation_id: reservationId,
      p_document_id: document.id,
      p_storage_bucket: uploadedObject.bucket,
      p_storage_object_path: uploadedObject.objectKey,
      p_file_name: normalizedFileName,
      p_file_type: normalizedFileType,
      p_file_size_kb: Number((buffer.length / 1024).toFixed(2)),
      p_file_sha256: sha256(buffer),
      p_mime_type: mimeType
    });
    if (versionError || !version) throw versionError || new Error('The replacement version was not saved.');
    reservationId = null;
    return res.status(201).json({ success: true, source: 'supabase', data: Array.isArray(version) ? version[0] : version });
  } catch (error) {
    if (uploadedObject) {
      try {
        await deleteDocument(uploadedObject.bucket, uploadedObject.objectKey);
      } catch (cleanupError) {
        console.error(`[Documents] Replacement upload rollback failed for ${req.params.id}:`, cleanupError.message);
      }
    }
    if (reservationId) {
      try {
        const { error: releaseError } = await supabase.rpc('release_document_upload', {
          p_user_id: req.user.id,
          p_reservation_id: reservationId
        });
        if (releaseError) throw releaseError;
      } catch (releaseError) {
        console.error(`[Documents] Failed to release replacement reservation:`, releaseError.message);
      }
    }
    console.error(`[Documents] Replacement upload failed for ${req.params.id}:`, error.message);
    return res.status(error.code === 'P0002' ? 409 : error.status || 500).json({
      success: false,
      message: error.code === 'P0002' ? 'This document or client is being deleted. The replacement was not saved.' : 'The replacement file could not be saved securely.'
    });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!isConnected || !supabase) return res.status(503).json({ success: false, message: 'Cloud document storage is unavailable.' });
    const { fileName, category, assessmentYear } = req.body || {};
    const allowedCategories = new Set(['GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'Audit', 'General', 'Extracted', 'Generated']);
    if (fileName !== undefined && (typeof fileName !== 'string' || !fileName.trim())) {
      return res.status(400).json({ success: false, message: 'A valid file name is required.' });
    }
    if (category !== undefined && !allowedCategories.has(category)) {
      return res.status(400).json({ success: false, message: 'Document category is invalid.' });
    }
    if (assessmentYear !== undefined && (typeof assessmentYear !== 'string' || !/^\d{4}(?:-\d{2})?$/.test(assessmentYear))) {
      return res.status(400).json({ success: false, message: 'Assessment year must use YYYY or YYYY-YY format.' });
    }
    const ownedClientIds = await getOwnedClientIds(req.user.id);
    const { data: document, error: lookupError } = await supabase.from('documents_metadata')
      .select('id, client_id, source, storage_bucket, storage_object_path, file_type, vault_path')
      .eq('id', req.params.id)
      .is('deletion_requested_at', null)
      .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!document || document.source === 'Telegram') return res.status(404).json({ success: false, message: 'Document not found.' });
    if (document.vault_path || !getCloudObject(document, req.user.id)) return res.status(409).json({ success: false, message: 'Migrate this document to private cloud storage before editing its details.' });

    const updates = { updated_at: new Date().toISOString() };
    if (fileName !== undefined) {
      const normalizedFileName = sanitizeStorageFileName(fileName);
      if (normalizeFileType(document.file_type, normalizedFileName) !== document.file_type) {
        return res.status(400).json({ success: false, message: 'Keep the original file extension when changing its name.' });
      }
      updates.file_name = normalizedFileName;
    }
    if (category !== undefined) updates.category = category;
    if (assessmentYear !== undefined) updates.assessment_year = assessmentYear;
    const { data, error } = await supabase.from('documents_metadata').update(updates)
      .eq('id', document.id)
      .eq('client_id', document.client_id)
      .is('deletion_requested_at', null)
      .select('id, file_name, file_type, file_size_kb, category, assessment_year, created_at, updated_at')
      .single();
    if (error) throw error;
    return res.json({ success: true, source: 'supabase', data });
  } catch (error) {
    console.error(`[Documents] Metadata update failed for ${req.params.id}:`, error.message);
    return res.status(error.code === 'P0002' ? 409 : 500).json({
      success: false,
      message: error.code === 'P0002' ? 'This document is being deleted and can no longer be edited.' : 'Document details could not be updated.'
    });
  }
});

router.get('/:id/versions/:versionId/file', async (req, res) => {
  try {
    if (!isConnected || !supabase) return res.status(503).json({ success: false, message: 'Cloud document storage is unavailable.' });
    const ownedClientIds = await getOwnedClientIds(req.user.id);
    const { data: document, error: documentError } = await supabase.from('documents_metadata')
      .select('id, client_id, source')
      .eq('id', req.params.id)
      .is('deletion_requested_at', null)
      .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
      .maybeSingle();
    if (documentError) throw documentError;
    if (!document || document.source === 'Telegram') return res.status(404).json({ success: false, message: 'Document version not found.' });

    const { data: version, error: versionError } = await supabase.from('document_versions')
      .select('id, document_id, storage_bucket, storage_object_path, mime_type')
      .eq('id', req.params.versionId)
      .eq('document_id', document.id)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version || !isOwnedDocumentObject({
      bucket: version.storage_bucket,
      objectKey: version.storage_object_path,
      userId: req.user.id,
      clientId: document.client_id,
      documentId: document.id
    })) return res.status(404).json({ success: false, message: 'Document version not found.' });

    const buffer = await downloadDocument(version.storage_bucket, version.storage_object_path);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', normalizeMimeType(version.mime_type));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment');
    return res.send(buffer);
  } catch (error) {
    console.error(`[Documents] Version download failed for ${req.params.id}:`, error.message);
    return res.status(500).json({ success: false, message: 'The document version could not be downloaded.' });
  }
});

router.get('/:id/file', async (req, res) => {
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Cloud document storage is unavailable.' });
    }
    const ownedClientIds = await getOwnedClientIds(req.user.id);
    const { data: document, error } = await supabase
        .from('documents_metadata')
        .select('id, client_id, source, created_at, file_name, category, storage_bucket, storage_object_path, mime_type')
        .eq('id', req.params.id)
        .is('deletion_requested_at', null)
        .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
        .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Document not found.' });
      throw error;
    }
    if (document.source === 'Telegram') {
      return res.status(404).json({ success: false, message: 'Telegram files are not available. Use the secure client portal for document uploads.' });
    }
    const storageObject = getCloudObject(document, req.user.id);
    if (!storageObject) {
      return res.status(409).json({ success: false, message: 'This document has not been migrated to private cloud storage yet.' });
    }
    const buffer = await downloadDocument(storageObject.bucket, storageObject.objectKey);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', storageObject.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment');
    return res.send(buffer);
  } catch (err) {
    console.error(`[Documents] Cloud download failed for ${req.params.id}:`, err.message);
    return res.status(500).json({ success: false, message: 'The cloud document could not be downloaded.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Cloud document storage is unavailable.' });
    }
    const ownedClientIds = await getOwnedClientIds(req.user.id);
    const { data: document, error: lookupError } = await supabase.from('documents_metadata')
      .select('id, client_id, source, storage_bucket, storage_object_path, vault_path, deletion_requested_at')
      .eq('id', req.params.id)
      .is('deletion_requested_at', null)
      .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
      .maybeSingle();
    if (lookupError) {
      if (lookupError.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Document not found.' });
      throw lookupError;
    }
    if (!document || document.source === 'Telegram') {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (document.vault_path) {
      return res.status(409).json({ success: false, message: 'This legacy document must be migrated to cloud storage before it can be deleted.' });
    }
    if (document.storage_bucket && document.storage_object_path && !getCloudObject(document, req.user.id)) {
      return res.status(409).json({ success: false, message: 'The cloud document reference is invalid. No document was deleted.' });
    }
    const { data: versions, error: versionsError } = await supabase.from('document_versions')
      .select('storage_bucket, storage_object_path')
      .eq('document_id', document.id);
    if (versionsError) throw versionsError;
    for (const version of versions || []) {
      if (!isOwnedDocumentObject({
        bucket: version.storage_bucket,
        objectKey: version.storage_object_path,
        userId: req.user.id,
        clientId: document.client_id,
        documentId: document.id
      })) {
        return res.status(409).json({ success: false, message: 'A document version has an invalid cloud reference. No document was deleted.' });
      }
    }

    const bucket = getStorageBucket();
    if (!bucket) return res.status(503).json({ success: false, message: 'Cloud document storage is not configured.' });
    const { data: jobId, error: requestError } = await supabase.rpc('request_document_deletion', {
      p_user_id: req.user.id,
      p_document_id: document.id,
      p_storage_bucket: bucket
    });
    if (requestError) throw requestError;
    return res.status(202).json({
      success: true,
      source: 'supabase',
      message: 'Document deletion was queued. The file and its versions will be removed after cloud cleanup is confirmed.',
      data: { id: document.id, deletionJobId: jobId, deletionStatus: 'pending' }
    });
  } catch (error) {
    console.error(`[Documents] Cloud deletion failed for ${req.params.id}:`, error.message);
    return res.status(error.code === 'P0002' ? 409 : 500).json({
      success: false,
      message: error.code === 'P0002' ? 'This document or client is already being deleted.' : 'The document could not be queued for secure deletion.'
    });
  }
});

/**
 * POST /api/v1/documents/:id/verify
 * Mark a document's AI-extracted data as CA-verified
 */
router.post('/:id/verify', async (req, res) => {
  try {
    const { verifiedBy, correctedData } = req.body;

    if (isConnected && supabase) {
      const ownedClientIds = await getOwnedClientIds(req.user.id);
      const { data: document, error: documentError } = await supabase.from('documents_metadata')
        .select('id, client_id, category, source')
        .eq('id', req.params.id)
        .is('deletion_requested_at', null)
        .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document || document.source === 'Telegram') {
        return res.status(404).json({ success: false, message: 'Document not found.' });
      }
      if (document.category === 'GST') {
        return res.status(409).json({
          success: false,
          message: 'GST invoices must be approved through the invoice review workflow.'
        });
      }
      if (correctedData !== undefined) {
        try {
          validateExtractionData(correctedData, document.category);
        } catch (validationError) {
          return res.status(400).json({ success: false, message: validationError.message });
        }
      }
      const updatePayload = {
        status: 'Verified',
        verified_by: req.user.email || req.user.id || verifiedBy || 'CA Admin',
        verified_at: new Date().toISOString()
      };
      if (correctedData) updatePayload.extracted_data = correctedData;

      const { data, error } = await supabase
        .from('documents_metadata').update(updatePayload).eq('id', document.id).eq('client_id', document.client_id).select().single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }

    const doc = fallbackDocuments.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    doc.status = 'Verified';
    doc.verified_by = verifiedBy || 'CA Admin';
    doc.verified_at = new Date().toISOString();
    res.json({ success: true, source: 'demo', data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/documents/:id/reject
 * Reject a document's extraction (mark for re-upload)
 */
router.post('/:id/reject', async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length > 1000) {
      return res.status(400).json({ success: false, message: 'Rejection reason must be 1,000 characters or fewer.' });
    }
    if (isConnected && supabase) {
      const ownedClientIds = await getOwnedClientIds(req.user.id);
      const { data: document, error: documentError } = await supabase
        .from('documents_metadata')
        .select('id, client_id, source')
        .eq('id', req.params.id)
        .is('deletion_requested_at', null)
        .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document || document.source === 'Telegram') {
        return res.status(404).json({ success: false, message: 'Document not found.' });
      }

      const { data, error } = await supabase
        .from('documents_metadata')
        .update({ status: 'Rejected', verified_by: reason || 'Quality check failed' })
        .eq('id', document.id)
        .eq('client_id', document.client_id)
        .is('deletion_requested_at', null)
        .select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, message: 'Document not found.' });
      return res.json({ success: true, source: 'supabase', data });
    }
    const doc = fallbackDocuments.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found.' });
    doc.status = 'Rejected';
    doc.verified_by = reason || 'Quality check failed';
    doc.reject_reason = reason || 'Quality check failed';
    return res.json({ success: true, source: 'demo', data: doc });
  } catch (err) {
    console.error(`[Documents] Reject failed for ${req.params.id}:`, err.message);
    res.status(500).json({ success: false, message: 'Could not reject this document. Please try again.' });
  }
});

module.exports = router;
module.exports.fallbackDocuments = fallbackDocuments;
