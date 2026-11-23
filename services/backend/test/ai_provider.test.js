const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const aiProviderSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'aiProvider.js'), 'utf8');

test('aiProvider does not call clearTimeout on undeclared timeout variable in finally block', () => {
  assert.doesNotMatch(aiProviderSource, /finally\s*\{\s*clearTimeout\(timeout\);?\s*\}/);
  assert.doesNotMatch(aiProviderSource, /clearTimeout\(timeout\)/);
});

test('generateGeminiChat has proper error handling without ReferenceError', () => {
  assert.match(aiProviderSource, /PROVIDER_TIMEOUT/);
  assert.match(aiProviderSource, /The AI provider took too long to respond/);
  assert.match(aiProviderSource, /The AI provider could not be reached/);
});
