-- Supabase/PostgreSQL function equivalents for SQL Server stored procedures

create or replace function fn_has_permission(
  p_tenant_id integer,
  p_user_id integer,
  p_permission_code text
)
returns boolean
language plpgsql
as $$
declare
  v_perm_id integer;
begin
  select permission_id into v_perm_id
  from permissions
  where code = p_permission_code;

  if v_perm_id is null then
    return false;
  end if;

  return exists (
    select 1
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    where ur.tenant_id = p_tenant_id
      and ur.user_id = p_user_id
      and rp.permission_id = v_perm_id
  );
end;
$$;

create or replace function sp_register_owner(
  p_email text,
  p_full_name text,
  p_password_hash bytea,
  p_password_salt bytea,
  p_business_type_code text,
  p_tenant_name text
)
returns table (tenant_id integer, user_id integer, role_id integer)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_bt_id integer;
  v_tenant_id integer;
  v_user_id integer;
  v_role_id integer;
begin
  select business_type_id into v_bt_id
  from business_types
  where code = p_business_type_code;

  if v_bt_id is null then
    raise exception 'Invalid BusinessTypeCode';
  end if;

  insert into tenants(name, business_type_id)
  values (p_tenant_name, v_bt_id)
  returning tenants.tenant_id into v_tenant_id;

  select users.user_id into v_user_id
  from users
  where email = p_email;

  if v_user_id is null then
    insert into users(email, full_name, password_hash, password_salt)
    values (p_email, p_full_name, p_password_hash, p_password_salt)
    returning users.user_id into v_user_id;
  end if;

  insert into company_users(tenant_id, user_id, title, is_owner)
  values (v_tenant_id, v_user_id, 'Owner', true)
  on conflict (tenant_id, user_id) do nothing;

  insert into roles(tenant_id, name, is_system)
  values (v_tenant_id, 'Owner', false)
  returning roles.role_id into v_role_id;

  insert into role_permissions(role_id, permission_id)
  select v_role_id, p.permission_id
  from permissions p
  on conflict do nothing;

  insert into user_roles(tenant_id, user_id, role_id)
  values (v_tenant_id, v_user_id, v_role_id)
  on conflict do nothing;

  insert into audit_logs(tenant_id, user_id, action, entity, details)
  values (v_tenant_id, v_user_id, 'RegisterOwner', 'Tenant', p_tenant_name);

  return query
  select v_tenant_id, v_user_id, v_role_id;
end;
$$;

create or replace function sp_create_employee(
  p_tenant_id integer,
  p_email text,
  p_full_name text default null,
  p_password_hash bytea default null,
  p_password_salt bytea default null,
  p_role_name text default null,
  p_title text default null
)
returns table (user_id integer, role_id integer)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_user_id integer;
  v_role_id integer;
begin
  if not exists(select 1 from tenants where tenant_id = p_tenant_id) then
    raise exception 'Invalid TenantId';
  end if;

  select users.user_id into v_user_id
  from users
  where email = p_email;

  if v_user_id is null then
    if p_password_hash is null or p_password_salt is null then
      raise exception 'Password required for new user';
    end if;

    insert into users(email, full_name, password_hash, password_salt)
    values (p_email, p_full_name, p_password_hash, p_password_salt)
    returning users.user_id into v_user_id;
  end if;

  insert into company_users(tenant_id, user_id, title, is_owner)
  values (p_tenant_id, v_user_id, coalesce(p_title, ''), false)
  on conflict (tenant_id, user_id) do nothing;

  v_role_id := null;

  if p_role_name is not null then
    select roles.role_id into v_role_id
    from roles
    where roles.tenant_id = p_tenant_id
      and roles.name = p_role_name;

    if v_role_id is null then
      insert into roles(tenant_id, name, is_system)
      values (p_tenant_id, p_role_name, false)
      returning roles.role_id into v_role_id;
    end if;

    insert into user_roles(tenant_id, user_id, role_id)
    values (p_tenant_id, v_user_id, v_role_id)
    on conflict do nothing;
  end if;

  insert into audit_logs(tenant_id, user_id, action, entity, details)
  values (p_tenant_id, v_user_id, 'CreateEmployee', 'User', p_email);

  return query
  select v_user_id, v_role_id;
end;
$$;

create or replace function sp_grant_role_permissions(
  p_role_id integer,
  p_permission_codes text[]
)
returns void
language plpgsql
as $$
begin
  insert into role_permissions(role_id, permission_id)
  select p_role_id, p.permission_id
  from permissions p
  where p.code = any(p_permission_codes)
  on conflict do nothing;
end;
$$;

create or replace function sp_create_role(
  p_tenant_id integer,
  p_role_name text,
  p_permission_codes text[] default '{}'
)
returns integer
language plpgsql
as $$
declare
  v_role_id integer;
begin
  select role_id into v_role_id
  from roles
  where tenant_id = p_tenant_id
    and name = p_role_name;

  if v_role_id is null then
    insert into roles(tenant_id, name, is_system)
    values (p_tenant_id, p_role_name, false)
    returning role_id into v_role_id;
  end if;

  perform sp_grant_role_permissions(v_role_id, p_permission_codes);
  return v_role_id;
end;
$$;

create or replace function sp_assign_user_role(
  p_tenant_id integer,
  p_user_id integer,
  p_role_id integer
)
returns text
language plpgsql
as $$
begin
  insert into user_roles(tenant_id, user_id, role_id)
  values (p_tenant_id, p_user_id, p_role_id)
  on conflict do nothing;

  return 'OK';
end;
$$;
