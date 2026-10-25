const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { assertOwnedClient } = require('../lib/ownership');
const { nextDailyRun, scheduledLocalTimeToUtc } = require('../lib/scheduleTime');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEMO_TIMEZONES = [
  { country_id: '10000000-0000-4000-8000-000000000001', country_code: 'IN', country_name: 'India', timezone_name: 'Asia/Kolkata', is_default: true },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/New_York', is_default: true },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/Chicago', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/Denver', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/Phoenix', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/Los_Angeles', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/Anchorage', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'Pacific/Honolulu', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000003', country_code: 'AE', country_name: 'United Arab Emirates', timezone_name: 'Asia/Dubai', is_default: true },
  { country_id: '10000000-0000-4000-8000-000000000004', country_code: 'SG', country_name: 'Singapore', timezone_name: 'Asia/Singapore', is_default: true },
  { country_id: '10000000-0000-4000-8000-000000000005', country_code: 'GB', country_name: 'United Kingdom', timezone_name: 'Europe/London', is_default: true },
];

function isValidTimezone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

router.get('/timezones', async (_req, res) => {
  try {
    if (!isConnected) return res.json({ success: true, source: 'demo', data: DEMO_TIMEZONES });
    const { data, error } = await supabase.from('supported_country_timezones')
      .select('country_id,timezone_name,is_default,supported_countries(country_code,country_name)')
      .order('country_id')
      .order('is_default', { ascending: false });
    if (error) throw error;
    return res.json({
      success: true,
      source: 'supabase',
      data: (data || []).map((row) => ({
        country_id: row.country_id,
        timezone_name: row.timezone_name,
        is_default: row.is_default,
        country_code: row.supported_countries?.country_code,
        country_name: row.supported_countries?.country_name,
      })),
    });
  } catch (error) {
    console.error('[Schedules] Country time zones could not be loaded:', error.message);
    return res.status(503).json({ success: false, message: 'Country time-zone data is unavailable. Apply the inbox automation SQL migration, then retry.' });
  }
});

async function handleListSchedules(req, res) {
  try {
    if (!isConnected) return res.json({ success: true, source: 'demo', data: [] });
    const { data: schedules, error } = await supabase.from('telegram_message_schedules')
      .select('id,client_id,template_id,message_body,repeat_mode,timezone_name,scheduled_at,local_time,next_run_at,status,attempt_count,occurrence_count,last_sent_at,last_error,created_at')
      .eq('owner_user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const clientIds = [...new Set((schedules || []).map((item) => item.client_id))];
    let clientsById = new Map();
    if (clientIds.length) {
      const { data: clients, error: clientsError } = await supabase.from('clients')
        .select('id,name,country_id')
        .eq('user_id', req.user.id)
        .in('id', clientIds);
      if (clientsError) throw clientsError;
      clientsById = new Map((clients || []).map((client) => [client.id, client]));
    }
    return res.json({
      success: true,
      source: 'supabase',
      data: (schedules || [])
        .filter((item) => clientsById.has(item.client_id))
        .map((item) => ({ ...item, client: clientsById.get(item.client_id) })),
    });
  } catch (error) {
    console.error('[Schedules] Could not load Telegram schedules:', error.message);
    return res.status(503).json({ success: false, message: 'Scheduled reminders could not be loaded. Check the inbox automation database migration and try again.' });
  }
}

router.get('/', handleListSchedules);
router.get('', handleListSchedules);

async function handleCreateSchedule(req, res) {
  try {
    const {
      clientId,
      templateId,
      messageBody,
      repeatMode,
      timezoneName,
      scheduledLocal,
      localTime,
    } = req.body || {};

    if (!isConnected) {
      const demoSchedule = {
        id: 'demo_' + Date.now(),
        client_id: clientId,
        template_id: templateId || null,
        message_body: (messageBody || '').trim(),
        repeat_mode: repeatMode || 'once',
        timezone_name: timezoneName || 'UTC',
        scheduled_at: scheduledLocal ? new Date(scheduledLocal).toISOString() : null,
        local_time: repeatMode === 'daily' ? localTime : null,
        next_run_at: new Date(Date.now() + 60_000).toISOString(),
        status: 'active',
        attempt_count: 0,
        occurrence_count: 0,
        last_sent_at: null,
        last_error: null,
        created_at: new Date().toISOString(),
        client: { id: clientId, name: 'Client' },
      };
      return res.status(201).json({ success: true, source: 'demo', data: demoSchedule });
    }

    if (typeof clientId !== 'string' || !(await assertOwnedClient(req.user.id, clientId))) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }
    if (!['once', 'daily'].includes(repeatMode)) {
      return res.status(400).json({ success: false, message: 'Choose a one-time or daily schedule.' });
    }
    if (typeof messageBody !== 'string' || !messageBody.trim() || messageBody.trim().length > 4096) {
      return res.status(400).json({ success: false, message: 'Reminder text must be between 1 and 4096 characters.' });
    }
    if (typeof timezoneName !== 'string' || !isValidTimezone(timezoneName)) {
      return res.status(400).json({ success: false, message: 'Choose a valid time zone for this client.' });
    }

    const { data: client, error: clientError } = await supabase.from('clients')
      .select('id,name,email,status,telegram_chat_id,country_id')
      .eq('id', clientId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });
    if (client.status !== 'Active' || !client.telegram_chat_id) {
      return res.status(422).json({ success: false, message: 'The client must be active and linked to Telegram before scheduling a reminder.' });
    }

    const { data: timezoneRow, error: timezoneError } = await supabase.from('supported_country_timezones')
      .select('country_id')
      .eq('timezone_name', timezoneName)
      .maybeSingle();
    if (timezoneError) throw timezoneError;

    // Auto-resolve country_id once, then enforce every schedule against that country.
    let resolvedCountryId = client.country_id;
    if (!resolvedCountryId) {
      if (timezoneRow?.country_id) {
        resolvedCountryId = timezoneRow.country_id;
        try {
          await supabase.from('clients').update({ country_id: resolvedCountryId })
            .eq('id', client.id)
            .eq('user_id', req.user.id);
        } catch (updateErr) {
          console.warn('[Schedules] Could not auto-assign country_id to client:', updateErr.message);
        }
      }
    }
    if (!timezoneRow?.country_id || (resolvedCountryId && timezoneRow.country_id !== resolvedCountryId)) {
      return res.status(400).json({ success: false, message: 'Choose a time zone supported by the client’s country.' });
    }

    let template = null;
    if (templateId && UUID_PATTERN.test(String(templateId))) {
      try {
        const { data } = await supabase.from('message_templates')
          .select('id,user_id')
          .eq('id', templateId)
          .maybeSingle();
        if (data && (!data.user_id || data.user_id === req.user.id)) {
          template = data;
        }
      } catch (tplErr) {
        console.warn('[Schedules] Template lookup skipped:', tplErr.message);
      }
    }

    const scheduledAt = repeatMode === 'once'
      ? scheduledLocalTimeToUtc(scheduledLocal, timezoneName)
      : null;
    const nextRunAt = scheduledAt || nextDailyRun(localTime, timezoneName);
    const { data, error } = await supabase.from('telegram_message_schedules')
      .insert({
        owner_user_id: req.user.id,
        client_id: client.id,
        template_id: template?.id || null,
        message_body: messageBody.trim(),
        repeat_mode: repeatMode,
        timezone_name: timezoneName,
        scheduled_at: scheduledAt?.toISOString() || null,
        local_time: repeatMode === 'daily' ? localTime : null,
        next_run_at: nextRunAt.toISOString(),
        status: 'active',
      })
      .select('id,client_id,template_id,message_body,repeat_mode,timezone_name,scheduled_at,local_time,next_run_at,status,attempt_count,occurrence_count,last_sent_at,last_error,created_at')
      .single();
    if (error) throw error;
    return res.status(201).json({ success: true, source: 'supabase', data: { ...data, client: { id: client.id, name: client.name, country_id: resolvedCountryId } } });
  } catch (error) {
    if (/Choose a valid|Choose a send time|That local time/i.test(String(error.message || ''))) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('[Schedules] Could not create Telegram schedule:', error.message);
    return res.status(503).json({ success: false, message: error.message || 'The reminder could not be saved. Confirm the inbox automation SQL migration is applied and try again.' });
  }
}

router.post('/', handleCreateSchedule);
router.post('', handleCreateSchedule);

router.delete('/:id', async (req, res) => {
  try {
    if (!isConnected) return res.status(503).json({ success: false, message: 'Scheduled reminders are unavailable without the connected database.' });
    const { data, error } = await supabase.from('telegram_message_schedules')
      .update({ status: 'cancelled', lease_until: null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('owner_user_id', req.user.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Active reminder not found. It may already have been sent or cancelled.' });
    return res.json({ success: true, source: 'supabase', data });
  } catch (error) {
    console.error('[Schedules] Could not cancel Telegram schedule:', error.message);
    return res.status(503).json({ success: false, message: 'The reminder could not be cancelled. Please refresh and try again.' });
  }
});

router.post('/:id/retry', async (req, res) => {
  try {
    if (!isConnected) return res.status(503).json({ success: false, message: 'Scheduled reminders are unavailable without the connected database.' });
    const { data, error } = await supabase.from('telegram_message_schedules')
      .update({
        status: 'active',
        attempt_count: 0,
        lease_until: null,
        next_run_at: new Date(Date.now() + 60_000).toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('owner_user_id', req.user.id)
      .eq('status', 'failed')
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Failed reminder not found.' });
    return res.json({ success: true, source: 'supabase', data });
  } catch (error) {
    console.error('[Schedules] Could not retry Telegram schedule:', error.message);
    return res.status(503).json({ success: false, message: 'The reminder could not be retried. Please try again.' });
  }
});

module.exports = router;
