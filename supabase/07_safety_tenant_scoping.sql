-- Give every top-level safety / water / waste / checklist table a tenant_id so
-- each company only sees its own records. Child tables (audit items,
-- corrective actions, RFQ quotes/invoices, training attendees, …) are scoped
-- through their parent row and need no column of their own.
--
-- Existing rows predate multi-tenant scoping and belong to the original
-- tenant (1); they are assigned to it before the column becomes required.
-- Safe to re-run.

do $$
declare
  t text;
begin
  foreach t in array array[
    'safety_incidents', 'safety_grievances',
    'safety_checklist_headings', 'safety_checklist_items',
    'water_buying', 'water_rain_collection', 'water_usage',
    'water_discharge_quality', 'water_recycling', 'water_waste',
    'waste_management'
  ] loop
    execute format('alter table %I add column if not exists tenant_id integer', t);
    execute format('update %I set tenant_id = 1 where tenant_id is null', t);
    execute format('alter table %I alter column tenant_id set not null', t);
    execute format('create index if not exists %I on %I(tenant_id)', 'ix_' || t || '_tenant', t);
  end loop;
end $$;

-- Uniqueness must now be per tenant, otherwise one company's heading or
-- invoice number would block another company from using the same value.
do $$
declare
  c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where con.contype = 'u'
       and rel.relname in ('safety_checklist_headings', 'water_buying')
       and not exists (
         select 1 from unnest(con.conkey) k
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k
          where a.attname = 'tenant_id')
  loop
    execute format('alter table %I drop constraint %I', c.relname, c.conname);
  end loop;
end $$;

create unique index if not exists ux_safety_checklist_headings_tenant_tab_slug
  on safety_checklist_headings(tenant_id, tab_id, heading_slug);
create unique index if not exists ux_water_buying_tenant_invoice
  on water_buying(tenant_id, invoice_number);
