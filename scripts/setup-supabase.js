/*
  Applies Supabase SQL files in order.
  Env required: SUPABASE_DB_URL
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.SUPABASE_DB_URL) {
  throw new Error('SUPABASE_DB_URL is required');
}

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const files = ['01_schema.sql', '02_functions.sql', '03_seed.sql', '04_safety_schema.sql', '05_safety_extra_schema.sql', '06_payroll_tax_schema.sql', '07_safety_tenant_scoping.sql', '08_attendance_face.sql'];

(async () => {
  const client = await pool.connect();
  try {
    for (const f of files) {
      const p = path.join(__dirname, '..', 'supabase', f);
      const sqlText = fs.readFileSync(p, 'utf8');
      console.log(`Applying ${f}...`);
      await client.query(sqlText);
      console.log(`Done ${f}`);
    }
    console.log('Supabase setup complete');
  } finally {
    client.release();
    await pool.end();
  }
})();
