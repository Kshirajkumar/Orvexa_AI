const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');

const DEFAULT_TEMPLATES = [
  { template_key: 'website_link', name: 'Website link', cat: 'Links', body: 'Hello {name}, you can visit our client portal and website at: {portalLink}', protected: true },
  { template_key: 'portal_link', name: 'Client portal website link', cat: 'Client portal', body: 'Hello {name}, you can sign in to your TaxFlow client portal and upload your requested documents here: {portalLink}', protected: true },
  { template_key: 'portal_invite', name: 'Secure portal invitation', cat: 'Client portal', body: 'Hello {name}, here is the link to your secure client portal where you can review your tax files and safely upload requested documents: {portalLink}\n\nUse the same email address your CA has on file. Please do not send tax, financial, identity, or other sensitive documents in Telegram.', protected: true },
  { template_key: 'docs', name: 'GST documents request', cat: 'Utility', body: 'Hello {name}, please upload your {period} sales & purchase invoices through your secure client portal: {portalLink}. Deadline: {due}.', protected: true },
  { template_key: 'pending', name: 'Missing document follow-up', cat: 'Utility', body: 'Hi {name}, we have not received the {doc} for {period} yet. Please upload it through your secure client portal: {portalLink}.', protected: true },
  { template_key: 'itr', name: 'ITR filing documents', cat: 'Utility', body: 'Hi {name}, to file your ITR please upload Form 16 / 26AS, bank interest certificates, and investment proofs through your secure client portal: {portalLink}.', protected: true },
  { template_key: 'payment_reminder', name: 'Fee & invoice reminder', cat: 'Payment', body: 'Hi {name}, this is a gentle reminder regarding the professional fee invoice for {period}. Please review and complete payment at your convenience.', protected: true },
  { template_key: 'status_update', name: 'Tax filing status update', cat: 'General', body: 'Hello {name}, your {filing} for {period} has been prepared and filed. You can check the acknowledgement on your client portal: {portalLink}.', protected: true },
  { template_key: 'onboarding', name: 'New client welcome', cat: 'Client portal', body: 'Hello {name}, welcome to our tax and compliance practice! Please access your client portal here to complete your onboarding and review required documents: {portalLink}', protected: true },
];

function normalizedBody(body) {
  return typeof body === 'string' ? body.trim() : '';
}

function validateTemplateFields({ name, cat, body }, { partial = false } = {}) {
  if (!partial || name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) return 'Template name must be between 1 and 200 characters.';
  }
  if (!partial || cat !== undefined) {
    if (cat !== undefined && (typeof cat !== 'string' || cat.trim().length > 50)) return 'Template category must be 50 characters or fewer.';
  }
  if (!partial || body !== undefined) {
    if (typeof body !== 'string' || !body.trim() || body.trim().length > 5000) return 'Template body must be between 1 and 5000 characters.';
  }
  return '';
}

// GET /api/v1/templates — List all message templates:
// 1. Shared default templates (user_id IS NULL) -> visible to all users
// 2. Private templates (user_id === req.user.id) -> visible only to the owner
router.get('/', requireAuth, async (req, res) => {
  try {
    if (isConnected) {
      const ownerId = String(req.user?.id || '').trim();
      if (!ownerId) return res.status(401).json({ success: false, message: 'Authentication is required.' });

      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      // Filter: default templates (user_id IS NULL) + private templates belonging to this user
      const cleanData = (data || []).filter((tpl) => !tpl.user_id || tpl.user_id === ownerId);

      return res.json({ success: true, source: 'supabase', data: cleanData });
    }
    return res.json({
      success: true,
      source: 'demo',
      data: DEFAULT_TEMPLATES.map((template) => ({ ...template, id: `demo-${template.template_key}`, user_id: null })),
    });
  } catch (err) {
    console.error('[Templates] Could not list templates:', err.message);
    res.status(500).json({ success: false, message: 'Templates could not be loaded.' });
  }
});

// POST /api/v1/templates — Create a new message template
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, cat, body } = req.body || {};
    const validationError = validateTemplateFields({ name, cat, body });
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const category = typeof cat === 'string' ? cat.trim() : '';

    if (isConnected) {
      const { data, error } = await supabase
        .from('message_templates')
        .insert({
          user_id: req.user.id,
          name: name.trim(),
          cat: category || 'Utility',
          body: normalizedBody(body),
          protected: false,
        })
        .select('*')
        .single();
      if (error) throw error;
      return res.status(201).json({ success: true, source: 'supabase', data });
    }
    return res.status(201).json({ success: true, source: 'demo', data: { id: 'demo_' + Date.now(), user_id: req.user.id, name: name.trim(), cat: category || 'Utility', body: normalizedBody(body), protected: false } });
  } catch (err) {
    console.error('[Templates] Could not create template:', err.message);
    res.status(500).json({ success: false, message: 'Template could not be created.' });
  }
});

// PATCH /api/v1/templates/:id — Update a message template
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const templateId = String(req.params.id || '').trim();
    if (!templateId) {
      return res.status(400).json({ success: false, message: 'Template id is required.' });
    }
    const { name, cat, body } = req.body || {};
    const validationError = validateTemplateFields({ name, cat, body }, { partial: true });
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (cat !== undefined) updates.cat = cat.trim() || 'Utility';
    if (body !== undefined) updates.body = normalizedBody(body);
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'At least one template field must be provided.' });

    if (isConnected) {
      const { data: existing, error: existingError } = await supabase
        .from('message_templates')
        .select('protected,user_id')
        .eq('id', templateId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing || (existing.user_id && existing.user_id !== req.user.id)) {
        return res.status(404).json({ success: false, message: 'Template not found.' });
      }
      const { data, error } = await supabase
        .from('message_templates')
        .update(updates)
        .eq('id', templateId)
        .eq('user_id', req.user.id)
        .select('*')
        .single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }
    return res.json({ success: true, source: 'demo', data: { id: templateId, ...updates } });
  } catch (err) {
    console.error('[Templates] Could not update template:', err.message);
    res.status(500).json({ success: false, message: 'Template could not be updated.' });
  }
});

// DELETE /api/v1/templates/:id — Delete a message template
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const templateId = String(req.params.id || '').trim();
    if (!templateId) {
      return res.status(400).json({ success: false, message: 'Template id is required.' });
    }

    if (isConnected) {
      const { data: existing, error: existingError } = await supabase
        .from('message_templates')
        .select('protected,user_id')
        .eq('id', templateId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing || (existing.user_id && existing.user_id !== req.user.id)) {
        return res.status(404).json({ success: false, message: 'Template not found.' });
      }
      if (existing.protected) {
        return res.status(403).json({ success: false, message: 'This template is protected and cannot be deleted.' });
      }

      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', templateId)
        .eq('user_id', req.user.id);
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data: { id: templateId } });
    }
    return res.json({ success: true, source: 'demo', data: { id: templateId } });
  } catch (err) {
    console.error('[Templates] Could not delete template:', err.message);
    res.status(500).json({ success: false, message: 'Template could not be deleted.' });
  }
});

module.exports = router;
