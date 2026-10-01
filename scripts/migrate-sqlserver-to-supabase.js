/*
  One-time SQL Server -> Supabase data migration

  Required env:
  - AZURE_SQL_SERVER
  - AZURE_SQL_DATABASE
  - AZURE_SQL_USERNAME
  - AZURE_SQL_PASSWORD
  - SUPABASE_DB_URL (postgresql://postgres:password@host:5432/postgres)

  Optional env:
  - MIGRATION_BATCH_SIZE (default: 500)
*/

require('dotenv').config();
const sql = require('mssql');
const { Pool } = require('pg');

const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || 500);

const sqlServerConfig = {
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user: process.env.AZURE_SQL_USERNAME,
  password: process.env.AZURE_SQL_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

const pgPool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

if (!sqlServerConfig.server || !sqlServerConfig.database || !sqlServerConfig.user || !sqlServerConfig.password) {
  throw new Error('Missing SQL Server env vars (AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USERNAME, AZURE_SQL_PASSWORD)');
}
if (!process.env.SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL');
}

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function pgQuote(id) {
  return '"' + String(id).replace(/"/g, '""') + '"';
}

function buildInsertSql(tableName, columns, rows) {
  const colList = columns.map(pgQuote).join(', ');
  const values = [];
  const placeholders = [];

  let idx = 1;
  for (const row of rows) {
    const rowHolders = [];
    for (const c of columns) {
      rowHolders.push(`$${idx++}`);
      values.push(row[c]);
    }
    placeholders.push(`(${rowHolders.join(', ')})`);
  }

  const sqlText = `insert into ${pgQuote(tableName)} (${colList}) values ${placeholders.join(', ')}`;
  return { sqlText, values };
}

function convertValue(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Date) return v;
  return v;
}

async function getSqlServerTables(pool) {
  const r = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);
  return r.recordset.map((x) => x.TABLE_NAME);
}

async function getSqlServerColumns(pool, table) {
  const r = await pool.request().input('t', sql.NVarChar, table).query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @t
    ORDER BY ORDINAL_POSITION
  `);
  return r.recordset.map((x) => x.COLUMN_NAME);
}

async function getPostgresTables(client) {
  const r = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  return r.rows.map((x) => x.table_name);
}

async function getPostgresColumns(client, table) {
  const r = await client.query(
    `
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = $1
    order by ordinal_position
  `,
    [table]
  );
  return r.rows.map((x) => x.column_name);
}

async function resetIdentityIfAny(client, tableName) {
  const cols = await client.query(
    `
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = $1
      and is_identity = 'YES'
  `,
    [tableName]
  );

  for (const row of cols.rows) {
    const col = row.column_name;
    await client.query(
      `
      select setval(
        pg_get_serial_sequence($1, $2),
        coalesce((select max(${pgQuote(col)}) from ${pgQuote(tableName)}), 1),
        true
      )
    `,
      [tableName, col]
    );
  }
}

(async () => {
  const sqlPool = new sql.ConnectionPool(sqlServerConfig);
  const pgClient = await pgPool.connect();

  try {
    console.log('Connecting SQL Server...');
    await sqlPool.connect();
    console.log('Connected SQL Server');

    console.log('Connected Supabase Postgres');

    const sourceTables = await getSqlServerTables(sqlPool);
    const targetTables = await getPostgresTables(pgClient);

    const targetByNorm = new Map(targetTables.map((t) => [normalize(t), t]));

    // Build the full migration plan first so we know every target table
    // before truncating anything (tables are FK-interdependent, so a
    // truncate-as-we-go approach risks CASCADE wiping already-loaded data).
    const plan = [];
    for (const sourceTable of sourceTables) {
      const targetTable = targetByNorm.get(normalize(sourceTable));
      if (!targetTable) {
        console.log(`Skipping ${sourceTable}: no target table`);
        continue;
      }

      const sourceColumns = await getSqlServerColumns(sqlPool, sourceTable);
      const targetColumns = await getPostgresColumns(pgClient, targetTable);
      const targetByNormCol = new Map(targetColumns.map((c) => [normalize(c), c]));

      const colMap = sourceColumns
        .map((sc) => ({ source: sc, target: targetByNormCol.get(normalize(sc)) }))
        .filter((x) => Boolean(x.target));

      if (colMap.length === 0) {
        console.log(`Skipping ${sourceTable}: no matching columns`);
        continue;
      }

      plan.push({ sourceTable, targetTable, colMap });
    }

    const allTargets = plan.map((p) => pgQuote(p.targetTable)).join(', ');
    console.log(`Truncating ${plan.length} target tables...`);
    await pgClient.query(`truncate table ${allTargets} restart identity cascade`);

    // Disable FK/trigger enforcement for this session so insert order
    // across interdependent tables doesn't matter; restored in finally.
    await pgClient.query(`SET session_replication_role = 'replica'`);

    for (const { sourceTable, targetTable, colMap } of plan) {
      console.log(`Migrating ${sourceTable} -> ${targetTable} (${colMap.length} columns)`);

      let offset = 0;
      while (true) {
        const page = await sqlPool
          .request()
          .input('off', sql.Int, offset)
          .input('lim', sql.Int, BATCH_SIZE)
          .query(`
            SELECT *
            FROM [dbo].[${sourceTable}]
            ORDER BY (SELECT NULL)
            OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY
          `);

        const rows = page.recordset;
        if (!rows.length) break;

        const mappedRows = rows.map((r) => {
          const out = {};
          for (const m of colMap) out[m.target] = convertValue(r[m.source]);
          return out;
        });

        const targetCols = colMap.map((m) => m.target);
        const { sqlText, values } = buildInsertSql(targetTable, targetCols, mappedRows);
        await pgClient.query(sqlText, values);

        offset += rows.length;
        process.stdout.write(`  ${offset}\r`);
      }

      process.stdout.write('\n');
    }

    await pgClient.query(`SET session_replication_role = 'origin'`);

    for (const { targetTable } of plan) {
      await resetIdentityIfAny(pgClient, targetTable);
    }

    console.log('Migration completed');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    try {
      await pgClient.query(`SET session_replication_role = 'origin'`);
    } catch {}
    await sqlPool.close().catch(() => {});
    pgClient.release();
    await pgPool.end().catch(() => {});
  }
})();
