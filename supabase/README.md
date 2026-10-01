# Supabase migration (SQL Server -> PostgreSQL)

This folder contains a working migration kit for your app.

## Files

- `01_schema.sql` → full PostgreSQL schema for core + CRM + HR + accounting + chat/email tables
- `02_functions.sql` → PostgreSQL function equivalents for your current SQL Server procedures
- `03_seed.sql` → seed data (business types, modules, permissions)
- `04_safety_schema.sql` → PostgreSQL schema for the Safety domain (fire/gas/electrical/boiler/
  structural inspections, DSA, consultant engagement, safety audits/RFQ/training/grievances/
  incidents/documents, water/waste management) — generated from SQL Server introspection since
  this domain wasn't covered by the original schema kit. Source tables have no FK constraints,
  check constraints, triggers, or views (confirmed via `sys.foreign_keys` / `sys.check_constraints`
  / `sys.triggers` / `sys.views`), so none were invented on the Postgres side either. Unique
  constraints and non-unique indexes that did exist in SQL Server were carried over.

## 1) Required env vars

Add these to your `.env`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` (direct Postgres connection string)
- existing SQL Server vars for source migration:
  - `AZURE_SQL_SERVER`
  - `AZURE_SQL_DATABASE`
  - `AZURE_SQL_USERNAME`
  - `AZURE_SQL_PASSWORD`

## 2) Apply schema to Supabase

Run:

`node scripts/setup-supabase.js`

(applies `01_schema.sql`, `02_functions.sql`, `03_seed.sql`, `04_safety_schema.sql` in order)

## 3) Copy existing data from SQL Server

Run:

`node scripts/migrate-sqlserver-to-supabase.js`

This script:
- reads all `dbo` tables from SQL Server
- matches to PostgreSQL tables by normalized name
- maps matching columns automatically
- bulk inserts in batches

## 4) Connect app code to Supabase

Use helper module:

- `src/db/supabase.js`

Auth/membership/permission routes are now feature-flagged for Supabase in the main server:

- Set `ENABLE_SUPABASE_AUTH=1` to use Supabase for auth-related flows
- Keep unset (default) to continue SQL Server auth

Converted paths include:

- register/login/verify-2fa
- verify-email/manual-verify
- auth/me, switch-tenant
- 2fa status/setup/enable/disable
- membership and permission middleware

For full runtime cutover, SQL Server-specific query syntax in `src/web-server.js` (e.g., `TOP`, `MERGE`, `SCOPE_IDENTITY()`, `@params`) must be converted to PostgreSQL syntax.

## 5) Recommended cutover plan

1. Deploy schema + seed to Supabase
2. Run data migration
3. Run app in dual-write mode (optional)
4. Switch read paths endpoint-by-endpoint
5. Disable SQL Server after verification
