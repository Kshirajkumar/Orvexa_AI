const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'extraction.js'), 'utf8');
const baseSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'extraction_versioning.sql'), 'utf8');
const repairSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'extraction_versioning_digest_fix.sql'), 'utf8');
const runsSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'extraction_runs.sql'), 'utf8');

test('version hashing explicitly qualifies pgcrypto digest and preserves UTF-8 input', () => {
  for (const sql of [baseSql, repairSql]) {
    assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions/);
    assert.match(sql, /extensions\.digest\(convert_to\(p_data::text, 'UTF8'\), 'sha256'\)/);
    assert.doesNotMatch(sql, /encode\(digest\(p_data::text, 'sha256'\), 'hex'\)/);
  }
});

test('extraction failure status is scoped to the verified document client', () => {
  assert.match(routeSource, /if \(ownedDocument && supabase\)/);
  assert.match(routeSource, /\.eq\('id', ownedDocument\.id\)\s*\.eq\('client_id', ownedDocument\.client_id\)/);
  assert.doesNotMatch(routeSource, /\.update\(\{ extraction_status: 'extraction_failed',[\s\S]{0,220}\.eq\('id', documentId\);/);
});

test('successful extraction saves an extraction version for GST and local-key paths', () => {
  assert.doesNotMatch(routeSource, /doc\.category === 'GST' \? null : await saveExtractionVersion/);
  assert.doesNotMatch(routeSource, /document\.category === 'GST' \? null : await saveExtractionVersion/);
  assert.match(routeSource, /const docCategory = doc\.category \|\| category \|\| 'General'/);
});

test('extraction history and restore stay separate from physical file versions', () => {
  assert.match(routeSource, /GET \/api\/v1\/extraction\/versions/);
  assert.match(routeSource, /router\.get\('\/versions\/:documentId\/compare'/);
  assert.match(routeSource, /router\.post\('\/versions\/:documentId\/restore'/);
  assert.match(routeSource, /restore_extraction_version/);
  assert.match(baseSql, /source_data jsonb/);
  assert.match(baseSql, /CREATE OR REPLACE FUNCTION public\.restore_extraction_version/);
  assert.match(repairSql, /CREATE OR REPLACE FUNCTION public\.restore_extraction_version/);
});

test('provider attempts have durable run metadata and usage provenance', () => {
  assert.match(routeSource, /startExtractionRun/);
  assert.match(routeSource, /finishExtractionRun/);
  assert.match(routeSource, /usage_source: 'provider_response'/);
  assert.match(routeSource, /usage_source: 'client_reported'/);
  assert.match(runsSql, /CREATE TABLE IF NOT EXISTS public\.extraction_runs/);
  assert.match(runsSql, /ALTER TABLE public\.ai_usage_log/);
  assert.match(repairSql, /NULLIF\(p_data->>'extraction_run_id', ''\)::uuid/);
});

test('corrected-data approval uses one database transaction boundary', () => {
  const documentsSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'documents.js'), 'utf8');
  assert.match(documentsSource, /approve_extraction_data/);
  assert.doesNotMatch(documentsSource, /correctedData[\s\S]{0,500}\.from\('documents_metadata'\)[\s\S]{0,250}\.update\(\{ extracted_data/);
  for (const sql of [baseSql, repairSql]) {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.approve_extraction_data/);
    assert.match(sql, /SET extracted_data = p_envelope->'source_data'/);
    assert.match(sql, /approved_extraction_version = version_row\.version_number/);
  }
});

test('Gemini extraction delegates timeout cleanup to the shared provider helper', () => {
  assert.match(routeSource, /fetchWithRetry\(/);
  assert.doesNotMatch(routeSource, /clearTimeout\(timeout\)/);
});
