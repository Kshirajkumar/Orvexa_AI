const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://route-resilience-tests.supabase.co';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'sb_secret_route_resilience_test_key';

const database = require('../db/supabase');
const whatsappRouter = require('../routes/whatsapp');
const telegramRouter = require('../routes/telegram');

test('WhatsApp messages returns empty list for user with no clients and 503 when table is missing', async (t) => {
  const oldFrom = database.supabase.from;
  const oldGetUser = database.supabase.auth.getUser;

  let clientsReturnEmpty = true;
  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'ca-user-1', app_metadata: { role: 'ca' } } },
    error: null,
  });
  database.supabase.from = (table) => {
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({
            is: async () => ({
              data: clientsReturnEmpty ? [] : [{ id: 'client-1' }],
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'whatsapp_messages') {
      return {
        select: () => ({
          in: () => ({
            order: async () => ({
              data: null,
              error: { code: 'PGRST205', message: "Could not find the table 'public.whatsapp_messages' in the schema cache" },
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  };

  const app = express();
  app.use('/api/v1/whatsapp', whatsappRouter);
  const server = app.listen(0);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.auth.getUser = oldGetUser;
  });

  const emptyRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/whatsapp/messages`, {
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(emptyRes.status, 200);
  const emptyBody = await emptyRes.json();
  assert.deepEqual(emptyBody.data, []);

  clientsReturnEmpty = false;
  const missingTableRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/whatsapp/messages`, {
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(missingTableRes.status, 503);
  const missingBody = await missingTableRes.json();
  assert.equal(missingBody.success, false);
});

test('Telegram status retries transient getMe failure and deduplicates concurrent requests', async (t) => {
  const oldFrom = database.supabase.from;
  const oldGetUser = database.supabase.auth.getUser;
  const oldFetch = global.fetch;
  const oldBotToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_TOKEN';

  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'ca-user-1', app_metadata: { role: 'ca' } } },
    error: null,
  });
  database.supabase.from = () => ({
    select: () => ({
      limit: async () => ({ data: [{ id: '1' }], error: null }),
    }),
  });

  let getMeAttempts = 0;
  let getWebhookInfoAttempts = 0;
  global.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) {
      return oldFetch(url, options);
    }
    if (target.endsWith('/getMe')) {
      getMeAttempts += 1;
      if (getMeAttempts === 1) {
        throw new Error('Temporary network blip');
      }
      return new Response(JSON.stringify({ ok: true, result: { id: 1, username: 'test_bot', first_name: 'Test' } }));
    }
    if (target.endsWith('/getWebhookInfo')) {
      getWebhookInfoAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(JSON.stringify({ ok: true, result: { url: '', pending_update_count: 0 } }));
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  const app = express();
  app.use('/api/v1/telegram', telegramRouter);
  const server = app.listen(0);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.auth.getUser = oldGetUser;
    global.fetch = oldFetch;
    if (oldBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldBotToken;
  });

  const url = `http://127.0.0.1:${server.address().port}/api/v1/telegram/status`;
  const [res1, res2] = await Promise.all([
    fetch(url, { headers: { Authorization: 'Bearer valid-token' } }),
    fetch(url, { headers: { Authorization: 'Bearer valid-token' } }),
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(getMeAttempts, 2);
  assert.equal(getWebhookInfoAttempts, 1);
});


const clientPortalRouter = require('../routes/clientPortal');

test('Telegram link creation falls back to cached bot username when getMe fails after status', async (t) => {
  const oldFrom = database.supabase.from;
  const oldGetUser = database.supabase.auth.getUser;
  const oldFetch = global.fetch;
  const oldBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldBotUsername = process.env.TELEGRAM_BOT_USERNAME;
  const oldPortalUrl = process.env.CLIENT_PORTAL_URL;
  process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_TOKEN';
  delete process.env.TELEGRAM_BOT_USERNAME;
  process.env.CLIENT_PORTAL_URL = 'https://portal.example.com';

  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'ca-user-1', app_metadata: { role: 'ca' } } },
    error: null,
  });
  database.supabase.from = (table) => {
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({ data: { id: 'client-1' }, error: null }),
              }),
              maybeSingle: async () => ({ data: { id: 'client-1', email: 'client@example.com', status: 'Active' }, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'telegram_link_tokens') {
      return {
        insert: async () => ({ error: null }),
      };
    }
    return {
      select: () => ({ limit: async () => ({ data: [{ id: '1' }], error: null }) }),
    };
  };

  let failGetMe = false;
  global.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return oldFetch(url, options);
    if (target.endsWith('/getMe')) {
      if (failGetMe) throw new Error('Telegram API unreachable');
      return new Response(JSON.stringify({ ok: true, result: { id: 1, username: 'cached_orvexa_bot', first_name: 'Orvexa' } }));
    }
    if (target.endsWith('/getWebhookInfo')) {
      return new Response(JSON.stringify({ ok: true, result: { url: '', pending_update_count: 0 } }));
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  const app = express();
  app.use('/api/v1/telegram', telegramRouter);
  const server = app.listen(0);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.auth.getUser = oldGetUser;
    global.fetch = oldFetch;
    if (oldBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldBotToken;
    if (oldBotUsername === undefined) delete process.env.TELEGRAM_BOT_USERNAME;
    else process.env.TELEGRAM_BOT_USERNAME = oldBotUsername;
    if (oldPortalUrl === undefined) delete process.env.CLIENT_PORTAL_URL;
    else process.env.CLIENT_PORTAL_URL = oldPortalUrl;
  });

  const statusRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/telegram/status`, {
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(statusRes.status, 200);

  failGetMe = true;
  const linkRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/telegram/clients/client-1/link`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(linkRes.status, 201);
  const linkBody = await linkRes.json();
  assert.match(linkBody.link, /^https:\/\/t\.me\/cached_orvexa_bot\?start=/);
});

test('Client portal invite returns 503 and access degrades gracefully when CLIENT_PORTAL_URL is missing', async (t) => {
  const oldFrom = database.supabase.from;
  const oldGetUser = database.supabase.auth.getUser;
  const oldPortalUrl = process.env.CLIENT_PORTAL_URL;
  delete process.env.CLIENT_PORTAL_URL;

  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'ca-user-1', app_metadata: { role: 'ca' } } },
    error: null,
  });
  database.supabase.from = (table) => {
    if (table === 'clients') {
      const clientRow = { id: 'client-1', name: 'Acme', email: 'client@example.com', status: 'Active', telegram_chat_id: null };
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: clientRow, error: null }),
              is: () => ({
                maybeSingle: async () => ({ data: clientRow, error: null }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === 'client_portal_access') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }
    if (table === 'client_portal_invites') {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              is: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            is: () => ({
              is: async () => ({ error: null }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'invite-1', expires_at: new Date(Date.now() + 86400000).toISOString() },
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  };

  const app = express();
  app.use('/api/v1/client-portal', clientPortalRouter);
  const server = app.listen(0);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.auth.getUser = oldGetUser;
    if (oldPortalUrl === undefined) delete process.env.CLIENT_PORTAL_URL;
    else process.env.CLIENT_PORTAL_URL = oldPortalUrl;
  });

  const inviteRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/client-portal/clients/client-1/invite`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(inviteRes.status, 503);

  const accessRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/client-portal/clients/client-1/access`, {
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(accessRes.status, 200);
  const accessBody = await accessRes.json();
  assert.equal(accessBody.data.portalLink, null);
  assert.match(accessBody.data.warning, /CLIENT_PORTAL_URL/i);
});
