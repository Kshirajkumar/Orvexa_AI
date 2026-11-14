const { supabase, isConnected } = require('../db/supabase');
const { isClientAccount } = require('../lib/accountRoles');

async function requireClientPortalAuth(req, res, next) {
  if (!isConnected || !supabase) {
    return res.status(503).json({
      success: false,
      message: 'The client portal is temporarily unavailable.'
    });
  }

  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Sign in to access the client portal.' });
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ success: false, message: 'Sign in to access the client portal.' });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) {
      return res.status(401).json({ success: false, message: 'Your portal session is invalid or has expired.' });
    }
    if (!isClientAccount(user)) {
      return res.status(403).json({ success: false, message: 'This account is not a client portal account.' });
    }
    const { data: access, error: accessError } = await supabase
      .from('client_portal_access')
      .select('client_id, invited_email, user_id')
      .eq('user_id', user.id)
      .eq('active', true)
      .maybeSingle();
    if (accessError) throw accessError;

    if (!access) {
      return res.status(403).json({
        success: false,
        code: 'portal_access_revoked',
        message: 'Your client portal access is no longer active. Your practice may have revoked access. You have been signed out; contact your CA if you need access again.'
      });
    }
    if (String(user.email || '').trim().toLowerCase() !== String(access.invited_email || '').trim().toLowerCase()) {
      return res.status(403).json({ success: false, code: 'portal_access_revoked', message: 'Your client portal email no longer matches the practice record. You have been signed out; contact your CA.' });
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, email, user_id, status')
      .eq('id', access.client_id)
      .eq('status', 'Active')
      .is('deletion_requested_at', null)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) {
      return res.status(403).json({
        success: false,
        code: 'portal_access_revoked',
        message: 'This client portal is no longer active. You have been signed out; contact your CA if you need access again.'
      });
    }
    if (String(client.email || '').trim().toLowerCase() !== String(access.invited_email || '').trim().toLowerCase()) {
      return res.status(403).json({ success: false, code: 'portal_access_revoked', message: 'The portal email on file has changed. You have been signed out; contact your CA for updated access.' });
    }

    req.portalUser = user;
    req.portalClient = client;
    req.accessToken = token;
    return next();
  } catch (error) {
    console.error('[Client Portal] Authentication failed:', error.message);
    return res.status(503).json({ success: false, message: 'Portal access could not be verified. Please try again shortly.' });
  }
}

module.exports = { requireClientPortalAuth };
