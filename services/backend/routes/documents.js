/**
 * TaxFlow.AI — Cloud document routes
 */

const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { supabase, isConnected } = require('../db/supabase');
const { getOwnedClientIds, assertOwnedClient } = require('../lib/ownership');
const {
  deleteDocument,
  downloadDocument,
  getStorageBucket,
  getStorageObjectKey,
  isExpectedDocumentObject,
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
  return isExpectedDocumentObject({
    bucket: document.storage_bucket,
    objectKey: document.storage_object_path,
    userId,
    clientId: document.client_id,
    documentId: document.id,
    createdAt: document.created_at,
    fileName: document.file_name,
    category: document.category
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
    const { data, error } = await supabase.from('documents_metadata').insert(docMeta).select().single();
    if (error) throw error;
    try {
      const { error: rpcError } = await supabase.rpc('increment_client_docs', { cid: clientId });
      if (rpcError) throw rpcError;
    } catch (rpcError) {
      console.warn('[Documents] Could not increment client document count:', rpcError.message);
    }
    return res.status(201).json({ success: true, source: 'supabase', message: 'File uploaded securely to private cloud storage.', data });
  } catch (err) {
    if (uploadedObject && supabase) {
      const { error: cleanupError } = await supabase.storage.from(uploadedObject.bucket).remove([uploadedObject.objectKey]);
      if (cleanupError) {
        console.error('[Documents] Upload rollback failed; an unindexed cloud object may remain:', cleanupError.message);
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
      .select('id, client_id, source, created_at, file_name, category, storage_bucket, storage_object_path, vault_path')
      .eq('id', req.params.id)
      .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
      .single();
    if (lookupError) {
      if (lookupError.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Document not found.' });
      throw lookupError;
    }
    if (document.source === 'Telegram') {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (document.storage_bucket && document.storage_object_path) {
      const storageObject = getCloudObject(document, req.user.id);
      if (!storageObject) {
        return res.status(404).json({ success: false, message: 'The cloud document reference is invalid.' });
      }
      await deleteDocument(storageObject.bucket, storageObject.objectKey);
    } else if (document.vault_path) {
      return res.status(409).json({ success: false, message: 'This legacy document must be migrated to cloud storage before it can be deleted.' });
    }
    const { error: deleteError } = await supabase.from('documents_metadata').delete()
      .eq('id', document.id)
      .eq('client_id', document.client_id);
    if (deleteError) throw deleteError;
    return res.json({ success: true, source: 'supabase', data: { id: document.id } });
  } catch (error) {
    console.error(`[Documents] Cloud deletion failed for ${req.params.id}:`, error.message);
    return res.status(500).json({ success: false, message: 'The document could not be deleted securely. Please retry.' });
  }
});

/**
 * POST /api/v1/documents/:id/verify
 * Mark a document's AI-extracted data as CA-verified
 */
router.post('/:id/verify', async (req, res) => {
  try {
    const { verifiedBy, correctedData } = req.body;

    if (isConnected) {
      const updatePayload = {
        status: 'Verified',
        verified_by: verifiedBy || 'CA Admin',
        verified_at: new Date().toISOString()
      };
      if (correctedData) updatePayload.extracted_data = correctedData;

      const { data, error } = await supabase
        .from('documents_metadata').update(updatePayload).eq('id', req.params.id).in('client_id', (await getOwnedClientIds(req.user.id)).length ? await getOwnedClientIds(req.user.id) : ['00000000-0000-0000-0000-000000000000']).select().single();
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
    const { reason } = req.body;
    if (isConnected) {
      const { data, error } = await supabase
        .from('documents_metadata')
        .update({ status: 'Rejected', verified_by: reason || 'Quality check failed' })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }
    const doc = fallbackDocuments.find(d => d.id === req.params.id);
    if (doc) { doc.status = 'Rejected'; doc.reject_reason = reason; }
    res.json({ success: true, source: 'demo', data: doc || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
module.exports.fallbackDocuments = fallbackDocuments;
