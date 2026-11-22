const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'backend_worker_permissions.sql'), 'utf8');

test('Render worker permissions cover cleanup and Telegram schedule workers', () => {
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_storage_cleanup_job\(\) TO service_role/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON TABLE public\.storage_cleanup_jobs/);
  assert.match(sql, /GRANT EXECUTE\s+ON FUNCTION public\.claim_due_telegram_message_schedules\(integer\)/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON TABLE public\.telegram_message_schedules/);
});
