const { createSupabasePgPool } = require('./supabase');

let pool = null;
function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

const METHODS = ['annual_slabs', 'percent', 'fixed'];
const CATEGORIES = ['income_tax', 'social_security', 'other'];
const PAYERS = ['employee', 'employer'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

// ---- Calculation (pure) ----

// Annual tax for a progressive slab table: find the slab containing the annual
// income, then fixed + rate% of the income above that slab's lower bound.
function annualSlabTax(annualIncome, slabs) {
  const list = (Array.isArray(slabs) ? slabs : [])
    .map((s) => ({ from: Number(s.from) || 0, to: numOrNull(s.to), fixed: Number(s.fixed) || 0, rate: Number(s.rate) || 0 }))
    .sort((a, b) => a.from - b.from);
  const slab = list.find((s) => annualIncome >= s.from && (s.to === null || annualIncome <= s.to));
  if (!slab) return 0;
  return slab.fixed + (annualIncome - slab.from) * (slab.rate / 100);
}

// Monthly amount for one rule given the employee's monthly gross.
function ruleMonthlyAmount(rule, monthlyGross) {
  if (rule.method === 'annual_slabs') return annualSlabTax(monthlyGross * 12, rule.slabs) / 12;
  if (rule.method === 'percent') {
    const base = rule.base_cap != null ? Math.min(monthlyGross, Number(rule.base_cap)) : monthlyGross;
    let amt = base * ((Number(rule.rate) || 0) / 100);
    if (rule.amount_cap != null) amt = Math.min(amt, Number(rule.amount_cap));
    return amt;
  }
  if (rule.method === 'fixed') return Number(rule.fixed_amount) || 0;
  return 0;
}

// Apply a profile to one employee. Employee flags from pay details can opt out
// of a category: federal_income_tax_yn === false skips income tax,
// fica_eobi === false skips social security.
function computeEmployeeTaxes(profile, monthlyGross, flags = {}) {
  const lines = [];
  for (const rule of (profile && profile.rules) || []) {
    if (rule.category === 'income_tax' && flags.incomeTaxApplies === false) continue;
    if (rule.category === 'social_security' && flags.socialSecurityApplies === false) continue;
    lines.push({ name: rule.name, category: rule.category, payer: rule.payer, amount: round2(ruleMonthlyAmount(rule, monthlyGross)) });
  }
  const sum = (pred) => round2(lines.filter(pred).reduce((s, l) => s + l.amount, 0));
  return {
    lines,
    incomeTax: sum((l) => l.payer === 'employee' && l.category === 'income_tax'),
    socialSecurity: sum((l) => l.payer === 'employee' && l.category === 'social_security'),
    otherEmployee: sum((l) => l.payer === 'employee' && l.category === 'other'),
    employerCost: sum((l) => l.payer === 'employer'),
  };
}

// ---- Validation ----

function validateProfileInput(body) {
  const errors = [];
  const name = (body.name || '').toString().trim();
  const country = (body.country || '').toString().trim();
  const effectiveFrom = (body.effectiveFrom || '').toString().trim();
  if (!name) errors.push('Profile name is required');
  if (!country) errors.push('Country is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) errors.push('Effective from date is required (YYYY-MM-DD)');
  const rules = Array.isArray(body.rules) ? body.rules : [];
  if (!rules.length) errors.push('Add at least one tax rule');
  rules.forEach((r, i) => {
    const label = `Rule ${i + 1}${r.name ? ` (${r.name})` : ''}`;
    if (!(r.name || '').toString().trim()) errors.push(`${label}: name is required`);
    if (!METHODS.includes(r.method)) errors.push(`${label}: method must be one of ${METHODS.join(', ')}`);
    if (r.category && !CATEGORIES.includes(r.category)) errors.push(`${label}: invalid category`);
    if (r.payer && !PAYERS.includes(r.payer)) errors.push(`${label}: invalid payer`);
    if (r.method === 'percent' && numOrNull(r.rate) === null) errors.push(`${label}: rate % is required`);
    if (r.method === 'fixed' && numOrNull(r.fixedAmount) === null) errors.push(`${label}: fixed amount is required`);
    if (r.method === 'annual_slabs') {
      const slabs = Array.isArray(r.slabs) ? r.slabs : [];
      if (!slabs.length) errors.push(`${label}: add at least one slab`);
      const sorted = slabs.map((s) => ({ from: Number(s.from), to: numOrNull(s.to) })).sort((a, b) => a.from - b.from);
      sorted.forEach((s, k) => {
        if (!Number.isFinite(s.from) || s.from < 0) errors.push(`${label}: slab ${k + 1} needs a valid "from"`);
        if (s.to !== null && s.to < s.from) errors.push(`${label}: slab ${k + 1} "to" is below "from"`);
        if (k > 0 && sorted[k - 1].to === null) errors.push(`${label}: only the last slab may be open-ended`);
      });
    }
  });
  return errors;
}

// ---- Data access ----

function mapRule(r) {
  return {
    id: r.id, name: r.name, category: r.category, payer: r.payer, method: r.method,
    rate: numOrNull(r.rate), base_cap: numOrNull(r.base_cap), amount_cap: numOrNull(r.amount_cap),
    fixed_amount: numOrNull(r.fixed_amount), slabs: r.slabs || null, sort_order: r.sort_order,
  };
}

async function attachRules(profiles) {
  if (!profiles.length) return profiles;
  const r = await getPool().query(
    'select * from hr_tax_rule where profile_id = any($1::int[]) order by sort_order, id',
    [profiles.map((p) => p.id)]
  );
  for (const p of profiles) p.rules = r.rows.filter((x) => x.profile_id === p.id).map(mapRule);
  return profiles;
}

const PROFILE_COLS = `p.id, p.tenant_id, p.name, p.country, p.currency, to_char(p.effective_from,'YYYY-MM-DD') as effective_from,
  to_char(p.effective_to,'YYYY-MM-DD') as effective_to, p.is_active, p.source_reference, p.notes,
  p.verified_by, p.verified_at, vu.full_name as verified_by_name, p.created_at, p.updated_at`;

async function listProfiles(tenantId) {
  const r = await getPool().query(
    `select ${PROFILE_COLS} from hr_tax_profile p left join users vu on vu.user_id = p.verified_by
      where p.tenant_id = $1 order by p.is_active desc, p.effective_from desc, p.id desc`,
    [tenantId]
  );
  return attachRules(r.rows);
}

async function getProfile(tenantId, id) {
  const r = await getPool().query(
    `select ${PROFILE_COLS} from hr_tax_profile p left join users vu on vu.user_id = p.verified_by
      where p.tenant_id = $1 and p.id = $2`,
    [tenantId, id]
  );
  return (await attachRules(r.rows))[0] || null;
}

// The active profile covering the given date (latest effective_from wins).
async function getProfileForDate(tenantId, isoDate) {
  const r = await getPool().query(
    `select ${PROFILE_COLS} from hr_tax_profile p left join users vu on vu.user_id = p.verified_by
      where p.tenant_id = $1 and p.is_active
        and p.effective_from <= $2::date and (p.effective_to is null or p.effective_to >= $2::date)
      order by p.effective_from desc, p.id desc limit 1`,
    [tenantId, isoDate]
  );
  return (await attachRules(r.rows))[0] || null;
}

async function saveProfile(tenantId, userId, body, id = null) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const vals = [
      tenantId, body.name.trim(), body.country.trim(), (body.currency || '').trim() || null,
      body.effectiveFrom, (body.effectiveTo || '').trim() || null, body.isActive !== false,
      (body.sourceReference || '').trim() || null, (body.notes || '').trim() || null,
    ];
    let profileId = id;
    if (id) {
      // Any edit clears verification: HR must re-verify the changed setup
      const u = await client.query(
        `update hr_tax_profile set name=$2, country=$3, currency=$4, effective_from=$5, effective_to=$6, is_active=$7,
            source_reference=$8, notes=$9, verified_by=null, verified_at=null, updated_at=now()
          where tenant_id=$1 and id=$10 returning id`,
        [...vals, id]
      );
      if (!u.rows.length) throw Object.assign(new Error('Tax profile not found'), { status: 404 });
      await client.query('delete from hr_tax_rule where profile_id = $1', [id]);
    } else {
      const ins = await client.query(
        `insert into hr_tax_profile(tenant_id, name, country, currency, effective_from, effective_to, is_active, source_reference, notes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [...vals, userId || null]
      );
      profileId = ins.rows[0].id;
    }
    let order = 0;
    for (const r of body.rules) {
      await client.query(
        `insert into hr_tax_rule(profile_id, sort_order, name, category, payer, method, rate, base_cap, amount_cap, fixed_amount, slabs)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [profileId, order++, r.name.trim(), r.category || 'income_tax', r.payer || 'employee', r.method,
          numOrNull(r.rate), numOrNull(r.baseCap), numOrNull(r.amountCap), numOrNull(r.fixedAmount),
          r.method === 'annual_slabs' ? JSON.stringify(r.slabs.map((s) => ({ from: Number(s.from) || 0, to: numOrNull(s.to), fixed: Number(s.fixed) || 0, rate: Number(s.rate) || 0 }))) : null]
      );
    }
    await client.query('commit');
    return profileId;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function verifyProfile(tenantId, id, userId) {
  const r = await getPool().query(
    'update hr_tax_profile set verified_by=$3, verified_at=now() where tenant_id=$1 and id=$2 returning id',
    [tenantId, id, userId]
  );
  return r.rows.length > 0;
}

async function deleteProfile(tenantId, id) {
  const r = await getPool().query('delete from hr_tax_profile where tenant_id=$1 and id=$2 returning id', [tenantId, id]);
  return r.rows.length > 0;
}

async function recordConfirmation(tenantId, period, profileId, userId) {
  await getPool().query(
    'insert into hr_payroll_tax_confirmation(tenant_id, period, profile_id, confirmed_by) values ($1,$2,$3,$4)',
    [tenantId, period, profileId, userId]
  );
}

async function writeAuditLog(tenantId, userId, action, details) {
  await getPool().query(
    `insert into audit_logs(tenant_id, user_id, action, entity, details) values ($1,$2,$3,'TaxProfile',$4)`,
    [tenantId, userId || null, action, details]
  );
}

// Employee opt-out flags used by computeEmployeeTaxes
async function getEmployeeTaxFlags(tenantId) {
  const r = await getPool().query(
    'select employee_id, federal_income_tax_yn, fica_eobi from hr_employee_pay_details where tenant_id = $1',
    [tenantId]
  );
  const map = {};
  for (const row of r.rows) {
    map[row.employee_id] = { incomeTaxApplies: row.federal_income_tax_yn, socialSecurityApplies: row.fica_eobi };
  }
  return map;
}

// Status used for the HR warning banner and to gate payroll generation.
function taxSetupStatus(profile) {
  if (!profile) {
    return { ready: false, level: 'error', message: 'No tax profile covers this payroll period. Set up the taxes for your country before running payroll, otherwise no tax will be withheld.' };
  }
  if (!profile.rules || !profile.rules.length) {
    return { ready: false, level: 'error', message: `Tax profile "${profile.name}" has no rules. Add the tax rules before running payroll.` };
  }
  if (!profile.verified_at) {
    return { ready: false, level: 'error', message: `Tax profile "${profile.name}" has not been verified by HR. Check every rate against the official tax tables, then click Verify.` };
  }
  return { ready: true, level: 'warning', message: `Using tax profile "${profile.name}" (${profile.country}), verified by ${profile.verified_by_name || 'HR'} on ${new Date(profile.verified_at).toLocaleDateString()}. Confirm these taxes are still correct for this period before generating payroll.` };
}

module.exports = {
  annualSlabTax,
  ruleMonthlyAmount,
  computeEmployeeTaxes,
  validateProfileInput,
  listProfiles,
  getProfile,
  getProfileForDate,
  saveProfile,
  verifyProfile,
  deleteProfile,
  recordConfirmation,
  writeAuditLog,
  getEmployeeTaxFlags,
  taxSetupStatus,
};
