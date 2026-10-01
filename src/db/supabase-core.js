const { createSupabasePgPool } = require('./supabase');

let pool = null;
function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

// ---- Profile ----

async function getProfile(userId, tenantId) {
  const p = getPool();
  const u = await p.query(
    `select user_id as "UserId", email as "Email", full_name as "FullName", cell_phone as "CellPhone",
            designation as "Designation", avatar_url as "AvatarUrl" from users where user_id = $1 limit 1`,
    [userId]
  );
  let title = null;
  if (tenantId) {
    const t = await p.query(`select title from company_users where tenant_id = $1 and user_id = $2 limit 1`, [tenantId, userId]);
    title = t.rows[0]?.title || null;
  }
  const user = u.rows[0] || {};
  return { email: user.Email, fullName: user.FullName, cellPhone: user.CellPhone || '', designation: user.Designation || title || '', avatarUrl: user.AvatarUrl || null };
}

async function updateProfile({ userId, tenantId, fullName, cellPhone, designation }) {
  const p = getPool();
  await p.query(
    `update users set full_name = coalesce($2,full_name), cell_phone = coalesce($3,cell_phone),
       designation = coalesce($4,designation), updated_at = now() where user_id = $1`,
    [userId, fullName || null, cellPhone || null, designation || null]
  );
  if (tenantId && designation) {
    await p.query(`update company_users set title = $3 where tenant_id = $1 and user_id = $2`, [tenantId, userId, designation]);
  }
}

async function changePassword(userId, hash, salt) {
  const p = getPool();
  await p.query(`update users set password_hash = $2, password_salt = $3, updated_at = now() where user_id = $1`, [userId, hash, salt]);
}

async function setAvatarUrl(userId, url) {
  const p = getPool();
  await p.query(`update users set avatar_url = $2 where user_id = $1`, [userId, url]);
}

// ---- Permissions ----

async function listPermissions() {
  const p = getPool();
  const r = await p.query(
    `select p.permission_id as "PermissionId", p.code as "Code", p.description as "Description", m.name as "ModuleName"
     from permissions p left join modules m on m.module_id = p.module_id order by p.code`
  );
  return r.rows;
}

// ---- Tenant management ----

async function tenantIdByOwnerEmail(email) {
  const p = getPool();
  const r = await p.query(
    `select t.tenant_id from users u
     join company_users cu on cu.user_id = u.user_id
     join tenants t on t.tenant_id = cu.tenant_id
     where u.email = $1 order by cu.is_owner desc limit 1`,
    [email]
  );
  return r.rows[0]?.tenant_id || null;
}

async function tenantsByEmail(email) {
  const p = getPool();
  const r = await p.query(
    `select t.tenant_id as "TenantId", t.name as "TenantName", bt.code as "BusinessType"
     from users u
     join company_users cu on cu.user_id = u.user_id
     join tenants t on t.tenant_id = cu.tenant_id
     join business_types bt on bt.business_type_id = t.business_type_id
     where u.email = $1 order by t.name`,
    [email]
  );
  return r.rows;
}

async function tenantSummary(tenantId) {
  const p = getPool();
  const bt = await p.query(
    `select t.tenant_id as "TenantId", t.name as "TenantName", bt.code as "BusinessType"
     from tenants t join business_types bt on bt.business_type_id = t.business_type_id where t.tenant_id = $1`,
    [tenantId]
  );
  const mods = await p.query(`select code as "Code", name as "Name" from modules order by name`);
  const cnt = await p.query(
    `select
       (select count(*) from company_users where tenant_id = $1) as "Employees",
       (select count(*) from customers where tenant_id = $1) as "Customers",
       (select count(*) from suppliers where tenant_id = $1) as "Suppliers",
       (select count(*) from certifications where tenant_id = $1) as "Certifications"`,
    [tenantId]
  );
  return { tenant: bt.rows[0] || null, modules: mods.rows, counts: cnt.rows[0] };
}

async function tenantEmployees(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select cu.company_user_id as "CompanyUserId", u.user_id as "UserId", u.email as "Email", u.full_name as "FullName",
            cu.title as "Title", cu.is_owner as "IsOwner",
            string_agg(r.name, ', ' order by r.name) as "Roles"
     from company_users cu
     join users u on u.user_id = cu.user_id
     left join user_roles ur on ur.tenant_id = cu.tenant_id and ur.user_id = cu.user_id
     left join roles r on r.role_id = ur.role_id
     where cu.tenant_id = $1
     group by cu.company_user_id, u.user_id, u.email, u.full_name, cu.title, cu.is_owner
     order by cu.is_owner desc, u.full_name asc`,
    [tenantId]
  );
  return r.rows;
}

async function createTenantEmployee({ tenantId, email, fullName, passwordHash, passwordSalt, roleName, title }) {
  const p = getPool();
  const r = await p.query(`select * from sp_create_employee($1,$2,$3,$4,$5,$6,$7)`,
    [tenantId, email, fullName || null, passwordHash || null, passwordSalt || null, roleName || null, title || null]);
  return r.rows[0];
}

async function tenantRoles(tenantId) {
  const p = getPool();
  const r = await p.query(`select role_id as "RoleId", name as "Name", is_system as "IsSystem" from roles where tenant_id = $1 order by name`, [tenantId]);
  return r.rows;
}

async function createTenantRole(tenantId, roleName, permissionCodes) {
  const p = getPool();
  const r = await p.query(`select sp_create_role($1,$2,$3) as role_id`, [tenantId, roleName, permissionCodes || []]);
  return { RoleId: r.rows[0].role_id };
}

async function assignUserRole(tenantId, userId, roleId) {
  const p = getPool();
  await p.query(`select sp_assign_user_role($1,$2,$3)`, [tenantId, userId, roleId]);
}

// ---- Support tickets ----

async function listTickets({ userId, tenantId }) {
  const p = getPool();
  const r = await p.query(
    `select ticket_id as "TicketId", tenant_id as "TenantId", created_by as "CreatedBy", subject as "Subject",
            status as "Status", priority as "Priority", created_at as "CreatedAt"
     from tickets where created_by = $1 or tenant_id = $2 order by created_at desc limit 200`,
    [userId, tenantId]
  );
  return r.rows;
}

async function createTicket({ tenantId, userId, subject, message }) {
  const p = getPool();
  const r = await p.query(`insert into tickets(tenant_id, created_by, subject) values ($1,$2,$3) returning ticket_id`, [tenantId || null, userId, subject]);
  const ticketId = r.rows[0].ticket_id;
  await p.query(`insert into ticket_messages(ticket_id, user_id, message) values ($1,$2,$3)`, [ticketId, userId, message]);
  return { TicketId: ticketId };
}

async function addTicketMessage(ticketId, userId, message) {
  const p = getPool();
  await p.query(`insert into ticket_messages(ticket_id, user_id, message) values ($1,$2,$3)`, [ticketId, userId, message]);
}

// ---- Chat ----

async function chatUsers(tenantId) {
  const p = getPool();
  if (tenantId) {
    const r = await p.query(
      `select u.user_id as "UserId", u.full_name as "FullName", u.email as "Email", u.avatar_url as "AvatarUrl"
       from company_users cu join users u on u.user_id = cu.user_id
       where cu.tenant_id = $1 and coalesce(u.is_active, true) = true order by u.full_name`,
      [tenantId]
    );
    return r.rows;
  }
  const r = await p.query(
    `select user_id as "UserId", full_name as "FullName", email as "Email", avatar_url as "AvatarUrl"
     from users where coalesce(is_active, true) = true order by full_name limit 200`
  );
  return r.rows;
}

async function userPrimaryTenant(userId) {
  const p = getPool();
  const r = await p.query(`select tenant_id from company_users where user_id = $1 order by is_owner desc limit 1`, [userId]);
  return r.rows[0]?.tenant_id || null;
}

async function listConversations(userId) {
  const p = getPool();
  const r = await p.query(
    `select c.id as "Id", c.title as "Title", c.created_at as "CreatedAt",
            (select body from messages where conversation_id = c.id order by created_at desc limit 1) as "LastBody",
            (select created_at from messages where conversation_id = c.id order by created_at desc limit 1) as "LastAt"
     from conversations c
     where exists(select 1 from conversation_members m where m.conversation_id = c.id and m.user_id = $1)
     order by coalesce((select created_at from messages where conversation_id = c.id order by created_at desc limit 1), c.created_at) desc`,
    [userId]
  );
  return r.rows;
}

async function createConversation({ title, userId, tenantId, memberIds }) {
  const p = getPool();
  const r = await p.query(`insert into conversations(title, created_by, tenant_id) values ($1,$2,$3) returning id`, [title, userId, tenantId || null]);
  const convId = r.rows[0].id;
  const uniqueIds = Array.from(new Set([userId, ...memberIds]));
  for (const id of uniqueIds) {
    await p.query(`insert into conversation_members(conversation_id, user_id) values ($1,$2)`, [convId, id]);
  }
  return convId;
}

async function isConversationMember(conversationId, userId) {
  const p = getPool();
  const r = await p.query(`select 1 from conversation_members where conversation_id = $1 and user_id = $2`, [conversationId, userId]);
  return r.rows.length > 0;
}

async function getMessages(conversationId) {
  const p = getPool();
  const r = await p.query(
    `select m.id as "Id", m.body as "Body", m.created_at as "CreatedAt", u.user_id as "UserId", u.full_name as "FullName", u.avatar_url as "AvatarUrl"
     from messages m join users u on u.user_id = m.user_id
     where m.conversation_id = $1 order by m.created_at asc`,
    [conversationId]
  );
  return r.rows;
}

async function postMessage(conversationId, userId, body) {
  const p = getPool();
  const r = await p.query(`insert into messages(conversation_id, user_id, body) values ($1,$2,$3) returning id`, [conversationId, userId, body]);
  return r.rows[0].id;
}

// ---- Billing (DB reads/writes only; Stripe API calls stay in web-server.js) ----

async function getSubscription(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select status as "Status", plan_name as "PlanName", credit_balance as "CreditBalance",
            current_period_end as "CurrentPeriodEnd", cancel_at_period_end as "CancelAtPeriodEnd"
     from subscriptions where tenant_id = $1 limit 1`,
    [tenantId]
  );
  return r.rows[0] || { Status: 'none', PlanName: null, CreditBalance: 0, CurrentPeriodEnd: null, CancelAtPeriodEnd: false };
}

async function getStripeCustomerId(tenantId) {
  const p = getPool();
  const r = await p.query(`select stripe_customer_id from subscriptions where tenant_id = $1 limit 1`, [tenantId]);
  return r.rows[0]?.stripe_customer_id || null;
}

async function getUserEmail(userId) {
  const p = getPool();
  const r = await p.query(`select email from users where user_id = $1 limit 1`, [userId]);
  return r.rows[0]?.email || null;
}

async function upsertStripeCustomerId(tenantId, customerId) {
  const p = getPool();
  const existing = await p.query(`select 1 from subscriptions where tenant_id = $1`, [tenantId]);
  if (existing.rows.length) {
    await p.query(`update subscriptions set stripe_customer_id = $2 where tenant_id = $1`, [tenantId, customerId]);
  } else {
    await p.query(`insert into subscriptions(tenant_id, stripe_customer_id, status) values ($1,$2,'inactive')`, [tenantId, customerId]);
  }
}

async function addCredits(tenantId, credits) {
  const p = getPool();
  await p.query(`update subscriptions set credit_balance = credit_balance + $2 where tenant_id = $1`, [tenantId, credits]);
}

async function recordCreditTopUp({ tenantId, sessionId, paymentIntent, credits, amountCents }) {
  const p = getPool();
  await p.query(
    `insert into credit_top_ups(tenant_id, stripe_session_id, stripe_payment_intent, credits, amount_cents, status)
     values ($1,$2,$3,$4,$5,'paid')`,
    [tenantId, sessionId, paymentIntent, credits, amountCents]
  );
}

async function upsertSubscriptionFromStripe({ tenantId, subId, customerId, status, planName, periodEnd, cancelAtEnd }) {
  const p = getPool();
  const existing = await p.query(`select 1 from subscriptions where tenant_id = $1`, [tenantId]);
  if (existing.rows.length) {
    await p.query(
      `update subscriptions set stripe_subscription_id=$2, stripe_customer_id=$3, status=$4, plan_name=$5,
         current_period_end=$6, cancel_at_period_end=$7 where tenant_id = $1`,
      [tenantId, subId, customerId, status, planName, periodEnd, cancelAtEnd]
    );
  } else {
    await p.query(
      `insert into subscriptions(tenant_id, stripe_customer_id, stripe_subscription_id, status, plan_name, current_period_end, cancel_at_period_end)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, customerId, subId, status, planName, periodEnd, cancelAtEnd]
    );
  }
}

async function cancelSubscription(tenantId) {
  const p = getPool();
  await p.query(`update subscriptions set status = 'canceled', stripe_subscription_id = null where tenant_id = $1`, [tenantId]);
}

async function tenantIdForStripeCustomer(customerId) {
  const p = getPool();
  const r = await p.query(`select tenant_id from subscriptions where stripe_customer_id = $1 limit 1`, [customerId]);
  return r.rows[0]?.tenant_id || null;
}

async function recordInvoicePaid({ tenantId, stripeInvoiceId, amountCents, currency, status }) {
  const p = getPool();
  const existing = await p.query(`select 1 from invoices where stripe_invoice_id = $1`, [stripeInvoiceId]);
  if (!existing.rows.length) {
    await p.query(
      `insert into invoices(tenant_id, stripe_invoice_id, amount_cents, currency, status) values ($1,$2,$3,$4,$5)`,
      [tenantId, stripeInvoiceId, amountCents, currency, status]
    );
  }
}

async function markSubscriptionPastDue(tenantId) {
  const p = getPool();
  await p.query(`update subscriptions set status = 'past_due' where tenant_id = $1`, [tenantId]);
}

module.exports = {
  getProfile, updateProfile, changePassword, setAvatarUrl,
  listPermissions,
  tenantIdByOwnerEmail, tenantsByEmail, tenantSummary, tenantEmployees, createTenantEmployee, tenantRoles, createTenantRole, assignUserRole,
  listTickets, createTicket, addTicketMessage,
  chatUsers, userPrimaryTenant, listConversations, createConversation, isConversationMember, getMessages, postMessage,
  getSubscription, getStripeCustomerId, getUserEmail, upsertStripeCustomerId, addCredits, recordCreditTopUp,
  upsertSubscriptionFromStripe, cancelSubscription, tenantIdForStripeCustomer, recordInvoicePaid, markSubscriptionPastDue,
};
