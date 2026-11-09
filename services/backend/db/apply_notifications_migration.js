const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  let connString = process.env.DATABASE_URL;
  if (!connString) {
    console.warn('[Migration] DATABASE_URL is not set in .env.');
    console.log('[Migration] You can run the SQL script manually in the Supabase SQL Editor:');
    console.log(path.join(__dirname, 'create_notifications.sql'));
    return;
  }

  // Handle URL encoding for passwords with '@' if unencoded
  // e.g. postgres://user:pass@word@host:5432/db -> encode pass
  const match = connString.match(/^postgresql:\/\/([^:]+):(.*)@([^@]+)$/);
  if (match) {
    const [, user, pass, rest] = match;
    if (pass.includes('@') && !pass.includes('%40')) {
      connString = `postgresql://${user}:${encodeURIComponent(pass)}@${rest}`;
    }
  }

  const pool = new Pool({ connectionString: connString, max: 1 });
  let client;
  try {
    client = await pool.connect();
    const sql = await fs.readFile(path.join(__dirname, 'create_notifications.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ Notifications table, indexes, and triggers applied successfully to Supabase DB!');
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    if (error.code === '28P01' || error.message?.includes('authentication failed')) {
      console.warn('\nTip: Please verify your Supabase database password in services/backend/.env.');
      console.warn('Alternatively, run services/backend/db/create_notifications.sql directly in the Supabase Dashboard SQL Editor.\n');
    }
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

