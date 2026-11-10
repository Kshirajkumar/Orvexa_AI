const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { listNotifications, markNotificationsRead, createNotification } = require('../lib/notifications');
const { hashInviteToken } = require('../lib/clientPortalInvites');
const {
  isResendConfigured,
  sendPortalInviteEmail,
  sendDocumentUploadNotificationEmail,
  sendDeadlineReminderEmail,
  testResendConnection
} = require('../lib/resend');

// GET /api/v1/notifications — recent database activity for the signed-in user
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
    const userId = req.user?.id;
    const result = await listNotifications({ userId, limit });
    return res.json({
      success: true,
      source: result.source,
      data: result.data,
      count: result.count,
      unreadCount: result.unreadCount
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not load notifications.' });
  }
});

// POST /api/v1/notifications/read — mark the current user's notifications as read
router.post('/read', async (req, res) => {
  try {
    const userId = req.user?.id;
    const result = await markNotificationsRead({ userId });
    return res.json({ success: true, source: result.source, updated: result.updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not mark notifications as read.' });
  }
});

// POST /api/v1/notifications — manually dispatch a notification
router.post('/', async (req, res) => {
  try {
    const { eventType, title, message, entityType, entityId, metadata, sendEmailAlert } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }

    const notification = await createNotification({
      userId: req.user?.id,
      eventType: eventType || 'general.alert',
      title,
      message,
      entityType,
      entityId,
      metadata,
      sendEmailAlert: Boolean(sendEmailAlert),
      recipientEmail: req.user?.email
    });

    return res.json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not create notification.' });
  }
});

// GET /api/v1/notifications/resend-status — check Resend API key status
router.get('/resend-status', async (_req, res) => {
  try {
    const configured = isResendConfigured();
    const diagnostic = await testResendConnection();
    return res.json({
      success: true,
      configured,
      diagnostic
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/v1/notifications/send-email — send transactional email via Resend
router.post('/send-email', async (req, res) => {
  try {
    const { to, type, inviteLink, documentId, taskId } = req.body || {};
    if (!['portal-invite', 'document-upload', 'deadline-reminder'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Choose a supported transactional email type.' });
    }

    const recipient = String(to || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(400).json({ success: false, message: 'A valid recipient email address is required.' });
    }
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Email recipient ownership cannot be verified while the database is unavailable.' });
    }

    const { data: client, error: clientError } = await supabase.from('clients')
      .select('id, name, email')
      .eq('user_id', req.user.id)
      .eq('email', recipient)
      .is('deletion_requested_at', null)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return res.status(404).json({ success: false, message: 'Recipient is not an active client of this practice.' });

    let result;

    if (type === 'portal-invite') {
      const token = getActivePortalInviteToken(inviteLink);
      if (!token) {
        return res.status(400).json({ success: false, message: 'A valid active invitation link is required.' });
      }
      const { data: invitation, error: invitationError } = await supabase.from('client_portal_invites')
        .select('id')
        .eq('client_id', client.id)
        .eq('invited_email', recipient)
        .eq('token_hash', hashInviteToken(token))
        .is('consumed_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (invitationError) throw invitationError;
      if (!invitation) return res.status(404).json({ success: false, message: 'The invitation is no longer active.' });

      result = await sendPortalInviteEmail({
        to: recipient,
        clientName: client.name,
        inviteLink,
        practiceName: req.user?.user_metadata?.firm_name || 'TaxFlow Practice'
      });
    } else if (type === 'document-upload') {
      if (typeof documentId !== 'string' || !documentId) {
        return res.status(400).json({ success: false, message: 'documentId is required for a document upload email.' });
      }
      const { data: document, error: documentError } = await supabase.from('documents_metadata')
        .select('file_name, category')
        .eq('id', documentId)
        .eq('client_id', client.id)
        .is('deletion_requested_at', null)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document) return res.status(404).json({ success: false, message: 'Document not found for this client.' });

      result = await sendDocumentUploadNotificationEmail({
        to: recipient,
        clientName: client.name,
        fileName: document.file_name,
        category: document.category
      });
    } else {
      if (typeof taskId !== 'string' || !taskId) {
        return res.status(400).json({ success: false, message: 'taskId is required for a deadline reminder.' });
      }
      const { data: task, error: taskError } = await supabase.from('compliance_tasks')
        .select('form_type, due_date, status')
        .eq('id', taskId)
        .eq('client_id', client.id)
        .maybeSingle();
      if (taskError) throw taskError;
      if (!task) return res.status(404).json({ success: false, message: 'Deadline task not found for this client.' });
      if (task.status === 'Filed') return res.status(409).json({ success: false, message: 'A reminder cannot be sent for a filed task.' });

      result = await sendDeadlineReminderEmail({
        to: recipient,
        clientName: client.name,
        taskTitle: task.form_type,
        dueDate: task.due_date
      });
    }

    // Also record a notification in the DB
    if (result.success) {
      try {
        await createNotification({
          userId: req.user.id,
          eventType: 'email.sent',
          title: `Email sent: ${type}`,
          message: `Dispatched outbound email to ${recipient}`,
          metadata: { resendId: result.id, type, recipient, clientId: client.id }
        });
      } catch (notificationError) {
        console.error('[Notifications] Email sent, but its activity record could not be saved:', notificationError.message);
        result.notificationWarning = 'Email was sent, but its activity record could not be saved.';
      }
    }

    return res.status(result.success ? 200 : 502).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to send email via Resend.' });
  }
});

function getActivePortalInviteToken(inviteLink) {
  if (typeof inviteLink !== 'string') return null;
  try {
    const configured = new URL(process.env.CLIENT_PORTAL_URL || '');
    const candidate = new URL(inviteLink);
    if (configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) return null;
    if (process.env.NODE_ENV === 'production' && configured.protocol !== 'https:') return null;
    if (candidate.origin !== configured.origin || candidate.pathname !== '/portal'
      || candidate.username || candidate.password || candidate.search) return null;
    const fragment = new URLSearchParams(candidate.hash.slice(1));
    const token = fragment.get('invite');
    return /^[A-Za-z0-9_-]{40,64}$/.test(token || '') && Array.from(fragment).length === 1 ? token : null;
  } catch {
    return null;
  }
}

module.exports = router;
