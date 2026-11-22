const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to apply the client deletion migration.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const migration of [
      'client_deletion_relationships.sql',
      'client_deletion_cleanup.sql',
      'document_file_activity_client_delete_fix.sql',
      'backend_worker_permissions.sql'
    ]) {
      await client.query(await fs.readFile(path.join(__dirname, migration), 'utf8'));
    }
    await client.query('commit');
    console.log('Client deletion relationship and portal Auth cleanup migrations applied successfully.');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  if (error.code === '28P01') {
    console.error('Supabase rejected the PostgreSQL login. Use the current complete DATABASE_URL from Dashboard → Connect. This command did not apply the migration.');
  }
  console.error(error.message || error);
  process.exitCode = 1;
});
