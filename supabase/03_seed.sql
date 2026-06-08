-- Seed data equivalent to SQL Server seed

insert into business_types(code, name)
values
  ('Buyer', 'Buyer'),
  ('Manufacturer', 'Manufacturer'),
  ('Supplier', 'Supplier'),
  ('Designer', 'Designer'),
  ('SafetyAuditor', 'Safety Auditor'),
  ('SafetyOffice', 'Safety Office'),
  ('Inspection', 'Inspection')
on conflict (code) do nothing;

insert into modules(code, name)
values
  ('MARKETING', 'Marketing'),
  ('JOB_POSTING', 'Job Posting'),
  ('HR', 'Human Resources'),
  ('WHOLESALE', 'Wholesale'),
  ('RETAIL', 'Retail'),
  ('CRM', 'CRM'),
  ('ACCOUNTING', 'Accounting'),
  ('PROFILE', 'Profile Setup'),
  ('RBAC', 'Roles & Access'),
  ('CERTIFICATION', 'Certifications'),
  ('CUSTOMERS', 'Customers'),
  ('SUPPLIERS', 'Suppliers'),
  ('TASKS', 'Task Management'),
  ('CHAT', 'Chat'),
  ('EMAIL', 'Email')
on conflict (code) do nothing;

insert into permissions(code, description, module_id)
select
  'MODULE_VIEW_' || m.code,
  'View access to ' || m.code,
  m.module_id
from modules m
on conflict (code) do nothing;

insert into permissions(code, description, module_id)
select
  'MODULE_MANAGE_' || m.code,
  'Manage access to ' || m.code,
  m.module_id
from modules m
on conflict (code) do nothing;

insert into permissions(code, description, module_id)
values
  ('TENANT_ADMIN', 'Full administrative access for a tenant', null),
  ('USER_MANAGE', 'Create/update users and roles', null)
on conflict (code) do nothing;
