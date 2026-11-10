const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_STORAGE_BUCKET = 'taxflow-intake';
const {
  getStorageObjectKey,
  getVersionStorageObjectKey,
  isExpectedDocumentObject,
  isOwnedDocumentObject
} = require('../lib/documentStorage');

const identifiers = {
  userId: '11752602-62fa-4252-ae1d-23c4fb3b7312',
  clientId: '20314145-9020-45f0-85a0-68bc63eb359e',
  documentId: '3d6c6d22-76d9-4be2-98db-375845a5bba0'
};

test('document object keys separate Raw, Extracted, and Generated documents', () => {
  const keyFor = category => getStorageObjectKey({
    ...identifiers,
    year: '2026',
    month: 'October',
    category,
    fileName: 'tax.pdf'
  });

  assert.equal(keyFor('General'), `${identifiers.userId}/${identifiers.clientId}/2026/October/Raw/${identifiers.documentId}_tax.pdf`);
  assert.equal(keyFor('Extracted'), `${identifiers.userId}/${identifiers.clientId}/2026/October/Extracted/${identifiers.documentId}_tax.pdf`);
  assert.equal(keyFor('Generated'), `${identifiers.userId}/${identifiers.clientId}/2026/October/Generated/${identifiers.documentId}_tax.pdf`);
});

test('document object validation requires the category-matched storage path', () => {
  const document = {
    ...identifiers,
    bucket: 'taxflow-intake',
    createdAt: '2026-10-18T12:00:00.000Z',
    fileName: 'tax.pdf',
    category: 'General'
  };
  const rawKey = getStorageObjectKey({
    ...identifiers,
    year: '2026',
    month: 'October',
    category: 'General',
    fileName: 'tax.pdf'
  });

  assert.equal(isExpectedDocumentObject({ ...document, objectKey: rawKey }), true);
  assert.equal(isExpectedDocumentObject({ ...document, objectKey: rawKey.replace('/Raw/', '/Extracted/') }), false);
});

test('owned document paths remain valid after metadata category changes', () => {
  const objectKey = getStorageObjectKey({
    ...identifiers,
    year: '2026',
    month: 'October',
    category: 'General',
    fileName: 'tax.pdf'
  });

  assert.equal(isOwnedDocumentObject({
    bucket: 'taxflow-intake',
    objectKey,
    ...identifiers
  }), true);
});

test('version object paths remain scoped to their user, client, and document', () => {
  const versionId = 'c0d0b41e-0aab-4a80-a455-a4373b48dc81';
  const objectKey = getVersionStorageObjectKey({ ...identifiers, versionId, fileName: 'tax.pdf' });
  const expected = `${identifiers.userId}/${identifiers.clientId}/documents/${identifiers.documentId}/${versionId}_tax.pdf`;

  assert.equal(objectKey, expected);
  assert.equal(isOwnedDocumentObject({ bucket: 'taxflow-intake', objectKey, ...identifiers }), true);
  assert.equal(isOwnedDocumentObject({ bucket: 'other-bucket', objectKey, ...identifiers }), false);
  assert.equal(isOwnedDocumentObject({ bucket: 'taxflow-intake', objectKey, ...identifiers, clientId: '20314145-9020-45f0-85a0-68bc63eb359f' }), false);
});
