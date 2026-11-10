const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get('/', async (req, res) => {
  try {
    if (!isConnected || !supabase) {
      return res.json({ success: true, source: 'demo', data: [] });
    }
    const { data, error } = await supabase.from('storage_cleanup_jobs')
      .select('id, target_type, status, attempt_count, created_at, completed_at')
      .eq('user_id', req.user.id)
      .neq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw error;
    return res.json({
      success: true,
      source: 'supabase',
      data: (data || []).map(job => ({
        ...job,
        message: job.status === 'failed'
          ? 'Cloud cleanup needs a manual retry.'
          : `The ${job.target_type} deletion is queued for cloud cleanup.`
      }))
    });
  } catch (error) {
    console.error('[Storage Cleanup] Could not list jobs:', error.message);
    return res.status(500).json({ success: false, message: 'Cleanup status could not be loaded.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ success: false, message: 'A valid cleanup job id is required.' });
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Cloud cleanup status is unavailable.' });
    }
    const { data, error } = await supabase.from('storage_cleanup_jobs')
      .select('id, target_type, status, attempt_count, created_at, completed_at')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Cleanup job not found.' });
    return res.json({
      success: true,
      source: 'supabase',
      data: {
        ...data,
        message: data.status === 'completed'
          ? 'Cloud cleanup is complete.'
          : data.status === 'failed'
            ? 'Cloud cleanup needs a retry.'
            : 'Cloud cleanup is queued and will retry automatically if Storage is unavailable.'
      }
    });
  } catch (error) {
    console.error(`[Storage Cleanup] Could not load job ${req.params.id}:`, error.message);
    return res.status(500).json({ success: false, message: 'Cleanup status could not be loaded.' });
  }
});

router.post('/:id/retry', async (req, res) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ success: false, message: 'A valid cleanup job id is required.' });
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Cloud cleanup is unavailable.' });
    }
    const { data, error } = await supabase.rpc('retry_storage_cleanup_job', {
      p_job_id: req.params.id,
      p_user_id: req.user.id
    });
    if (error) throw error;
    if (!data) return res.status(409).json({ success: false, message: 'This cleanup job is not failed or does not belong to your account.' });
    return res.status(202).json({ success: true, source: 'supabase', data: { id: req.params.id, status: 'pending' } });
  } catch (error) {
    console.error(`[Storage Cleanup] Could not retry job ${req.params.id}:`, error.message);
    return res.status(500).json({ success: false, message: 'Cleanup could not be retried.' });
  }
});

module.exports = router;
