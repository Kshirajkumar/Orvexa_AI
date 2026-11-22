const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, {
  fetchImpl = fetch,
  timeoutMs = 30_000,
  maxAttempts = 2,
  retryDelayMs = 250,
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (response.ok || !RETRYABLE_PROVIDER_STATUSES.has(response.status) || attempt === maxAttempts) {
        return response;
      }
      lastError = new Error(`Provider returned retryable status ${response.status}.`);
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') {
        lastError = Object.assign(new Error('The AI provider took too long to respond.'), { code: 'PROVIDER_TIMEOUT' });
      }
      if (attempt === maxAttempts) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
    await wait(retryDelayMs * attempt);
  }

  throw lastError || new Error('The AI provider could not be reached.');
}

module.exports = { fetchWithRetry, RETRYABLE_PROVIDER_STATUSES };
