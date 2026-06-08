const { createSupabasePgPool } = require('./supabase');

let pool = null;

function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

function hexToBuffer(hexValue) {
  if (!hexValue) return null;
  return Buffer.from(hexValue, 'hex');
}

async function isMember(tenantId, userId) {
  const p = getPool();
  const r = await p.query(
    `select 1 as ok from company_users where tenant_id = $1 and user_id = $2 limit 1`,
    [tenantId, userId]
  );
  return r.rows.length > 0;
}

async function hasPermission(tenantId, userId, code) {
  const p = getPool();
  const r = await p.query(`select fn_has_permission($1, $2, $3) as allowed`, [tenantId, userId, code]);
  return Boolean(r.rows[0]?.allowed);
}

async function getUserRoleNames(userId, tenantId) {
  const p = getPool();
  const r = await p.query(
    `select r.name from user_roles ur join roles r on r.role_id = ur.role_id where ur.user_id = $1 and ur.tenant_id = $2`,
    [userId, tenantId]
  );
  return r.rows.map((x) => x.name);
}

async function registerOwner({ email, fullName, passwordHash, passwordSalt, businessTypeCode, tenantName }) {
  const p = getPool();
  const r = await p.query(
    `select * from sp_register_owner($1, $2, $3, $4, $5, $6)`,
    [email, fullName, passwordHash, passwordSalt, businessTypeCode, tenantName]
  );
  const row = r.rows[0] || {};
  return {
    TenantId: row.tenant_id,
    UserId: row.user_id,
    RoleId: row.role_id,
  };
}

async function updateUserExtras(userId, extras) {
  const cols = [];
  const vals = [];
  let i = 1;

  if (extras.cellPhone != null) {
    cols.push(`cell_phone = $${i++}`);
    vals.push(extras.cellPhone);
  }
  if (extras.designation != null) {
    cols.push(`designation = $${i++}`);
    vals.push(extras.designation);
  }

  if (!cols.length) return;

  vals.push(userId);
  const p = getPool();
  await p.query(`update users set ${cols.join(', ')}, updated_at = now() where user_id = $${i}`, vals);
}

async function insertEmailVerification(userId, token, expiresAt) {
  const p = getPool();
  await p.query(`insert into email_verifications(user_id, token, expires_at) values ($1, $2, $3)`, [userId, token, expiresAt]);
}

async function verifyUserEmailByUserId(userId) {
  const p = getPool();
  await p.query(`update users set email_verified = true, updated_at = now() where user_id = $1`, [userId]);
}

async function manualVerifyEmailByEmail(email) {
  const p = getPool();
  const r = await p.query(`update users set email_verified = true, updated_at = now() where email = $1`, [email]);
  return r.rowCount || 0;
}

async function getEmailVerificationByToken(token) {
  const p = getPool();
  const r = await p.query(
    `select token_id, user_id, expires_at, used from email_verifications where token = $1 order by created_at desc limit 1`,
    [token]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    TokenId: row.token_id,
    UserId: row.user_id,
    ExpiresAt: row.expires_at,
    Used: row.used,
  };
}

async function markEmailVerificationUsed(tokenId) {
  const p = getPool();
  await p.query(`update email_verifications set used = true where token_id = $1`, [tokenId]);
}

async function getUserById(userId) {
  const p = getPool();
  const r = await p.query(
    `select user_id, email, full_name, is_active from users where user_id = $1 limit 1`,
    [userId]
  );
  const u = r.rows[0];
  if (!u) return null;
  return {
    UserId: u.user_id,
    Email: u.email,
    FullName: u.full_name,
    IsActive: u.is_active,
  };
}

async function getUserByEmailForLogin(email) {
  const p = getPool();
  const r = await p.query(
    `select user_id, email, full_name, is_active, encode(password_hash,'hex') as password_hash_hex, encode(password_salt,'hex') as password_salt_hex
     from users
     where email = $1
     limit 1`,
    [email]
  );
  const u = r.rows[0];
  if (!u) return null;
  return {
    UserId: u.user_id,
    Email: u.email,
    FullName: u.full_name,
    IsActive: u.is_active,
    PasswordHash: hexToBuffer(u.password_hash_hex),
    PasswordSalt: hexToBuffer(u.password_salt_hex),
  };
}

async function getUserAuthById(userId) {
  const p = getPool();
  const r = await p.query(
    `select user_id, email, full_name, is_active, encode(password_hash,'hex') as password_hash_hex, encode(password_salt,'hex') as password_salt_hex
     from users
     where user_id = $1
     limit 1`,
    [userId]
  );
  const u = r.rows[0];
  if (!u) return null;
  return {
    UserId: u.user_id,
    Email: u.email,
    FullName: u.full_name,
    IsActive: u.is_active,
    PasswordHash: hexToBuffer(u.password_hash_hex),
    PasswordSalt: hexToBuffer(u.password_salt_hex),
  };
}

async function getUserTwoFactor(userId) {
  const p = getPool();
  const r = await p.query(`select secret, enabled from user_two_factor where user_id = $1 limit 1`, [userId]);
  const row = r.rows[0];
  if (!row) return null;
  return { Secret: row.secret, Enabled: row.enabled };
}

async function upsertUserTwoFactorSecret(userId, secret) {
  const p = getPool();
  await p.query(
    `insert into user_two_factor(user_id, secret, enabled)
     values ($1, $2, false)
     on conflict (user_id) do update set secret = excluded.secret, enabled = false, last_used_at = null`,
    [userId, secret]
  );
}

async function enableUserTwoFactor(userId) {
  const p = getPool();
  await p.query(`update user_two_factor set enabled = true, last_used_at = now() where user_id = $1`, [userId]);
}

async function disableUserTwoFactor(userId) {
  const p = getPool();
  await p.query(`update user_two_factor set enabled = false where user_id = $1`, [userId]);
}

async function insertLoginOtp(userId, code, expiresAt) {
  const p = getPool();
  await p.query(`insert into login_otps(user_id, code, expires_at) values ($1, $2, $3)`, [userId, code, expiresAt]);
}

async function findActiveOtp(userId, code) {
  const p = getPool();
  const r = await p.query(
    `select id from login_otps where user_id = $1 and code = $2 and consumed = false and expires_at > now() order by created_at desc limit 1`,
    [userId, code]
  );
  return r.rows[0]?.id || null;
}

async function consumeOtp(id) {
  const p = getPool();
  await p.query(`update login_otps set consumed = true where id = $1`, [id]);
}

async function getUserTenants(userId) {
  const p = getPool();
  const r = await p.query(
    `select t.tenant_id as "TenantId", t.name as "TenantName", bt.code as "BusinessType"
     from company_users cu
     join tenants t on t.tenant_id = cu.tenant_id
     join business_types bt on bt.business_type_id = t.business_type_id
     where cu.user_id = $1 and cu.is_active = true
     order by cu.is_owner desc, t.name`,
    [userId]
  );
  return r.rows;
}

module.exports = {
  isMember,
  hasPermission,
  getUserRoleNames,
  registerOwner,
  updateUserExtras,
  insertEmailVerification,
  verifyUserEmailByUserId,
  manualVerifyEmailByEmail,
  getEmailVerificationByToken,
  markEmailVerificationUsed,
  getUserById,
  getUserByEmailForLogin,
  getUserAuthById,
  getUserTwoFactor,
  upsertUserTwoFactorSecret,
  enableUserTwoFactor,
  disableUserTwoFactor,
  insertLoginOtp,
  findActiveOtp,
  consumeOtp,
  getUserTenants,
};
