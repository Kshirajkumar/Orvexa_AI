/**
 * TaxFlow.AI — Authentication Routes (Production Grade)
 *
 * Supabase remains the identity provider; transactional delivery is split by flow.
 * - Signup  → admin.createUser (unconfirmed) → Resend six-digit OTP → admin confirmation
 * - Login   → supabase.auth.signInWithPassword → fetches profile + onboarding status
 * - /me     → supabase.auth.getUser(token) → validates JWT + returns profile
 * - Onboarding → stores completion status in the Supabase profile
 * - Forgot  → supabase.auth.resetPasswordForEmail → Supabase Auth email provider
 *
 * Security:
 * - Rate limiting (5 failed attempts → 60 sec lockout) per IP+email
 * - No in-memory user stores, no mock credentials, no demo bypass
 * - All tokens validated with Supabase on every /me request
 */

const express = require('express');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();
const { supabase, isConnected, SUPABASE_SERVER_KEY } = require('../db/supabase');
const { ACCOUNT_ROLE, getAccountRole } = require('../lib/accountRoles');
const { requireAuth } = require('../middleware/requireAuth');
const { deleteAccountStorage, deleteAccountVaultSecrets } = require('../lib/accountDeletion');
const { isResendConfigured, sendEmailVerificationCode } = require('../lib/resend');
const ALLOWED_PRACTICE_TYPES = new Set(['Chartered Accountant (CA)', 'Individual']);
const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT';
const ACCOUNT_DELETE_CHALLENGE_LIFETIME_SECONDS = 5 * 60;
const EMAIL_OTP_LIFETIME_MINUTES = 10;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;

function signAccountDeletionChallenge(payload) {
  const secret = SUPABASE_SERVER_KEY;
  if (!secret) throw new Error('Account deletion challenge signing is not configured.');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyAccountDeletionChallenge(token, userId) {
  if (typeof token !== 'string' || token.length > 2048) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [encodedPayload, signature] = parts;
  const secret = SUPABASE_SERVER_KEY;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  let actual;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(signature)) return false;
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return payload.sub === userId
      && Number.isInteger(payload.exp)
      && payload.exp > Math.floor(Date.now() / 1000)
      && typeof payload.nonce === 'string'
      && /^[A-Za-z0-9_-]{32}$/.test(payload.nonce);
  } catch {
    return false;
  }
}

/**
 * Decode and verify a deletion challenge token without requiring a live Supabase session.
 * Returns the user ID (sub) if the challenge is valid; null otherwise.
 */
function decodeChallengeSub(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedPayload, signature] = parts;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  let actual;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(signature)) return null;
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (
      typeof payload.sub !== 'string' ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000) ||
      typeof payload.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{32}$/.test(payload.nonce)
    ) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────
// Rate Limiting (in-memory, per IP+email)
// Max 5 failed attempts in 60 s → 60 s lockout
// ──────────────────────────────────────────────────────────
const loginAttempts = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true, remaining: 5 };
  if (record.lockoutUntil && record.lockoutUntil > now) {
    return { allowed: false, secondsLeft: Math.ceil((record.lockoutUntil - now) / 1000) };
  }
  if (now - record.firstAttemptAt > 60000) {
    loginAttempts.delete(key);
    return { allowed: true, remaining: 5 };
  }
  if (record.count >= 5) {
    record.lockoutUntil = now + 60000;
    return { allowed: false, secondsLeft: 60 };
  }
  return { allowed: true, remaining: 5 - record.count };
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, firstAttemptAt: now };
  record.count += 1;
  if (record.count >= 5) record.lockoutUntil = now + 60000;
  loginAttempts.set(key, record);
}

function clearRateLimit(key) {
  loginAttempts.delete(key);
}

function hashEmailOtp(code) {
  const pepper = String(process.env.AUTH_OTP_PEPPER || SUPABASE_SERVER_KEY || '').trim();
  return crypto.createHmac('sha256', pepper).update(String(code)).digest('hex');
}

function generateEmailOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function issueEmailOtp({ userId, email, challengeId } = {}) {
  if (!isResendConfigured()) throw new Error('Transactional email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the backend.');

  const code = generateEmailOtp();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_OTP_LIFETIME_MINUTES * 60 * 1000).toISOString();
  let challenge;

  if (challengeId) {
    const { data: current, error: lookupError } = await supabase
      .from('auth_email_verification_challenges')
      .select('id, user_id, email, last_sent_at, consumed_at, expires_at')
      .eq('id', challengeId)
      .eq('email', email)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!current || current.consumed_at) throw Object.assign(new Error('This verification request is no longer active. Start signup again.'), { status: 409 });
    const elapsed = Math.floor((Date.now() - new Date(current.last_sent_at).getTime()) / 1000);
    if (elapsed < EMAIL_OTP_RESEND_COOLDOWN_SECONDS) {
      throw Object.assign(new Error(`Please wait ${EMAIL_OTP_RESEND_COOLDOWN_SECONDS - elapsed} seconds before requesting another code.`), { status: 429 });
    }
    const { data: updated, error: updateError } = await supabase
      .from('auth_email_verification_challenges')
      .update({ code_hash: hashEmailOtp(code), attempts: 0, expires_at: expiresAt, last_sent_at: now.toISOString() })
      .eq('id', current.id)
      .select('id, expires_at')
      .single();
    if (updateError) throw updateError;
    challenge = updated;
  } else {
    await supabase
      .from('auth_email_verification_challenges')
      .update({ consumed_at: now.toISOString() })
      .eq('user_id', userId)
      .is('consumed_at', null);
    const { data: created, error: createError } = await supabase
      .from('auth_email_verification_challenges')
      .insert({
        user_id: userId,
        email,
        code_hash: hashEmailOtp(code),
        max_attempts: EMAIL_OTP_MAX_ATTEMPTS,
        expires_at: expiresAt,
        last_sent_at: now.toISOString()
      })
      .select('id, expires_at')
      .single();
    if (createError) throw createError;
    challenge = created;
  }

  const delivery = await sendEmailVerificationCode({ to: email, code, expiresInMinutes: EMAIL_OTP_LIFETIME_MINUTES });
  if (!delivery?.success || delivery.source === 'simulated') {
    throw new Error(delivery?.error || 'Verification email could not be delivered.');
  }
  return challenge;
}

// ──────────────────────────────────────────────────────────
// Helper: fetch user_profile row from Supabase
// Uses service-role key (bypasses RLS) so backend can always read
// ──────────────────────────────────────────────────────────
async function fetchUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (data) return data;
  if (error && error.code !== 'PGRST116') return null;

  const { data: created, error: createError } = await supabase
    .from('user_profiles')
    .insert([{ id: userId }])
    .select()
    .single();
  if (createError) {
    console.error('[AUTH] Profile creation error:', createError.message);
    return null;
  }
  return created;
}

// ──────────────────────────────────────────────────────────
// Helper: build sanitised user object for API responses
// ──────────────────────────────────────────────────────────
function buildUserResponse(supaUser, profile) {
  return {
    id: supaUser.id,
    email: supaUser.email,
    name: profile?.full_name || supaUser.user_metadata?.full_name || 'Practice User',
    practiceType: profile?.practice_type || supaUser.user_metadata?.practice_type || 'Chartered Accountant (CA)',
    membershipNo: profile?.membership_no || supaUser.user_metadata?.membership_no || null,
    role: profile?.role || 'Managing Partner',
    accountCategory: profile?.account_category || (getAccountRole(supaUser) === ACCOUNT_ROLE.CLIENT ? 'client_user' : 'ca_user'),
    accountType: getAccountRole(supaUser),
    onboardingComplete: profile?.onboarding_complete ?? false
  };
}

// ──────────────────────────────────────────────────────────
// Guard: require Supabase connection
// ──────────────────────────────────────────────────────────
function requireSupabase(res) {
  if (!isConnected) {
    res.status(503).json({
      success: false,
      message: 'Cloud database is not connected. Please check the server configuration (SUPABASE_URL and SUPABASE_SECRET_KEY).'
    });
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────
// POST /api/v1/auth/signup
// Creates a real, initially unconfirmed Supabase Auth account and sends a
// server-generated six-digit verification code through Resend.
// A DB trigger auto-creates the user_profiles row.
// ──────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  if (!requireSupabase(res)) return;

  let createdUserId = '';
  try {
    const { name, email, password, practiceType, membershipNo } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }
    const cleanPracticeType = practiceType ? String(practiceType).trim() : 'Chartered Accountant (CA)';
    if (!ALLOWED_PRACTICE_TYPES.has(cleanPracticeType)) {
      return res.status(400).json({ success: false, message: 'Practice category must be Chartered Accountant (CA) or Individual.' });
    }

    if (!isResendConfigured()) {
      return res.status(503).json({ success: false, message: 'Email verification is temporarily unavailable. Ask the administrator to configure Resend on the backend.' });
    }

    const { data: supaAuth, error: supaErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: false,
      user_metadata: {
        full_name: name.trim(),
        practice_type: cleanPracticeType,
        membership_no: membershipNo ? membershipNo.trim() : null
      }
    });

    if (supaErr) {
      console.warn('[AUTH] Signup error:', supaErr.message);
      return res.status(400).json({ success: false, message: supaErr.message });
    }

    if (supaAuth.user) {
      createdUserId = supaAuth.user.id;
      const { error: roleError } = await supabase.auth.admin.updateUserById(supaAuth.user.id, {
        app_metadata: { role: ACCOUNT_ROLE.STAFF },
      });
      if (roleError) {
        // Missing role metadata is treated as staff by the backend for safe backward compatibility.
        console.error('[AUTH] Could not persist the staff account role:', roleError.message);
      }
    }

    const challenge = await issueEmailOtp({ userId: supaAuth.user.id, email: cleanEmail });
    return res.status(201).json({
      success: true,
      needsEmailConfirmation: true,
      verificationId: challenge.id,
      expiresIn: EMAIL_OTP_LIFETIME_MINUTES * 60,
      email: cleanEmail,
      message: 'Account created. We sent a six-digit verification code to your email.'
    });

  } catch (err) {
    console.error('[AUTH] Signup exception:', err);
    if (createdUserId) {
      const { error: rollbackError } = await supabase.auth.admin.deleteUser(createdUserId);
      if (rollbackError) console.error('[AUTH] Signup rollback failed:', rollbackError.message);
    }
    return res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Server error during registration. Please try again.' });
  }
});

router.post('/verify-email-otp', async (req, res) => {
  if (!requireSupabase(res)) return;
  const verificationId = typeof req.body?.verificationId === 'string' ? req.body.verificationId.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(verificationId) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: 'Enter the six-digit verification code from your email.' });
  }

  try {
    const { data: challenge, error: lookupError } = await supabase
      .from('auth_email_verification_challenges')
      .select('id, user_id, email, code_hash, attempts, max_attempts, expires_at, consumed_at')
      .eq('id', verificationId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: 'This verification code has expired. Request a new code.' });
    }
    if (challenge.attempts >= challenge.max_attempts) {
      return res.status(429).json({ success: false, message: 'Too many incorrect codes. Request a new verification code.' });
    }

    const expected = Buffer.from(challenge.code_hash, 'hex');
    const received = Buffer.from(hashEmailOtp(code), 'hex');
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      await supabase.from('auth_email_verification_challenges')
        .update({ attempts: challenge.attempts + 1 })
        .eq('id', challenge.id);
      return res.status(400).json({ success: false, message: 'That code is incorrect. Check the email and try again.' });
    }

    const { error: confirmError } = await supabase.auth.admin.updateUserById(challenge.user_id, { email_confirm: true });
    if (confirmError) throw confirmError;
    const { error: consumeError } = await supabase.from('auth_email_verification_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', challenge.id)
      .is('consumed_at', null);
    if (consumeError) throw consumeError;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, message: 'Email verified. Your practice account is ready.', email: challenge.email });
  } catch (err) {
    console.error('[AUTH] Email OTP verification failed:', err.message);
    return res.status(500).json({ success: false, message: 'Email verification is temporarily unavailable. Please try again.' });
  }
});

router.post('/resend-email-otp', async (req, res) => {
  if (!requireSupabase(res)) return;
  const verificationId = typeof req.body?.verificationId === 'string' ? req.body.verificationId.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[0-9a-f-]{36}$/i.test(verificationId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'A valid verification request and email address are required.' });
  }
  try {
    const challenge = await issueEmailOtp({ challengeId: verificationId, email });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, verificationId: challenge.id, expiresIn: EMAIL_OTP_LIFETIME_MINUTES * 60, message: 'A new verification code has been sent.' });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'A new verification code could not be sent. Please try again.' });
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/v1/auth/login
// Authenticates via Supabase. Returns JWT + full profile incl.
// onboarding status so the frontend knows what to show next.
// ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  if (!requireSupabase(res)) return;

  try {
    const { email, password } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || 'client';
    const rateKey = `${ip}_${(email || '').trim().toLowerCase()}`;

    // Rate limit check
    const rateCheck = checkRateLimit(rateKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        rateLimited: true,
        secondsLeft: rateCheck.secondsLeft,
        message: `Too many failed attempts. Please wait ${rateCheck.secondsLeft} seconds before trying again.`
      });
    }

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const { data: supaAuth, error: supaErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (supaErr || !supaAuth?.session) {
      recordFailedAttempt(rateKey);
      const updated = checkRateLimit(rateKey);
      return res.status(401).json({
        success: false,
        remainingAttempts: updated.allowed ? updated.remaining : 0,
        message: supaErr?.message === 'Email not confirmed'
          ? 'Your email address has not been confirmed. Please check your inbox and click the confirmation link.'
          : 'Invalid email or password. Please check your credentials.'
      });
    }

    clearRateLimit(rateKey);

    // Fetch profile from user_profiles table for onboarding status.
    const profile = await fetchUserProfile(supaAuth.user.id);

    return res.json({
      success: true,
      message: 'Login successful.',
      token: supaAuth.session.access_token,
      refreshToken: supaAuth.session.refresh_token,
      user: buildUserResponse(supaAuth.user, profile)
    });

  } catch (err) {
    console.error('[AUTH] Login exception:', err);
    return res.status(500).json({ success: false, message: 'Authentication server error. Please try again.' });
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/v1/auth/refresh
// Exchange a refresh token for a new access token when the short-lived access
// token expires during normal desktop app use.
router.post('/refresh', async (req, res) => {
  if (!requireSupabase(res)) return;

  const refreshToken = typeof req.body?.refreshToken === 'string'
    ? req.body.refreshToken.trim()
    : '';

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'A refresh token is required.' });
  }

  try {
    const { data: refreshed, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !refreshed?.session || !refreshed.user) {
      return res.status(401).json({
        success: false,
        message: 'Session is invalid or has expired. Please log in again.'
      });
    }

    const profile = await fetchUserProfile(refreshed.user.id);
    return res.json({
      success: true,
      message: 'Session refreshed.',
      token: refreshed.session.access_token,
      refreshToken: refreshed.session.refresh_token,
      user: buildUserResponse(refreshed.user, profile)
    });
  } catch (err) {
    console.error('[AUTH] Session refresh exception:', err.message);
    return res.status(401).json({
      success: false,
      message: 'Session is invalid or has expired. Please log in again.'
    });
  }
});

// POST /api/v1/auth/forgot-password
// Sends a password reset email through Supabase Auth's configured email provider.
// ──────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  if (!requireSupabase(res)) return;

  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email address is required.' });

  const resetRedirectTo = String(
    process.env.PASSWORD_RESET_REDIRECT_URL || 'https://orvvexa.vercel.app/reset-password'
  ).trim();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: resetRedirectTo
  });

  if (error) {
    console.warn('[AUTH] Password reset error:', error.message);
  }

  // Always return success to avoid user enumeration
  return res.json({
    success: true,
    message: 'If an account exists for that email, a password reset link has been sent.'
  });
});

router.post('/delete-account/verify', requireAuth, async (req, res) => {
  if (!requireSupabase(res)) return;

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || password.length > 1024 || !req.user.email) {
    return res.status(400).json({ success: false, message: 'Enter your current account password to continue.' });
  }

  const ip = req.ip || req.connection?.remoteAddress || 'client';
  const rateKey = `account-delete_${ip}_${req.user.email.toLowerCase()}`;
  const rateCheck = checkRateLimit(rateKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      rateLimited: true,
      secondsLeft: rateCheck.secondsLeft,
      message: `Too many password attempts. Please wait ${rateCheck.secondsLeft} seconds before trying again.`
    });
  }

  // Use a low-privilege key for password verification when available.
  const isKeyValid = (key) => typeof key === 'string' && key.trim().length > 20 && !key.trim().startsWith('your_') && !key.trim().includes('placeholder');
  const authKey = [
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_SECRET_KEY
  ].find(isKeyValid);

  if (!process.env.SUPABASE_URL || !authKey) {
    return res.status(503).json({
      success: false,
      message: 'Secure password verification is not configured. Ask your administrator to configure the Supabase keys on the backend.'
    });
  }

  try {
    const authClient = createClient(process.env.SUPABASE_URL, authKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: req.user.email,
      password
    });
    if (error || data.user?.id !== req.user.id) {
      recordFailedAttempt(rateKey);
      return res.status(401).json({
        success: false,
        message: 'The password could not be verified. Check it and try again.'
      });
    }

    clearRateLimit(rateKey);
    const now = Math.floor(Date.now() / 1000);
    const challenge = signAccountDeletionChallenge({
      sub: req.user.id,
      exp: now + ACCOUNT_DELETE_CHALLENGE_LIFETIME_SECONDS,
      nonce: crypto.randomBytes(24).toString('base64url')
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      success: true,
      challenge,
      expiresIn: ACCOUNT_DELETE_CHALLENGE_LIFETIME_SECONDS,
      token: data.session?.access_token,
      refreshToken: data.session?.refresh_token
    });
  } catch (error) {
    console.error('[AUTH] Account deletion password verification failed:', error.message);
    return res.status(503).json({
      success: false,
      message: 'Password verification is temporarily unavailable. Please try again.'
    });
  }
});

router.post('/delete-account/confirm', async (req, res) => {
  if (!requireSupabase(res)) return;
  const storageBucket = String(process.env.SUPABASE_STORAGE_BUCKET || '').trim();
  if (!storageBucket) {
    return res.status(503).json({
      success: false,
      message: 'Account deletion is not configured to clean private cloud files. Ask your administrator to set SUPABASE_STORAGE_BUCKET on the backend.'
    });
  }
  if (req.body?.confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
    return res.status(400).json({
      success: false,
      message: `Type ${ACCOUNT_DELETE_CONFIRMATION} exactly to confirm permanent account deletion.`
    });
  }
  // Extract user ID from the cryptographically-signed deletion challenge.
  // This avoids requiring a live Supabase session for the final deletion step.
  const userId = decodeChallengeSub(req.body?.challenge);
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'The password verification expired or is invalid. Verify your password again.'
    });
  }

  try {
    const { deletedObjectCount } = await deleteAccountStorage(
      supabase,
      userId,
      storageBucket
    );
    const { deletedSecretCount } = await deleteAccountVaultSecrets(supabase, userId);
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      console.error(`[AUTH] Account database deletion failed for ${userId}:`, error.message);
      return res.status(500).json({
        success: false,
        message: 'Private cloud files were removed, but database account deletion did not finish. Your account remains active; verify the database foreign-key constraints and retry deletion.'
      });
    }

    console.info(`[AUTH] Account ${userId} permanently deleted; removed ${deletedObjectCount} private cloud object(s) and ${deletedSecretCount} integration secret(s).`);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      success: true,
      message: 'Your account and account-owned cloud data were permanently deleted.',
      data: { deletedObjectCount, deletedSecretCount }
    });
  } catch (error) {
    console.error(`[AUTH] Account deletion failed before auth removal for ${userId}:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Account deletion did not finish. Your sign-in account was not deleted; some private cloud files or integration secrets may already have been removed. Retry, or contact support if the problem continues.'
    });
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/auth/me
// Validates the bearer JWT with Supabase and returns the
// full user profile including onboarding state.
// ──────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  if (!requireSupabase(res)) return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired. Please log in again.' });
  }

  const profile = await fetchUserProfile(data.user.id);

  return res.json({
    success: true,
    user: buildUserResponse(data.user, profile)
  });
});

// Mark the user's profile and initial client setup as complete.
router.post('/onboarding-complete', async (req, res) => {
  if (!requireSupabase(res)) return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];

  // Verify the JWT
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' });
  }

  // Keep the onboarding marker but never persist a machine-specific folder path.
  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ onboarding_complete: true, updated_at: new Date().toISOString() })
    .eq('id', data.user.id);

  if (updateErr) {
    console.error('[AUTH] Onboarding completion save error:', updateErr.message);
    return res.status(500).json({ success: false, message: 'Failed to complete onboarding. Please try again.' });
  }

  console.log(`[AUTH] Onboarding completed for user ${data.user.id}.`);
  return res.json({
    success: true,
    message: 'Onboarding completed.'
  });
});

// ──────────────────────────────────────────────────────────
// PATCH /api/v1/auth/profile
// Update personal profile fields (name, practiceType, membershipNo)
// ──────────────────────────────────────────────────────────
router.patch('/profile', async (req, res) => {
  if (!requireSupabase(res)) return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const { name, practiceType, membershipNo } = req.body;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' });
  }

  const updates = {};
  if (name) updates.full_name = name.trim();
  if (practiceType) {
    const cleanPracticeType = practiceType.trim();
    if (!ALLOWED_PRACTICE_TYPES.has(cleanPracticeType)) {
      return res.status(400).json({ success: false, message: 'Practice category must be Chartered Accountant (CA) or Individual.' });
    }
    updates.practice_type = cleanPracticeType;
  }
  if (membershipNo !== undefined) updates.membership_no = membershipNo ? membershipNo.trim() : null;
  updates.updated_at = new Date().toISOString();

  const { data: updatedProfile, error: updateErr } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', data.user.id)
    .select()
    .single();

  if (updateErr) {
    console.error('[AUTH] Profile update error:', updateErr.message);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }

  return res.json({
    success: true,
    message: 'Profile updated successfully.',
    user: buildUserResponse(data.user, updatedProfile)
  });
});

module.exports = router;
