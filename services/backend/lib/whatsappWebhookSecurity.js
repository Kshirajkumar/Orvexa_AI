const crypto = require('node:crypto');

function captureWhatsAppWebhookBody(req, _res, body) {
  const requestPath = String(req.originalUrl || req.url || '').split('?')[0];
  if (requestPath === '/api/v1/whatsapp/webhook') req.rawBody = Buffer.from(body);
}

function verifyWhatsAppWebhookSignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || !appSecret || typeof signature !== 'string') return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const supplied = Buffer.from(match[1], 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = { captureWhatsAppWebhookBody, verifyWhatsAppWebhookSignature };
