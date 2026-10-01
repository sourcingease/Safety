require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Pool, types } = require('pg');

// node-pg returns NUMERIC/DECIMAL and INT8/BIGINT as strings by default (to
// avoid silent precision loss for values outside the safe JS integer range).
// The SQL Server driver this app was built against returns these as plain
// JS numbers, and the API responses/frontend expect that shape. This app's
// money/decimal and bigint columns (ledger ids, audit ids, etc.) never
// approach the range where that precision loss would matter, so parse both
// as numbers here, once, for every pool created from this module.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric/decimal
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8/bigint

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

function createSupabasePgPool() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL is required');
  }

  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}

module.exports = {
  createSupabaseClient,
  createSupabasePgPool,
};
