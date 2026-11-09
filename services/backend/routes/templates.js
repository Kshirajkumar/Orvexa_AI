const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');

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

// GET /api/v1/templates — List all message templates from database only
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
      const cleanData = (data || []).filter((tpl) => tpl.user_id === ownerId);

      return res.json({ success: true, source: 'supabase', data: cleanData });
    }
    return res.json({
      success: true,
      source: 'demo',
      data: [],
    });
  } catch (err) {
    console.error('[Templates] Could not list templates:', err.message);
    res.status(500).json({ success: false, message: 'Private templates could not be loaded.' });
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
