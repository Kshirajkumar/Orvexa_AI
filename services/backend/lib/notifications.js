/**
 * TaxFlow.AI — Notifications Service Helper
 * ═══════════════════════════════════════════════════════════════
 * Unified interface for inserting and reading user notifications
 * in Supabase public.notifications with automatic in-memory fallback.
 */

const { supabase, isConnected } = require('../db/supabase');
const { sendEmail, isResendConfigured } = require('./resend');

// In-memory fallback cache for demo mode or offline database
const inMemoryNotifications = [];

/**
 * Create a new notification for a user.
 *
 * @param {Object} params
 * @param {string} params.userId - auth.users UUID (required for db)
 * @param {string} params.eventType - e.g. 'client.created', 'document.uploaded', 'portal.invite_sent', 'deadline.reminder'
 * @param {string} params.title - Short header
 * @param {string} params.message - Full notification text
 * @param {string} [params.entityType] - 'client' | 'document' | 'deadline' | 'portal'
 * @param {string} [params.entityId] - UUID of associated record
 * @param {Object} [params.metadata] - Extra JSON payload
 * @param {boolean} [params.sendEmailAlert] - If true and recipient email provided, triggers Resend
 * @param {string} [params.recipientEmail] - Target email for Resend alert
 */
async function createNotification({
  userId,
  eventType,
  title,
  message,
  entityType = null,
  entityId = null,
  metadata = {},
  sendEmailAlert = false,
  recipientEmail = null
}) {
  const item = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: userId,
    event_type: eventType,
    title,
    message,
    entity_type: entityType,
    entity_id: entityId,
    metadata: metadata || {},
    read_at: null,
    created_at: new Date().toISOString()
  };

  // If Supabase is connected and userId is provided, persist to Supabase
  if (isConnected && supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          event_type: eventType,
          title,
          message,
          entity_type: entityType,
          entity_id: entityId,
          metadata: metadata || {}
        })
        .select()
        .single();

      if (error) {
        console.warn('[Notifications] Failed to insert notification into DB:', error.message);
        inMemoryNotifications.unshift(item);
      } else if (data) {
        item.id = data.id;
      }
    } catch (err) {
      console.warn('[Notifications] Exception creating DB notification:', err.message);
      inMemoryNotifications.unshift(item);
    }
  } else {
    // Keep in-memory for demo / unauthenticated sessions
    inMemoryNotifications.unshift(item);
    if (inMemoryNotifications.length > 100) inMemoryNotifications.pop();
  }

  // Optional Resend email dispatch
  if (sendEmailAlert && recipientEmail && isResendConfigured()) {
    try {
      await sendEmail({
        to: recipientEmail,
        subject: `TaxFlow Notification: ${title}`,
        html: `<p><strong>${title}</strong></p><p>${message}</p>`,
        text: `${title}\n\n${message}`
      });
    } catch (emailErr) {
      console.error('[Notifications] Resend email dispatch failed:', emailErr.message);
    }
  }

  return item;
}

/**
 * List recent notifications for a user.
 */
async function listNotifications({ userId, limit = 20 }) {
  if (isConnected && supabase && userId) {
    try {
      const { data, error, count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const { count: unreadCount } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null);

      return {
        source: 'supabase',
        data: data || [],
        count: count || 0,
        unreadCount: unreadCount || 0
      };
    } catch (err) {
      console.warn('[Notifications] DB load error, using in-memory:', err.message);
    }
  }

  // In-memory fallback
  const userItems = inMemoryNotifications
    .filter(n => !userId || n.user_id === userId)
    .slice(0, limit);
  const unreadCount = userItems.filter(n => !n.read_at).length;

  return {
    source: 'in_memory',
    data: userItems,
    count: userItems.length,
    unreadCount
  };
}

/**
 * Mark notifications read
 */
async function markNotificationsRead({ userId }) {
  if (isConnected && supabase && userId) {
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('user_id', userId)
        .is('read_at', null)
        .select('id');

      if (error) throw error;
      return { source: 'supabase', updated: data?.length || 0 };
    } catch (err) {
      console.warn('[Notifications] DB mark-read failed, falling back:', err.message);
    }
  }

  let updated = 0;
  const now = new Date().toISOString();
  for (const n of inMemoryNotifications) {
    if ((!userId || n.user_id === userId) && !n.read_at) {
      n.read_at = now;
      updated++;
    }
  }
  return { source: 'in_memory', updated };
}

module.exports = {
  createNotification,
  listNotifications,
  markNotificationsRead
};

