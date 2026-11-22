const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchWithRetry } = require('../lib/providerRequest');

test('provider requests retry transient HTTP failures once', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://provider.test', {}, {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? new Response('busy', { status: 503 }) : new Response('{}', { status: 200 });
    },
    retryDelayMs: 0,
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('provider requests do not retry non-transient client failures', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://provider.test', {}, {
    fetchImpl: async () => {
      calls += 1;
      return new Response('bad request', { status: 400 });
    },
    retryDelayMs: 0,
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
});

test('provider request timeouts are classified after the configured attempts', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry('https://provider.test', {}, {
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        calls += 1;
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
      timeoutMs: 1,
      maxAttempts: 2,
      retryDelayMs: 0,
    }),
    error => error.code === 'PROVIDER_TIMEOUT'
  );
  assert.equal(calls, 2);
});
