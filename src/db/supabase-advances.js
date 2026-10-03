// Salary advances and payroll-run bookkeeping (Postgres).
const { createSupabasePgPool } = require('./supabase');

let pool = null;
function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ''));

const ADV_COLS = `a.id as "Id", a.employee_id as "EmployeeId", u.full_name as "EmployeeName", a.amount as "Amount",
  a.installments as "Installments", a.monthly_deduction as "MonthlyDeduction", a.start_period as "StartPeriod",
  a.reason as "Reason", a.status as "Status", a.repaid_amount as "RepaidAmount",
  (a.amount - a.repaid_amount) as "Outstanding", ru.full_name as "RequestedBy", a.requested_by as "RequestedById",
  a.requested_at as "RequestedAt", du.full_name as "DecidedBy", a.decided_at as "DecidedAt", a.decision_note as "DecisionNote"`;
const ADV_FROM = `from hr_salary_advance a
  join company_users cu on cu.company_user_id = a.employee_id and cu.tenant_id = a.tenant_id
  join users u on u.user_id = cu.user_id
  left join users ru on ru.user_id = a.requested_by
  left join users du on du.user_id = a.decided_by`;

async function employeeIdForUser(tenantId, userId) {
  const r = await getPool().query('select company_user_id from company_users where tenant_id = $1 and user_id = $2', [tenantId, userId]);
  return r.rows[0] ? r.rows[0].company_user_id : null;
}

async function employeeInTenant(tenantId, employeeId) {
  const r = await getPool().query(
    `select cu.company_user_id, u.full_name from company_users cu join users u on u.user_id = cu.user_id
      where cu.tenant_id = $1 and cu.company_user_id = $2`, [tenantId, employeeId]);
  return r.rows[0] || null;
}

async function listAdvances(tenantId, { status, employeeId } = {}) {
  const where = ['a.tenant_id = $1']; const vals = [tenantId];
  if (status) { vals.push(status); where.push(`a.status = $${vals.length}`); }
  if (employeeId) { vals.push(employeeId); where.push(`a.employee_id = $${vals.length}`); }
  const r = await getPool().query(`select ${ADV_COLS} ${ADV_FROM} where ${where.join(' and ')} order by a.requested_at desc`, vals);
  return r.rows.map((x) => ({ ...x, Amount: Number(x.Amount), MonthlyDeduction: Number(x.MonthlyDeduction), RepaidAmount: Number(x.RepaidAmount), Outstanding: Number(x.Outstanding) }));
}

async function getAdvance(tenantId, id) {
  const r = await getPool().query(`select ${ADV_COLS}, a.employee_id ${ADV_FROM} where a.tenant_id = $1 and a.id = $2`, [tenantId, id]);
  return r.rows[0] || null;
}

function validateAdvance({ amount, installments, startPeriod }) {
  const errors = [];
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) errors.push('Amount must be greater than 0');
  const inst = Number(installments || 1);
  if (!Number.isInteger(inst) || inst < 1 || inst > 24) errors.push('Installments must be a whole number from 1 to 24');
  if (!isPeriod(startPeriod)) errors.push('First deduction month is required (YYYY-MM)');
  return errors;
}

async function createAdvance(tenantId, { employeeId, amount, installments, startPeriod, reason }, requestedBy) {
  const inst = Number(installments || 1);
  const amt = round2(amount);
  const monthly = round2(amt / inst);
  const r = await getPool().query(
    `insert into hr_salary_advance(tenant_id, employee_id, amount, installments, monthly_deduction, start_period, reason, requested_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [tenantId, employeeId, amt, inst, monthly, startPeriod, (reason || '').toString().slice(0, 500) || null, requestedBy]);
  return r.rows[0].id;
}

// Approve or reject a pending advance. Approval creates a payable so Accounts pays it out.
async function decideAdvance(tenantId, id, decision, note, userId) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const a = (await client.query(
      `select a.*, u.full_name from hr_salary_advance a
         join company_users cu on cu.company_user_id = a.employee_id and cu.tenant_id = a.tenant_id
         join users u on u.user_id = cu.user_id
        where a.tenant_id = $1 and a.id = $2 for update of a`, [tenantId, id])).rows[0];
    if (!a) throw Object.assign(new Error('Advance not found'), { status: 404 });
    if (a.status !== 'Pending') throw Object.assign(new Error(`Advance is already ${a.status}`), { status: 409 });
    let orderId = null;
    if (decision === 'Approved') {
      orderId = `ADV-${a.id}`;
      await client.query(
        `insert into ap_invoices(tenant_id, order_id, product_name, due_date, supplier_name, amount, notes, created_by)
         values ($1,$2,$3,now()::date,$4,$5,$6,$7)`,
        [tenantId, orderId, `Salary advance #${a.id}`, a.full_name, a.amount,
          `Salary advance, recovered in ${a.installments} installment(s) from ${a.start_period}`, userId]);
    }
    await client.query(
      `update hr_salary_advance set status=$3, decided_by=$4, decided_at=now(), decision_note=$5, ap_invoice_order_id=$6, updated_at=now()
        where tenant_id=$1 and id=$2`, [tenantId, id, decision, userId, (note || '').toString().slice(0, 500) || null, orderId]);
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
}

async function cancelAdvance(tenantId, id, userId) {
  const r = await getPool().query(
    `update hr_salary_advance set status='Cancelled', updated_at=now()
      where tenant_id=$1 and id=$2 and status='Pending' and requested_by=$3`, [tenantId, id, userId]);
  return r.rowCount > 0;
}

// Deductions due for a payroll period: approved advances that have started,
// still have a balance, and were not yet deducted for this period.
async function deductionsForPeriod(tenantId, period) {
  const r = await getPool().query(
    `select a.id, a.employee_id, a.monthly_deduction, a.amount - a.repaid_amount as outstanding
       from hr_salary_advance a
      where a.tenant_id = $1 and a.status = 'Approved' and a.start_period <= $2 and a.amount > a.repaid_amount
        and not exists (select 1 from hr_salary_advance_deduction d where d.advance_id = a.id and d.period = $2)
      order by a.id`, [tenantId, period]);
  const map = {};
  for (const row of r.rows) {
    const amt = round2(Math.min(Number(row.monthly_deduction), Number(row.outstanding)));
    if (amt <= 0) continue;
    const m = (map[row.employee_id] = map[row.employee_id] || { amount: 0, items: [] });
    m.amount = round2(m.amount + amt);
    m.items.push({ advanceId: row.id, amount: amt });
  }
  return map;
}

// Called once per payroll run. If an employee's net pay could not cover the
// whole deduction, `applied` (per employee) caps what is recorded.
async function recordDeductions(tenantId, period, deductionMap, applied, runId) {
  let total = 0;
  for (const [employeeId, d] of Object.entries(deductionMap)) {
    let left = round2(applied[employeeId] != null ? applied[employeeId] : d.amount);
    for (const item of d.items) {
      const amt = round2(Math.min(item.amount, left));
      if (amt <= 0) break;
      left = round2(left - amt);
      await getPool().query(
        `insert into hr_salary_advance_deduction(advance_id, tenant_id, period, amount, payroll_run_id) values ($1,$2,$3,$4,$5)
         on conflict (advance_id, period) do nothing`, [item.advanceId, tenantId, period, amt, runId]);
      await getPool().query(
        `update hr_salary_advance set repaid_amount = repaid_amount + $3,
            status = case when repaid_amount + $3 >= amount then 'Repaid' else status end, updated_at = now()
          where tenant_id = $1 and id = $2`, [tenantId, item.advanceId, amt]);
      total = round2(total + amt);
    }
  }
  return total;
}

// ---- payroll runs ----

async function getRun(tenantId, period) {
  const r = await getPool().query(
    `select r.id, r.period, r.generated_at, r.employee_count, r.total_net, r.total_advance_deductions, u.full_name as generated_by_name
       from hr_payroll_run r left join users u on u.user_id = r.generated_by where r.tenant_id = $1 and r.period = $2`, [tenantId, period]);
  if (r.rows[0]) return r.rows[0];
  // Runs made before this table existed left payables named PAY-<period>-<employee>
  const legacy = await getPool().query(`select count(*)::int n, min(created_at) at from ap_invoices where tenant_id = $1 and order_id like $2`, [tenantId, `PAY-${period}-%`]);
  return legacy.rows[0].n ? { id: null, period, generated_at: legacy.rows[0].at, employee_count: legacy.rows[0].n, legacy: true } : null;
}

// Atomically claims the period; returns the run id, or null if it was already run.
async function claimRun(tenantId, period, userId) {
  const r = await getPool().query(
    `insert into hr_payroll_run(tenant_id, period, generated_by) values ($1,$2,$3)
     on conflict (tenant_id, period) do nothing returning id`, [tenantId, period, userId]);
  return r.rows[0] ? r.rows[0].id : null;
}

async function finishRun(runId, employeeCount, totalNet, totalAdvance) {
  await getPool().query('update hr_payroll_run set employee_count=$2, total_net=$3, total_advance_deductions=$4 where id=$1',
    [runId, employeeCount, round2(totalNet), round2(totalAdvance)]);
}

async function releaseRun(runId) {
  await getPool().query('delete from hr_payroll_run where id = $1', [runId]);
}

module.exports = {
  isPeriod, employeeIdForUser, employeeInTenant, listAdvances, getAdvance, validateAdvance, createAdvance,
  decideAdvance, cancelAdvance, deductionsForPeriod, recordDeductions, getRun, claimRun, finishRun, releaseRun,
};
