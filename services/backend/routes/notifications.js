const express = require('express');
const router = express.Router();
const { listNotifications, markNotificationsRead, createNotification } = require('../lib/notifications');
const {
  isResendConfigured,
  sendEmail,
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
    const { eventType, title, message, entityType, entityId, metadata, sendEmailAlert, recipientEmail } = req.body;
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
      recipientEmail: recipientEmail || req.user?.email
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
    const { to, subject, html, text, type, clientName, inviteLink, fileName, taskTitle, dueDate, portalLink } = req.body;

    const recipient = to || req.user?.email;
    if (!recipient) {
      return res.status(400).json({ success: false, message: 'Recipient email address ("to") is required.' });
    }

    let result;

    if (type === 'portal-invite') {
      result = await sendPortalInviteEmail({
        to: recipient,
        clientName: clientName || 'Valued Client',
        inviteLink: inviteLink || 'https://taxflowaiwebsite.vercel.app',
        practiceName: req.user?.user_metadata?.firm_name || 'TaxFlow Practice'
      });
    } else if (type === 'document-upload') {
      result = await sendDocumentUploadNotificationEmail({
        to: recipient,
        clientName: clientName || 'Valued Client',
        fileName: fileName || 'Uploaded Document'
      });
    } else if (type === 'deadline-reminder') {
      result = await sendDeadlineReminderEmail({
        to: recipient,
        clientName: clientName || 'Valued Client',
        taskTitle: taskTitle || 'Tax Filing',
        dueDate: dueDate || new Date().toISOString().slice(0, 10),
        portalLink
      });
    } else {
      if (!subject || (!html && !text)) {
        return res.status(400).json({ success: false, message: 'Subject and content (html or text) are required.' });
      }
      result = await sendEmail({ to: recipient, subject, html, text });
    }

    // Also record a notification in the DB
    if (result.success && req.user?.id) {
      await createNotification({
        userId: req.user.id,
        eventType: 'email.sent',
        title: `Email sent: ${subject || type}`,
        message: `Dispatched outbound email to ${recipient}`,
        metadata: { resendId: result.id, type, recipient }
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to send email via Resend.' });
  }
});

module.exports = router;
