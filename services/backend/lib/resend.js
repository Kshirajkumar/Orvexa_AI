/**
 * TaxFlow.AI — Resend Email Delivery Service
 * ═══════════════════════════════════════════════════════════════
 * Handles outbound email notifications, client portal invitations,
 * document upload confirmations, and compliance deadline reminders.
 */

const { Resend } = require('resend');

const apiKey = process.env.RESEND_API_KEY;
const defaultFrom = process.env.RESEND_FROM_EMAIL || 'TaxFlow.AI <onboarding@resend.dev>';
const resendOnboardingFrom = 'TaxFlow.AI <onboarding@resend.dev>';

function getConfiguredFrom() {
  const configured = String(process.env.RESEND_FROM_EMAIL || defaultFrom).trim();
  // Resend's onboarding sender is the only sender available before a custom
  // domain is verified. Keep old deployments with the template placeholder
  // working until RESEND_FROM_EMAIL is updated to a verified domain.
  if (!configured || /yourdomain\.com/i.test(configured)) return resendOnboardingFrom;
  return configured;
}

function getResendConfigurationIssue() {
  const from = getConfiguredFrom();
  if (!from) return 'RESEND_FROM_EMAIL is empty. Set it to an address on a verified Resend domain.';
  const address = from.match(/<([^>]+)>/)?.[1] || from;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim())) {
    return 'RESEND_FROM_EMAIL is not a valid sender address. Set it to an address on a verified Resend domain.';
  }
  return null;
}

let resendClient = null;

function getResendClient() {
  const currentKey = process.env.RESEND_API_KEY || apiKey;
  if (!currentKey || currentKey === 'your_resend_api_key_here') {
    return null;
  }
  if (!resendClient || resendClient.key !== currentKey) {
    resendClient = new Resend(currentKey);
    resendClient.key = currentKey;
  }
  return resendClient;
}

function isResendConfigured() {
  const currentKey = process.env.RESEND_API_KEY || apiKey;
  return Boolean(currentKey && currentKey.startsWith('re_') && currentKey !== 'your_resend_api_key_here');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function safeEmailActionUrl(value) {
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Email action link must be a valid HTTPS URL.');
  }
  const isLocalDevelopmentUrl = process.env.NODE_ENV !== 'production'
    && url.protocol === 'http:'
    && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !isLocalDevelopmentUrl) || url.username || url.password) {
    throw new Error('Email action link must use HTTPS and cannot contain credentials.');
  }
  return escapeHtml(url.toString());
}

/**
 * Send a generic transactional email via Resend.
 */
async function sendEmail({ to, subject, html, text, from = getConfiguredFrom(), replyTo }) {
  const client = getResendClient();
  const recipient = Array.isArray(to) ? to : [to].filter(Boolean);

  if (!recipient.length) {
    throw new Error('At least one recipient email address ("to") is required.');
  }
  const safeSubject = String(subject || '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim().slice(0, 200);
  if (!safeSubject) throw new Error('A valid email subject is required.');

  const senderIssue = getResendConfigurationIssue();
  if (client && senderIssue) {
    return {
      success: false,
      source: 'resend',
      code: 'EMAIL_SENDER_NOT_CONFIGURED',
      error: senderIssue,
    };
  }

  if (!client) {
    console.warn(`[Resend] ⚠️ Resend is not configured (RESEND_API_KEY missing). Simulating email to: ${recipient.join(', ')} — Subject: "${safeSubject}"`);
    return {
      success: true,
      source: 'simulated',
      id: `sim_${Date.now()}`,
      message: 'Email delivery simulated (no RESEND_API_KEY configured).'
    };
  }

  try {
    const payload = {
      from,
      to: recipient,
      subject: safeSubject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    };

    const result = await client.emails.send(payload);

    if (result.error) {
      console.error('[Resend] ❌ Send error:', result.error.message || result.error);
      return {
        success: false,
        source: 'resend',
        error: result.error.message || 'Resend rejected the email payload',
        details: result.error
      };
    }

    console.log(`[Resend] ✉️ Email sent successfully to ${recipient.join(', ')} (ID: ${result.data?.id})`);
    return {
      success: true,
      source: 'resend',
      id: result.data?.id
    };
  } catch (err) {
    console.error('[Resend] ❌ Exception sending email:', err.message);
    return {
      success: false,
      source: 'resend',
      error: err.message
    };
  }
}

/**
 * Common HTML wrapper with TaxFlow.AI brand styling
 */
function wrapHtmlEmail({ title, preheader = '', contentHtml, actionUrl, actionText, footerNote = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0B0E14; color: #E2E8F0; margin: 0; padding: 0; }
    .wrapper { max-width: 600px; margin: 24px auto; background-color: #121824; border: 1px solid #1E293B; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%); padding: 32px 32px 24px; border-bottom: 1px solid #1E293B; }
    .logo { font-size: 22px; font-weight: 700; color: #38BDF8; letter-spacing: -0.5px; margin: 0 0 8px 0; }
    .logo-accent { color: #818CF8; }
    .title { font-size: 20px; font-weight: 600; color: #F8FAFC; margin: 0; }
    .content { padding: 32px; color: #CBD5E1; font-size: 15px; line-height: 1.6; }
    .card { background-color: #1A2234; border: 1px solid #2A364F; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .btn-container { text-align: center; margin: 32px 0 16px; }
    .btn { display: inline-block; background: linear-gradient(135deg, #2563EB 0%, #4F46E5 100%); color: #FFFFFF !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 8px; }
    .footer { padding: 24px 32px; background-color: #0C101A; border-top: 1px solid #1E293B; font-size: 12px; color: #64748B; text-align: center; }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${escapeHtml(preheader || title)}
  </div>
  <div class="wrapper">
    <div class="header">
      <div class="logo">TaxFlow<span class="logo-accent">.AI</span></div>
      <h1 class="title">${escapeHtml(title)}</h1>
    </div>
    <div class="content">
      ${contentHtml}
      ${actionUrl && actionText ? `
      <div class="btn-container">
        <a href="${safeEmailActionUrl(actionUrl)}" class="btn" target="_blank" rel="noopener noreferrer">${escapeHtml(actionText)}</a>
      </div>` : ''}
    </div>
    <div class="footer">
      <p style="margin: 0 0 6px 0;">${escapeHtml(footerNote || 'Secure communications powered by TaxFlow.AI Practice Suite.')}</p>
      <p style="margin: 0;">This email was sent to you regarding your tax compliance registry.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send Client Portal Invitation Email
 */
async function sendPortalInviteEmail({ to, clientName, inviteLink, practiceName = 'Your Chartered Accountant' }) {
  const safeClientName = escapeHtml(clientName);
  const safePracticeName = escapeHtml(practiceName);
  const safeInviteLink = safeEmailActionUrl(inviteLink);
  const title = `Secure Document Portal Invitation`;
  const html = wrapHtmlEmail({
    title,
    preheader: `Upload tax documents securely for ${clientName}`,
    actionUrl: inviteLink,
    actionText: 'Access Client Portal',
    contentHtml: `
      <p>Hello <strong>${safeClientName}</strong>,</p>
      <p><strong>${safePracticeName}</strong> has invited you to access your dedicated <strong>TaxFlow Client Portal</strong>.</p>
      <div class="card">
        <p style="margin: 0 0 8px 0; color: #94A3B8; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Portal Features:</p>
        <ul style="margin: 0; padding-left: 20px; color: #E2E8F0;">
          <li>Direct, encrypted document upload (GST, Form 16, Bank Statements)</li>
          <li>Instant AI receipt & verification status tracking</li>
          <li>End-to-end client confidentiality</li>
        </ul>
      </div>
      <p>Click the secure button below to set up your account and upload your requested files:</p>
      <p style="font-size: 12px; color: #94A3B8; word-break: break-all;">Link: <a href="${safeInviteLink}" style="color: #38BDF8;">${safeInviteLink}</a></p>
    `,
    footerNote: 'This is a private single-use invitation. Do not share or forward this link.'
  });

  return sendEmail({
    to,
    subject: `Invitation: Access your TaxFlow Client Portal (${clientName})`,
    html,
    text: `Hello ${clientName},\n\n${practiceName} has invited you to the TaxFlow Client Portal.\n\nAccess your portal here:\n${inviteLink}\n\nDo not share this link.`
  });
}

/**
 * Send Document Upload Confirmation Email
 */
async function sendDocumentUploadNotificationEmail({ to, clientName, fileName, category, uploadedAt = new Date().toLocaleString() }) {
  const safeClientName = escapeHtml(clientName);
  const safeFileName = escapeHtml(fileName);
  const safeCategory = escapeHtml(category || 'General');
  const safeUploadedAt = escapeHtml(uploadedAt);
  const title = `Document Upload Received`;
  const html = wrapHtmlEmail({
    title,
    preheader: `We received ${fileName} for ${clientName}`,
    contentHtml: `
      <p>Hello <strong>${safeClientName}</strong>,</p>
      <p>Your document has been securely received by your accounting team and logged into the verification queue.</p>
      <div class="card">
        <p style="margin: 0 0 6px 0;"><strong>File Name:</strong> ${safeFileName}</p>
        <p style="margin: 0 0 6px 0;"><strong>Category:</strong> ${safeCategory}</p>
        <p style="margin: 0;"><strong>Timestamp:</strong> ${safeUploadedAt}</p>
      </div>
      <p>Our automated intake system is reviewing the file. Your tax professional will be notified immediately if any further details are required.</p>
    `
  });

  return sendEmail({
    to,
    subject: `Document Received: ${fileName} — TaxFlow.AI`,
    html,
    text: `Hello ${clientName},\n\nWe received your document "${fileName}" (${category || 'General'}) at ${uploadedAt}.\n\nThank you,\nTaxFlow.AI`
  });
}

/** Send the one-time code used to confirm a new CA/staff account. */
async function sendEmailVerificationCode({ to, code, expiresInMinutes = 10 }) {
  const safeCode = escapeHtml(code);
  const title = 'Confirm your TaxFlow.AI account';
  const html = wrapHtmlEmail({
    title,
    preheader: 'Your TaxFlow.AI verification code',
    contentHtml: `
      <p>Use this verification code to confirm your TaxFlow.AI practice account:</p>
      <div class="card" style="text-align:center; letter-spacing:12px; font-size:32px; font-weight:700; color:#F8FAFC;">${safeCode}</div>
      <p>This code expires in <strong>${expiresInMinutes} minutes</strong> and can be used only once.</p>
      <p style="font-size:13px;color:#94A3B8;">If you did not create this account, you can safely ignore this email.</p>
    `,
    footerNote: 'TaxFlow.AI will never ask you to share this verification code.'
  });
  return sendEmail({
    to,
    subject: `${code} is your TaxFlow.AI verification code`,
    html,
    text: `Your TaxFlow.AI verification code is ${code}. It expires in ${expiresInMinutes} minutes. Never share this code.`
  });
}

/**
 * Send Tax & Compliance Deadline Reminder Email
 */
async function sendDeadlineReminderEmail({ to, clientName, taskTitle, dueDate, portalLink }) {
  const safeClientName = escapeHtml(clientName);
  const safeTaskTitle = escapeHtml(taskTitle);
  const safeDueDate = escapeHtml(dueDate);
  const title = `Upcoming Compliance Deadline`;
  const html = wrapHtmlEmail({
    title,
    preheader: `Reminder: ${taskTitle} is due on ${dueDate}`,
    actionUrl: portalLink,
    actionText: portalLink ? 'Upload Pending Documents' : undefined,
    contentHtml: `
      <p>Dear <strong>${safeClientName}</strong>,</p>
      <p>This is a priority reminder regarding an upcoming statutory tax compliance deadline:</p>
      <div class="card" style="border-left: 4px solid #F59E0B;">
        <h3 style="margin: 0 0 8px 0; color: #F8FAFC;">${safeTaskTitle}</h3>
        <p style="margin: 0; color: #F59E0B; font-weight: 600;">Due Date: ${safeDueDate}</p>
      </div>
      <p>Please ensure all necessary invoices, vouchers, and statements are submitted to prevent late fees or penalty interest.</p>
    `
  });

  return sendEmail({
    to,
    subject: `Action Required: ${taskTitle} due ${dueDate} (${clientName})`,
    html,
    text: `Dear ${clientName},\n\nReminder: ${taskTitle} is due on ${dueDate}. Please submit all required documents.\n\nTaxFlow.AI`
  });
}

/**
 * Quick Diagnostic check for Resend API key status
 */
async function testResendConnection() {
  const configured = isResendConfigured();
  if (!configured) {
    return {
      configured: false,
      valid: false,
      message: 'RESEND_API_KEY is not configured in .env'
    };
  }

  try {
    const key = process.env.RESEND_API_KEY;
    // Resend API returns 401 if invalid key when calling /api-keys or /domains
    const res = await fetch('https://api.resend.com/api-keys', {
      headers: { Authorization: `Bearer ${key}` }
    });

    if (res.status === 200) {
      return { configured: true, valid: true, message: 'Resend API key is valid and connected!' };
    }

    const data = await res.json().catch(() => ({}));
    return {
      configured: true,
      valid: false,
      statusCode: res.status,
      message: data.message || `Resend responded with status ${res.status}`
    };
  } catch (err) {
    return {
      configured: true,
      valid: false,
      error: err.message
    };
  }
}

module.exports = {
  getResendClient,
  isResendConfigured,
  getResendConfigurationIssue,
  sendEmail,
  sendPortalInviteEmail,
  sendDocumentUploadNotificationEmail,
  sendEmailVerificationCode,
  sendDeadlineReminderEmail,
  testResendConnection
};
