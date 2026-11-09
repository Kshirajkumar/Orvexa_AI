/**
 * TaxFlow.AI — Clients Routes
 * Supabase stores client metadata; private Storage holds their documents.
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { createClientPortalInvite, getClientPortalInvitationLink, revokeClientPortalInvites } = require('../lib/clientPortalInvites');
const telegramRouter = require('./telegram');
const { isExpectedDocumentObject } = require('../lib/documentStorage');

function addCloudDocumentToTree(entries, document) {
  const createdAt = new Date(document.created_at);
  if (Number.isNaN(createdAt.getTime())) throw new Error(`Cloud document ${document.id} has an invalid creation date.`);
  const year = String(createdAt.getUTCFullYear());
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(createdAt);
  let yearEntry = entries.find(entry => entry.type === 'folder' && entry.name === year);
  if (!yearEntry) {
    yearEntry = { name: year, type: 'folder', modifiedAt: document.created_at, children: [] };
    entries.push(yearEntry);
  }
  let monthEntry = yearEntry.children.find(entry => entry.type === 'folder' && entry.name === month);
  if (!monthEntry) {
    monthEntry = { name: month, type: 'folder', modifiedAt: document.created_at, children: [] };
    yearEntry.children.push(monthEntry);
  }
  const folderName = document.category === 'Generated' ? 'Generated' : document.category === 'Extracted' ? 'Extracted' : 'Raw';
  let documentFolder = monthEntry.children.find(entry => entry.type === 'folder' && entry.name === folderName);
  if (!documentFolder) {
    documentFolder = { name: folderName, type: 'folder', modifiedAt: document.created_at, children: [] };
    monthEntry.children.push(documentFolder);
  }
  if (!documentFolder.children.some(entry => entry.type === 'file' && entry.documentId === document.id)) {
    documentFolder.children.push({
      name: document.file_name,
      type: 'file',
      documentId: document.id,
      size: Math.max(0, Math.round(Number(document.file_size_kb || 0) * 1024)),
      modifiedAt: document.created_at
    });
  }
}

function addClientFoldersToTree(entries, createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new Error('Client creation date is invalid.');
  const year = String(date.getUTCFullYear());
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date);
  let yearEntry = entries.find(entry => entry.type === 'folder' && entry.name === year);
  if (!yearEntry) {
    yearEntry = { name: year, type: 'folder', modifiedAt: date.toISOString(), children: [] };
    entries.push(yearEntry);
  }
  let monthEntry = yearEntry.children.find(entry => entry.type === 'folder' && entry.name === month);
  if (!monthEntry) {
    monthEntry = { name: month, type: 'folder', modifiedAt: date.toISOString(), children: [] };
    yearEntry.children.push(monthEntry);
  }
  for (const name of ['Raw', 'Extracted']) {
    if (!monthEntry.children.some(entry => entry.type === 'folder' && entry.name === name)) {
      monthEntry.children.push({ name, type: 'folder', modifiedAt: date.toISOString(), children: [] });
    }
  }
}

async function removeClientCloudDocuments(userId, clientId) {
  const { data: documents, error } = await supabase.from('documents_metadata')
    .select('id, client_id, source, created_at, file_name, category, storage_bucket, storage_object_path, vault_path')
    .eq('client_id', clientId)
    .neq('source', 'Telegram');
  if (error) throw error;

  const cloudObjects = [];
  for (const document of documents || []) {
    if (document.storage_bucket && document.storage_object_path) {
      if (!isExpectedDocumentObject({
        bucket: document.storage_bucket,
        objectKey: document.storage_object_path,
        userId,
        clientId,
        documentId: document.id,
        createdAt: document.created_at,
        fileName: document.file_name,
        category: document.category
      })) {
        throw new Error(`Document ${document.id} has an invalid cloud storage reference. No client data was deleted.`);
      }
      cloudObjects.push(document);
    } else if (document.vault_path) {
      const error = new Error('Some client files have not been migrated to cloud storage. Migrate them before deleting this client.');
      error.status = 409;
      throw error;
    }
  }

  for (const document of cloudObjects) {
    const { error: storageError } = await supabase.storage
      .from(document.storage_bucket)
      .remove([document.storage_object_path]);
    if (storageError) throw new Error(`Could not remove cloud document ${document.id}: ${storageError.message}`);
  }
}
// --- In-Memory Fallback Data (used when Supabase is not connected) ---
let fallbackClients = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Reliable Motors Pvt Ltd', entity_type: 'Pvt Ltd',
    pan: 'AACCR1234F', gstin: '27AACCR1234F1Z5',
    phone: '+919820011223', email: 'accounts@reliablemotors.com',
    status: 'Active', assigned_ca: 'CA Rajesh Kumar',
    filing_status: 'Pending (GSTR-3B)', total_docs: 3, total_ai_calls: 7,
    created_at: '2026-09-01T10:00:00Z'
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Dr. Ananya Roy', entity_type: 'Individual',
    pan: 'APCPR5678K', gstin: null,
    phone: '+919930044556', email: 'ananya.roy@medclinic.in',
    status: 'Active', assigned_ca: 'CA Priya Sharma',
    filing_status: 'Docs Collected', total_docs: 2, total_ai_calls: 3,
    created_at: '2026-09-05T09:00:00Z'
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Apex Logistics LLP', entity_type: 'LLP',
    pan: 'ABBFA9876M', gstin: '27ABBFA9876M1Z2',
    phone: '+919819988776', email: 'finance@apexlogistics.in',
    status: 'Active', assigned_ca: 'CA Rajesh Kumar',
    filing_status: 'Filed (Q2)', total_docs: 5, total_ai_calls: 12,
    created_at: '2026-09-10T11:00:00Z'
  }
];

const CLIENT_CACHE_LIMIT = 100;
const clientsCache = new Map();
const clientsCacheVersions = new Map();

function invalidateClientsCache(userId) {
  clientsCache.delete(userId);
  clientsCacheVersions.set(userId, (clientsCacheVersions.get(userId) || 0) + 1);
}

function storeClientsCache(userId, clients) {
  if (!clientsCache.has(userId) && clientsCache.size >= CLIENT_CACHE_LIMIT) {
    clientsCache.delete(clientsCache.keys().next().value);
  }
  clientsCache.delete(userId);
  clientsCache.set(userId, clients);
}

// GET /api/v1/clients — List all clients
router.get('/', async (req, res) => {
  try {
    if (isConnected) {
      const userId = req.user.id;
      const cachedClients = clientsCache.get(userId);
      if (cachedClients) {
        return res.json({ success: true, count: cachedClients.length, source: 'supabase', data: cachedClients });
      }
      let cacheVersion;
      let data;
      do {
        cacheVersion = clientsCacheVersions.get(userId) || 0;
        const result = await supabase
          .from('clients')
          .select('*, supported_countries(country_name,currency_code)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (result.error) throw result.error;
        data = result.data;
      } while ((clientsCacheVersions.get(userId) || 0) !== cacheVersion);
      const clients = data.map(client => ({ ...client, country_name: client.supported_countries?.country_name, currency_code: client.supported_countries?.currency_code }));
      storeClientsCache(userId, clients);
      clientsCacheVersions.delete(userId);
      return res.json({ success: true, count: clients.length, source: 'supabase', data: clients });
    }
    res.json({ success: true, count: fallbackClients.length, source: 'demo', data: fallbackClients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/clients/:id — Get single client
router.get('/:id', async (req, res) => {
  try {
    if (isConnected) {
      const { data, error } = await supabase
        .from('clients').select('*, supported_countries(country_name,currency_code)').eq('id', req.params.id).eq('user_id', req.user.id).single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data: { ...data, country_name: data.supported_countries?.country_name, currency_code: data.supported_countries?.currency_code } });
    }
    const client = fallbackClients.find(c => c.id === req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, source: 'demo', data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/clients — Create new client
router.post('/', async (req, res) => {
  try {
    const { name, entity_type, pan, gstin, phone, email, filing_type, filing_types, country_id, gstin_registered, notes } = req.body;

    if (!name || !entity_type || !country_id) {
      return res.status(400).json({ success: false, message: 'name, entity_type, and country_id are required' });
    }
    if (filing_types !== undefined && !Array.isArray(filing_types)) {
      return res.status(400).json({ success: false, message: 'filing_types must be an array' });
    }
    if (email !== undefined && email !== null && typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Client email must be a string.' });
    }
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Enter a valid client email address.' });
    }
    const filingTypes = (filing_types || []).filter(type => typeof type === 'string' && type.trim()).map(type => type.trim());

    if (isConnected) {
      let { data, error } = await supabase
        .from('clients')
        .insert([{ user_id: req.user.id, name: name.trim(), entity_type: entity_type || 'Individual', pan: pan || null, gstin: gstin || null, phone: phone || null, email: normalizedEmail || null, country_id: country_id || null, filing_type: filing_type || filingTypes[0] || 'ITR-1', filing_types: filingTypes, gstin_registered: gstin_registered ?? Boolean(gstin), notes: notes || null }])
        .select('*, supported_countries(country_name,currency_code)')
        .single();
      if (error) throw error;

      // Auto-create portal access for the client's email so they can log in and upload documents
      let portalAccess = null;
      let portalAccessWarning = '';
      if (normalizedEmail) {
        try {
          const { data: existingAccess, error: existingAccessError } = await supabase
            .from('client_portal_access')
            .select('id')
            .eq('client_id', data.id)
            .maybeSingle();
          if (existingAccessError) throw existingAccessError;
          if (!existingAccess) {
            const { data: newAccess, error: accessError } = await supabase
              .from('client_portal_access')
              .insert({
                client_id: data.id,
                invited_email: normalizedEmail,
                active: true,
                invitation_pending: false,
                created_by: req.user.id,
              })
              .select('id, invited_email, active, created_at')
              .single();
            if (accessError) throw accessError;
            portalAccess = newAccess;
          }
        } catch (portalError) {
          console.error(`[Clients] Auto portal access creation failed for ${data.id}:`, portalError.message);
          portalAccessWarning = 'Client was saved, but portal access could not be enabled. Confirm the client portal database migration has been applied, then enable access from the client portal settings.';
        }
      } else {
        portalAccessWarning = 'Client was saved without an email address, so client portal access is not enabled.';
      }

      invalidateClientsCache(req.user.id);
      return res.status(201).json({ success: true, source: 'supabase', data: { ...data, country_name: data.supported_countries?.country_name, currency_code: data.supported_countries?.currency_code, portalAccess, portalAccessWarning } });
    }

    // Fallback
    const newClient = {
      id: `demo_${Date.now()}`, name, entity_type, pan, gstin, phone, email: normalizedEmail || null,
      status: 'Active', total_docs: 0, total_ai_calls: 0,
      created_at: new Date().toISOString()
    };
    fallbackClients.push(newClient);
    res.status(201).json({ success: true, source: 'demo', data: newClient });
  } catch (err) {
    const duplicate = err.code === '23505';
    const message = duplicate ? 'A client with this PAN, phone number, or other unique detail already exists.' : (err.message || 'Failed to save client.');
    res.status(duplicate ? 409 : 500).json({ success: false, message });
  }
});

// PATCH /api/v1/clients/:id — Update client info
router.patch('/:id', async (req, res) => {
  try {
    const allowedFields = ['name', 'entity_type', 'pan', 'gstin', 'phone', 'email', 'country_id', 'filing_type', 'filing_types', 'gstin_registered', 'notes'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowedFields.includes(key)));
    if (updates.email !== undefined) {
      if (updates.email !== null && typeof updates.email !== 'string') {
        return res.status(400).json({ success: false, message: 'Client email must be a string.' });
      }
      const normalizedEmail = typeof updates.email === 'string' ? updates.email.trim().toLowerCase() : '';
      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: 'Enter a valid client email address.' });
      }
      updates.email = normalizedEmail || null;
    }
    if (updates.filing_types !== undefined && !Array.isArray(updates.filing_types)) {
      return res.status(400).json({ success: false, message: 'filing_types must be an array' });
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid client fields were provided.' });
    }
    if (isConnected) {
      const { data: currentClient, error: currentClientError } = await supabase
        .from('clients')
        .select('email, telegram_chat_id')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (currentClientError) throw currentClientError;
      if (!currentClient) return res.status(404).json({ success: false, message: 'Client not found.' });
      const previousEmail = String(currentClient.email || '').trim().toLowerCase();
      const requestedEmail = updates.email === undefined ? previousEmail : String(updates.email || '').trim().toLowerCase();
      const emailChanged = updates.email !== undefined && previousEmail !== requestedEmail;
      let existingAccess = null;
      if (emailChanged) {
        const { data, error: accessLookupError } = await supabase
          .from('client_portal_access')
          .select('id, user_id')
          .eq('client_id', req.params.id)
          .maybeSingle();
        if (accessLookupError) throw accessLookupError;
        existingAccess = data;
      }
      const { data, error } = await supabase
        .from('clients').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select('*, supported_countries(country_name,currency_code)').single();
      if (error) throw error;
      let portalAccessWarning = '';
      let portalInviteLink = '';
      let portalInviteDeliveryStatus = 'not_created';
      const updatedEmail = String(data.email || '').trim().toLowerCase();
      const portalAccessReset = emailChanged && previousEmail !== updatedEmail;
      if (portalAccessReset) {
        const warnings = [];
        try {
          await revokeClientPortalInvites(data.id);
        } catch (portalError) {
          console.error(`[Clients] Could not revoke old portal invitations for ${data.id}:`, portalError.message);
          warnings.push('Some old invitation links may remain in the database, but they no longer match the client email.');
        }

        let accessDetached = false;
        try {
          if (existingAccess && updatedEmail) {
            const { data: updatedAccess, error: accessUpdateError } = await supabase
              .from('client_portal_access')
              .update({ invited_email: updatedEmail, user_id: null, active: true, invitation_pending: false, updated_at: new Date().toISOString() })
              .eq('id', existingAccess.id)
              .select('id')
              .maybeSingle();
            if (accessUpdateError) throw accessUpdateError;
            accessDetached = Boolean(updatedAccess);
          } else if (existingAccess) {
            const { data: updatedAccess, error: accessRevokeError } = await supabase
              .from('client_portal_access')
              .update({ invited_email: null, user_id: null, active: false, invitation_pending: false, updated_at: new Date().toISOString() })
              .eq('id', existingAccess.id)
              .select('id')
              .maybeSingle();
            if (accessRevokeError) throw accessRevokeError;
            accessDetached = Boolean(updatedAccess);
          } else if (updatedEmail) {
            const { error: accessInsertError } = await supabase
              .from('client_portal_access')
              .insert({ client_id: data.id, invited_email: updatedEmail, active: true, invitation_pending: false, created_by: req.user.id });
            if (accessInsertError) throw accessInsertError;
            accessDetached = true;
          }
        } catch (portalError) {
          console.error(`[Clients] Portal access reset failed for ${data.id}:`, portalError.message);
          warnings.push('The client record was updated, but portal access could not be fully reset. Review this client’s portal access before sending an upload link.');
        }

        if (existingAccess?.user_id && accessDetached) {
          try {
            const { data: otherAccess, error: otherAccessError } = await supabase
              .from('client_portal_access')
              .select('id, client_id')
              .eq('user_id', existingAccess.user_id)
              .eq('active', true);
            if (otherAccessError) throw otherAccessError;
            if ((otherAccess || []).length > 0) {
              warnings.push('The previous portal login was retained because it is still linked to another active client.');
            } else {
              const { data: oldUserData, error: oldUserError } = await supabase.auth.admin.getUserById(existingAccess.user_id);
              if (oldUserError) throw oldUserError;
              const oldUser = oldUserData?.user;
              if (oldUser?.app_metadata?.taxflow_client_portal === true) {
                const { error: deleteUserError } = await supabase.auth.admin.deleteUser(existingAccess.user_id);
                if (deleteUserError) throw deleteUserError;
              }
            }
          } catch (portalError) {
            console.error(`[Clients] Could not retire the previous portal identity for ${data.id}:`, portalError.message);
            warnings.push('Previous portal access has been disconnected. The old portal login could not be deleted automatically; contact support if it should be removed.');
          }
        }

        if (updatedEmail && accessDetached) {
          try {
            const invitation = await createClientPortalInvite({
              clientId: data.id,
              email: updatedEmail,
              createdBy: req.user.id,
              storeEncryptedToken: Boolean(data.telegram_chat_id),
            });
            portalInviteLink = getClientPortalInvitationLink(invitation.token);
            portalInviteDeliveryStatus = 'created';
            if (data.telegram_chat_id) {
              const delivery = await telegramRouter.notifyClientPortalEmailChanged(data, {
                previousEmail,
                updatedEmail,
                invitationId: invitation.id,
                invitationLink: portalInviteLink,
              });
              portalInviteDeliveryStatus = delivery.sent ? 'sent' : 'telegram_not_linked';
            } else {
              portalInviteDeliveryStatus = 'telegram_not_linked';
            }
            if (portalInviteDeliveryStatus === 'telegram_not_linked') {
              warnings.push('A fresh portal invitation is ready, but this client has no linked Telegram chat. Copy the invitation link and send it privately to the new email address.');
            }
          } catch (portalError) {
            console.error(`[Clients] Could not create or send the fresh portal invitation for ${data.id}:`, portalError.message);
            portalInviteDeliveryStatus = portalInviteLink ? 'delivery_failed' : 'not_created';
            warnings.push(portalInviteLink
              ? 'The fresh portal invitation could not be delivered automatically. Copy the invitation link and send it privately to the client.'
              : 'The email was changed and old access was disconnected, but a fresh portal invitation could not be created. Use Create secure invite link to continue.');
          }
        } else if (updatedEmail) {
          portalInviteDeliveryStatus = 'access_reset_failed';
        }
        portalAccessWarning = warnings.join(' ');
      }
      invalidateClientsCache(req.user.id);
      return res.json({ success: true, source: 'supabase', data: { ...data, country_name: data.supported_countries?.country_name, currency_code: data.supported_countries?.currency_code, portalAccessReset, portalAccessWarning, portalInviteLink, portalInviteDeliveryStatus } });
    }
    const idx = fallbackClients.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });
    fallbackClients[idx] = { ...fallbackClients[idx], ...req.body };
    res.json({ success: true, source: 'demo', data: fallbackClients[idx] });
  } catch (err) {
    console.error(`[Clients] Client update failed for ${req.params.id}:`, err.message);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'That email address or another unique client detail is already assigned.' });
    }
    return res.status(500).json({ success: false, message: 'Could not update this client. Please try again; if the problem continues, contact support.' });
  }
});

// DELETE /api/v1/clients/:id — permanently delete the client and owned data
router.delete('/:id', async (req, res) => {
  const clientId = String(req.params.id || '').trim();
  if (!clientId || clientId.length > 128) {
    return res.status(400).json({ success: false, message: 'A valid client id is required.' });
  }

  try {
    if (isConnected) {
      const { data: existing, error: lookupError } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', clientId)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) return res.status(404).json({ success: false, message: 'Client not found.' });

      await removeClientCloudDocuments(req.user.id, clientId);
      const { error: deleteError } = await supabase
        .from('clients')
        .delete()
        .eq('id', clientId)
        .eq('user_id', req.user.id);
      if (deleteError) throw deleteError;
      invalidateClientsCache(req.user.id);
      return res.json({ success: true, source: 'supabase', data: { id: clientId, name: existing.name } });
    }

    const index = fallbackClients.findIndex(client => client.id === clientId);
    if (index === -1) return res.status(404).json({ success: false, message: 'Client not found.' });
    const [deleted] = fallbackClients.splice(index, 1);
    return res.json({ success: true, source: 'demo', data: { id: clientId, name: deleted.name } });
  } catch (err) {
    console.error(`[Clients] Delete failed for ${clientId}:`, err);
    return res.status(err.status || 500).json({ success: false, message: err.status === 409
      ? err.message
      : 'Could not permanently delete this client and its connected data.' });
  }
});

router.get('/:id/documents/tree', async (req, res) => {
  try {
    let client;
    if (isConnected && supabase) {
      const { data, error } = await supabase.from('clients')
        .select('id, name, created_at')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (error) throw error;
      client = data;
    } else {
      client = fallbackClients.find(item => item.id === req.params.id);
    }
    if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });

    let documents;
    if (isConnected && supabase) {
      const { data, error } = await supabase.from('documents_metadata')
        .select('id, client_id, source, file_name, file_size_kb, category, created_at, storage_bucket, storage_object_path')
        .eq('client_id', client.id)
        .neq('source', 'Telegram')
        .order('created_at', { ascending: false });
      if (error) throw error;
      documents = (data || []).filter(document => {
        const valid = isExpectedDocumentObject({
          bucket: document.storage_bucket,
          objectKey: document.storage_object_path,
          userId: req.user.id,
          clientId: client.id,
          documentId: document.id,
          createdAt: document.created_at,
          fileName: document.file_name,
          category: document.category
        });
        if (!valid) console.error(`[Clients] Hiding non-cloud or invalid document ${document.id} from the file browser.`);
        return valid;
      });
    } else {
      documents = [];
    }

    const entries = [];
    addClientFoldersToTree(entries, client.created_at);
    for (const document of documents) addCloudDocumentToTree(entries, document);
    return res.json({
      success: true,
      source: isConnected ? 'supabase' : 'demo',
      data: { clientId: client.id, clientName: client.name, entries }
    });
  } catch (error) {
    console.error(`[Clients] Cloud document tree failed for ${req.params.id}:`, error);
    return res.status(500).json({ success: false, message: 'Cloud documents could not be loaded.' });
  }
});

module.exports = router;
