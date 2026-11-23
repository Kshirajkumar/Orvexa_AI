const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAndValidateExtractionOutput,
  processDocumentExtraction,
  MockProviderAdapter,
} = require('../lib/extractionEngine');

test('parseAndValidateExtractionOutput parses valid JSON and populates extraction fields', () => {
  const samplePayload = {
    document_type: 'Invoice',
    document_date: '2026-04-14',
    names: [{ type: 'supplier', value: 'ABC Corp' }],
    identifiers: { invoice_number: 'INV-1001' },
    amounts: { total: 1500, subtotal: 1271.19 },
    line_items: [],
    other_fields: [],
    unreadable_fields: [],
    model_overall_confidence: 0.95,
  };

  const { extractedData, providerPayload } = parseAndValidateExtractionOutput(JSON.stringify(samplePayload), 'General');
  assert.equal(extractedData.document_type, 'Invoice');
  assert.equal(extractedData.identifiers.invoice_number, 'INV-1001');
  assert.equal(providerPayload.model_overall_confidence, 0.95);
});

test('parseAndValidateExtractionOutput rejects empty or non-string inputs with status 502', () => {
  assert.throws(() => parseAndValidateExtractionOutput('', 'General'), {
    status: 502,
    message: /no usable text/i,
  });
  assert.throws(() => parseAndValidateExtractionOutput('   ', 'General'), {
    status: 502,
    message: /no usable text/i,
  });
});

test('parseAndValidateExtractionOutput rejects malformed JSON with status 502', () => {
  assert.throws(() => parseAndValidateExtractionOutput('not a json string', 'General'), {
    status: 502,
    message: /did not match the required format/i,
  });
});

test('processDocumentExtraction executes end-to-end with MockProviderAdapter', async () => {
  const sampleData = {
    document_type: 'Invoice',
    document_date: '2026-04-14',
    names: [{ type: 'supplier', value: 'ABC Corp' }],
    identifiers: { invoice_number: 'INV-1001' },
    amounts: { total: 1500 },
    line_items: [],
    other_fields: [],
    unreadable_fields: [],
  };

  const mockAdapter = new MockProviderAdapter(sampleData);
  const mockDocument = {
    id: '11111111-1111-4111-8111-111111111111',
    client_id: '22222222-2222-4222-8222-222222222222',
    file_name: 'test.pdf',
    mime_type: 'application/pdf',
    storage_bucket: 'documents',
    storage_object_path: 'test/path.pdf',
    assessment_year: '2026-27',
  };

  const fakeDownload = async () => Buffer.from('mock pdf binary content');
  const fakeSupabase = {
    rpc: async (name, params) => {
      assert.equal(name, 'save_extraction_version');
      return { data: { version_number: 1, id: 'v-1' }, error: null };
    },
  };

  const result = await processDocumentExtraction({
    userId: 'user-123',
    document: mockDocument,
    category: 'General',
    providerAdapter: mockAdapter,
    downloadFn: fakeDownload,
    supabaseClient: fakeSupabase,
    extractionRunId: 'run-1',
  });

  assert.equal(result.extractedData.document_type, 'Invoice');
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 50);
  assert.equal(result.providerRequestId, 'mock-request-id-123');
  assert.equal(result.versionResult.version.version_number, 1);
  assert.equal(result.versionResult.envelope.extraction_run_id, 'run-1');
});

test('processDocumentExtraction rejects unsupported categories with status 422', async () => {
  const mockAdapter = new MockProviderAdapter({});
  const mockDocument = { id: 'doc-1' };

  await assert.rejects(
    () => processDocumentExtraction({
      userId: 'user-123',
      document: mockDocument,
      category: 'UnsupportedCategory123',
      providerAdapter: mockAdapter,
    }),
    { status: 422, message: /not supported yet/ }
  );
});
