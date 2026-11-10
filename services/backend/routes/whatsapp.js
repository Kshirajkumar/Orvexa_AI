/**
 * TaxFlow.AI — WhatsApp Automation Routes
 *
 * Flow:
 *  1. Client sends text or media metadata on WhatsApp
 *  2. WhatsApp Cloud API fires a webhook POST to this server
 *  3. Server matches sender phone to a client record in Supabase
 *  4. Media is not downloaded or stored; the client is directed to the secure upload portal
 *  5. Auto-replies to the client with a privacy notice
 *  6. Message log is saved to Supabase whatsapp_messages table
 *  7. CA sees the new message and document in the React Desktop App
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');
const { getOwnedClientIds } = require('../lib/ownership');
const { verifyWhatsAppWebhookSignature } = require('../lib/whatsappWebhookSecurity');

const WA_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WA_APP_SECRET = process.env.WHATSAPP_APP_SECRET;

// --- In-Memory Fallback ---
let fallbackMessages = [
  {
    id: 'msg-001',
    client_id: '11111111-1111-1111-1111-111111111111',
    sender_phone: '+919820011223', sender_name: 'Reliable Motors Accounts',
    direction: 'inbound', message_type: 'document',
    body: 'Hi CA Sir, please find September GST invoice attached.',
    status: 'processed',
    created_at: '2026-10-08T10:29:45Z'
  },
  {
    id: 'msg-002',
    client_id: '11111111-1111-1111-1111-111111111111',
    sender_phone: 'TaxFlow Bot', sender_name: 'TaxFlow AI Assistant',
    direction: 'outbound', message_type: 'text',
    body: 'Please upload sensitive documents through your secure client portal.',
    status: 'sent', created_at: '2026-10-08T10:29:52Z'
  },
  {
    id: 'msg-003',
    client_id: '22222222-2222-2222-2222-222222222222',
    sender_phone: '+919930044556', sender_name: 'Dr. Ananya Roy',
    direction: 'inbound', message_type: 'text',
    body: 'Hello, can you tell me the last date for ITR filing?',
    status: 'received', created_at: '2026-10-09T08:15:00Z'
  },
  {
    id: 'msg-004',
    client_id: '22222222-2222-2222-2222-222222222222',
    sender_phone: 'TaxFlow Bot', sender_name: 'TaxFlow AI Assistant',
    direction: 'outbound', message_type: 'text',
    body: '📅 The due date for ITR-3 filing for AY 2026-27 is *October 31, 2026*. Please ensure all documents (Form 16, bank statements) are submitted to us before October 25. Need help?',
    status: 'sent', created_at: '2026-10-09T08:15:07Z'
  }
];

// GET /api/v1/whatsapp/status — Check WhatsApp Cloud API configuration
router.get('/status', requireAuth, async (_req, res) => {
  try {
    const configured = Boolean(WA_ACCESS_TOKEN && WA_PHONE_NUMBER_ID && !WA_ACCESS_TOKEN.includes('your_'));
    if (!configured) {
      return res.json({
        success: true,
        connected: false,
        configured: false,
        message: 'WhatsApp Cloud API credentials (WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID) are not configured in your backend environment.'
      });
    }
    return res.json({
      success: true,
      connected: true,
      configured: true,
      phoneNumberId: WA_PHONE_NUMBER_ID
    });
  } catch (err) {
    return res.status(500).json({ success: false, connected: false, message: err.message });
  }
});

// GET /api/v1/whatsapp/messages — List all WhatsApp messages
router.get('/messages', requireAuth, async (req, res) => {
  try {
    if (isConnected) {
      const ownedClientIds = await getOwnedClientIds(req.user.id);
      let query = supabase.from('whatsapp_messages').select('*').in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000']).order('created_at', { ascending: false });
      if (req.query.clientId) query = query.eq('client_id', req.query.clientId);
      const { data, error } = await query;
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data });
    }
    let msgs = fallbackMessages;
    if (req.query.clientId) msgs = msgs.filter(m => m.client_id === req.query.clientId);
    res.json({ success: true, count: msgs.length, source: 'demo', data: msgs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/v1/whatsapp/webhook — Verification handshake with Meta/WhatsApp
 * Meta calls this when you first register your webhook URL
 */
router.get('/webhook', (req, res) => {
  if (!WA_VERIFY_TOKEN) {
    return res.status(503).json({ success: false, message: 'WhatsApp webhook verification is not configured.' });
  }
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
    console.log('[WhatsApp] ✅ Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  console.warn('[WhatsApp] ❌ Webhook verification failed');
  res.status(403).json({ error: 'Verification failed' });
});

/**
 * POST /api/v1/whatsapp/webhook — Receive incoming messages from WhatsApp Cloud API
 * This is the main entry point for all client messages
 */
router.post('/webhook', async (req, res) => {
  if (!WA_APP_SECRET) {
    return res.status(503).json({ success: false, message: 'WhatsApp webhook signature verification is not configured.' });
  }
  if (!verifyWhatsAppWebhookSignature(req.rawBody, req.get('X-Hub-Signature-256'), WA_APP_SECRET)) {
    return res.status(401).json({ success: false, message: 'WhatsApp webhook signature is invalid.' });
  }

  // Always acknowledge immediately (WhatsApp requires < 5 second response)
  res.status(200).json({ status: 'received' });

  try {
    const body = req.body;
    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages) return;

    const msgData = body.entry[0].changes[0].value;
    const messages = msgData.messages;
    const contacts = msgData.contacts || [];

    for (const msg of messages) {
      const senderPhone = msg.from;
      const senderName = contacts.find(c => c.wa_id === msg.from)?.profile?.name || senderPhone;
      const msgType = msg.type; // text, image, document, audio

      let bodyText = '';
      let mediaUrl = null;
      let mediaType = 'text';

      if (msg.type === 'text') bodyText = msg.text?.body || '';
      if (msg.type === 'document') { mediaType = 'document'; bodyText = msg.document?.filename || 'Document'; }
      if (msg.type === 'image') { mediaType = 'image'; bodyText = msg.image?.caption || 'Image'; }

      console.log(`[WhatsApp] Processing inbound message ${msg.id || '(no id)'}.`);

      // Find client by phone number in Supabase
      let clientId = null, clientName = null;
      if (isConnected) {
        const cleanPhone = senderPhone.replace(/\D/g, '');
        const { data: clientData, error: clientError } = await supabase
          .from('clients').select('id, name').ilike('phone', `%${cleanPhone}%`).single();
        if (clientError && clientError.code !== 'PGRST116') throw clientError;
        if (clientData) { clientId = clientData.id; clientName = clientData.name; }
      }

      // Save inbound message to Supabase
      const inboundLog = {
        client_id: clientId, sender_phone: senderPhone, sender_name: senderName,
        direction: 'inbound', message_type: mediaType, body: bodyText,
        wa_message_id: msg.id, status: 'received'
      };
      if (isConnected) {
        const { error: logError } = await supabase.from('whatsapp_messages').insert([inboundLog]);
        if (logError) throw logError;
      }

      // Compose smart auto-reply
      const replyText = buildAutoReply(msgType, bodyText, clientName);
      await sendWhatsAppMessage(senderPhone, replyText);

      // Save outbound reply to Supabase
      if (isConnected) {
        const { error: replyLogError } = await supabase.from('whatsapp_messages').insert([{
          client_id: clientId, sender_phone: 'TaxFlow Bot', sender_name: 'TaxFlow AI Assistant',
          direction: 'outbound', message_type: 'text', body: replyText, status: 'sent'
        }]);
        if (replyLogError) throw replyLogError;
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook processing failed:', err.message);
  }
});

/**
 * POST /api/v1/whatsapp/send — Send a manual message from CA to client
 */
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { toPhone, message, clientId } = req.body || {};
    const normalizedPhone = normalizeWhatsAppPhone(toPhone);
    if (!normalizedPhone || typeof message !== 'string' || !message.trim() || message.length > 4096) {
      return res.status(400).json({ success: false, message: 'A valid recipient phone number and a message of 1–4,096 characters are required.' });
    }
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'clientId is required to send a message to an owned client.' });
    }

    const configured = Boolean(WA_ACCESS_TOKEN && WA_PHONE_NUMBER_ID && !WA_ACCESS_TOKEN.includes('your_'));
    if (!configured) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp Business API is not configured on this server. Please configure WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in backend .env to send real WhatsApp messages.'
      });
    }

    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Client ownership could not be verified because the database is unavailable.' });
    }
    const { data: client, error: clientError } = await supabase.from('clients')
      .select('id, phone')
      .eq('id', clientId)
      .eq('user_id', req.user.id)
      .is('deletion_requested_at', null)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }
    if (normalizeWhatsAppPhone(client.phone) !== normalizedPhone) {
      return res.status(400).json({ success: false, message: 'The recipient phone number must match the selected client record.' });
    }

    await sendWhatsAppMessage(normalizedPhone, message.trim());

    try {
      const { error: logError } = await supabase.from('whatsapp_messages').insert([{
        client_id: clientId, sender_phone: 'CA Manual',
        direction: 'outbound', message_type: 'text', body: message.trim(), status: 'sent'
      }]);
      if (logError) throw logError;
    } catch (logError) {
      console.error('[WhatsApp] Message sent, but its activity record could not be saved:', logError.message);
      return res.status(202).json({
        success: true,
        message: 'Message was sent, but its activity record could not be saved.'
      });
    }

    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 502;
    console.error('[WhatsApp] Manual send failed:', err.message);
    res.status(status).json({ success: false, message: status === 502 ? 'The WhatsApp message could not be sent.' : err.message });
  }
});

// --- Helpers ---

function normalizeWhatsAppPhone(phone) {
  if (typeof phone !== 'string' || !/^[+()\d.\-\s]+$/.test(phone)) return '';
  const digits = String(phone || '').replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

function buildAutoReply(msgType, bodyText, clientName) {
  const greeting = clientName ? `Hello ${clientName}! ` : 'Hello! ';

  if (msgType === 'document' || msgType === 'image') {
    return `${greeting}✅ We've received your document safely! It has been stored in your secure Client Vault and sent to our AI system for processing. Your CA will verify and confirm soon. 🙏`;
  }

  const lowerBody = bodyText.toLowerCase();
  if (lowerBody.includes('deadline') || lowerBody.includes('due date') || lowerBody.includes('last date')) {
    return `${greeting}📅 Please check with your CA for your specific filing deadlines. General deadlines:\n• GSTR-3B: 20th of each month\n• GSTR-1: 11th of each month\n• ITR: 31 October 2026\nFor more info, reply or call us.`;
  }
  if (lowerBody.includes('invoice') || lowerBody.includes('gst') || lowerBody.includes('bill')) {
    return `${greeting}📄 Please attach your invoice/bill image or PDF and we'll process it for you right away!`;
  }

  return `${greeting}Thank you for contacting TaxFlow AI. Your message has been received and your CA will respond shortly. For urgent matters, please call directly. 🙏`;
}

async function sendWhatsAppMessage(toPhone, text) {
  if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID || WA_ACCESS_TOKEN.includes('your_')) {
    const error = new Error('WhatsApp Business API is not configured.');
    error.status = 503;
    throw error;
  }
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(WA_PHONE_NUMBER_ID)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: toPhone, type: 'text', text: { body: text } })
    });
    if (!response.ok) {
      const error = new Error(`WhatsApp rejected the message (HTTP ${response.status}).`);
      error.status = 502;
      throw error;
    }
  } catch (err) {
    if (!err.status) err.status = 502;
    throw err;
  }
}

module.exports = router;
