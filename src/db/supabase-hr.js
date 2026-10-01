const { createSupabasePgPool } = require('./supabase');

let pool = null;

function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

function num(x) { return x === undefined || x === null || x === '' ? null : parseFloat(x); }
function val(x) { return x === '' || x === undefined ? null : x; }

// Generic upsert keyed by (tenant_id, employee_id): update if a row exists, else insert.
async function upsertByEmployee(table, tenantId, employeeId, fields) {
  const p = getPool();
  const cols = Object.keys(fields);
  const vals = Object.values(fields);
  const existing = await p.query(`select 1 from ${table} where tenant_id = $1 and employee_id = $2 limit 1`, [tenantId, employeeId]);
  if (existing.rows.length) {
    const assigns = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
    await p.query(`update ${table} set ${assigns}, updated_at = now() where tenant_id = $1 and employee_id = $2`, [tenantId, employeeId, ...vals]);
  } else {
    const allCols = ['tenant_id', 'employee_id', ...cols];
    const placeholders = allCols.map((_, i) => `$${i + 1}`).join(', ');
    await p.query(`insert into ${table}(${allCols.join(', ')}) values (${placeholders})`, [tenantId, employeeId, ...vals]);
  }
}

// ---- Job postings ----

async function listPostings(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", tenant_id as "TenantId", title as "Title", department as "Department", type as "Type",
            openings as "Openings", location as "Location", salary_range as "SalaryRange", description as "Description",
            required_qualification as "RequiredQualification", desired_qualification as "DesiredQualification",
            application_deadline as "ApplicationDeadline", diversity_flag as "DiversityFlag", eoe_flag as "EOEFlag",
            posted_at as "PostedAt"
     from job_posting where tenant_id = $1 order by posted_at desc`,
    [tenantId || 0]
  );
  return r.rows;
}

async function createPosting({ tenantId, title, department, type, openings, location, salaryRange, description, requiredQualification, desiredQualification, applicationDeadline, diversityFlag, eoeFlag }) {
  const p = getPool();
  const r = await p.query(
    `insert into job_posting(tenant_id, title, department, type, openings, location, salary_range, description, required_qualification, desired_qualification, application_deadline, diversity_flag, eoe_flag)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id as "Id"`,
    [tenantId || 0, title, department || null, type || null, openings || 1, location || null, salaryRange || null,
      description || null, requiredQualification || null, desiredQualification || null, applicationDeadline || null,
      Boolean(diversityFlag), Boolean(eoeFlag)]
  );
  return r.rows[0].Id;
}

async function updatePosting({ tenantId, id, title, department, type, openings, location, salaryRange, description, requiredQualification, desiredQualification, applicationDeadline, diversityFlag, eoeFlag }) {
  const p = getPool();
  await p.query(
    `update job_posting set
       title = coalesce($3, title), department = coalesce($4, department), type = coalesce($5, type),
       openings = coalesce($6, openings), location = coalesce($7, location), salary_range = coalesce($8, salary_range),
       description = coalesce($9, description), required_qualification = coalesce($10, required_qualification),
       desired_qualification = coalesce($11, desired_qualification), application_deadline = coalesce($12, application_deadline),
       diversity_flag = coalesce($13, diversity_flag), eoe_flag = coalesce($14, eoe_flag)
     where id = $2 and tenant_id = $1`,
    [tenantId || 0, id, title || null, department || null, type || null, openings != null ? parseInt(openings, 10) : null,
      location || null, salaryRange || null, description || null, requiredQualification || null, desiredQualification || null,
      applicationDeadline || null, diversityFlag != null ? Boolean(diversityFlag) : null, eoeFlag != null ? Boolean(eoeFlag) : null]
  );
}

async function deletePosting(tenantId, id) {
  const p = getPool();
  await p.query(`delete from job_posting where id = $1 and tenant_id = $2`, [id, tenantId || 0]);
}

// ---- Candidates / applicants ----

async function listApplicants({ tenantId, jobTitle, name, email, phone, address, status, shortlisted }) {
  const p = getPool();
  const clauses = ['c.tenant_id = $1'];
  const vals = [tenantId || 0];
  let i = 2;
  if (jobTitle) { clauses.push(`jp.title ilike $${i++}`); vals.push(`%${jobTitle}%`); }
  if (name) { clauses.push(`c.name ilike $${i++}`); vals.push(`%${name}%`); }
  if (email) { clauses.push(`c.email ilike $${i++}`); vals.push(`%${email}%`); }
  if (phone) { clauses.push(`c.phone ilike $${i++}`); vals.push(`%${phone}%`); }
  if (address) { clauses.push(`c.address ilike $${i++}`); vals.push(`%${address}%`); }
  if (status) { clauses.push(`c.status = $${i++}`); vals.push(status); }
  if (shortlisted === '1') { clauses.push(`c.shortlisted = true`); }
  const r = await p.query(
    `select c.id as "Id", c.tenant_id as "TenantId", c.job_posting_id as "JobPostingId", c.name as "Name", c.email as "Email",
            c.phone as "Phone", c.address as "Address", c.linkedin_url as "LinkedinUrl", c.work_auth_status as "WorkAuthStatus",
            c.preferred_start_date as "PreferredStartDate", c.status as "Status", c.applied_at as "AppliedAt",
            c.shortlisted as "Shortlisted", c.shortlisted_at as "ShortlistedAt", jp.title as "JobTitle"
     from candidate c left join job_posting jp on jp.id = c.job_posting_id
     where ${clauses.join(' and ')}
     order by c.applied_at desc`,
    vals
  );
  return r.rows;
}

async function createApplicant({ tenantId, jobPostingId, name, email, phone, address, linkedin, workAuthStatus, preferredStartDate }) {
  const p = getPool();
  const r = await p.query(
    `insert into candidate(tenant_id, job_posting_id, name, email, phone, address, linkedin_url, work_auth_status, preferred_start_date, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Applied') returning id as "Id"`,
    [tenantId || 0, jobPostingId || null, name, email, phone || null, address || null, linkedin || null, workAuthStatus || null, preferredStartDate || null]
  );
  return r.rows[0].Id;
}

async function shortlistApplicant({ tenantId, id, interviewDate, interviewTimeSlot, interviewType, interviewerName, interviewerTitle, reason }) {
  const p = getPool();
  await p.query(
    `insert into candidate_interview(candidate_id, tenant_id, interview_date, interview_time_slot, interview_type, interviewer_name, interviewer_title, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, tenantId || 0, interviewDate || null, interviewTimeSlot || null, interviewType || null, interviewerName || null, interviewerTitle || null, reason || null]
  );
  await p.query(
    `update candidate set shortlisted = true, shortlisted_at = now(), status = 'Shortlisted' where id = $1 and tenant_id = $2`,
    [id, tenantId || 0]
  );
}

async function addEvaluation({ tenantId, id, evaluatorName, technicalSkills, teamwork, leadership, problemSolving, communication, testDetails, agenda, recommendation }) {
  const p = getPool();
  await p.query(
    `insert into candidate_evaluation(candidate_id, tenant_id, evaluator_name, technical_skills, teamwork, leadership, problem_solving, communication, test_details, agenda, recommendation)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, tenantId || 0, evaluatorName || null, technicalSkills || null, teamwork || null, leadership || null,
      problemSolving || null, communication || null, testDetails || null, agenda || null, recommendation || null]
  );
  if (recommendation) {
    await p.query(`update candidate set status = $3 where id = $1 and tenant_id = $2`, [id, tenantId || 0, recommendation]);
  }
}

async function addOffer({ tenantId, id, employmentType, benefits, salaryOffer, startDate, confidentiality, nonCompete, atWill, offerStatus }) {
  const p = getPool();
  await p.query(
    `insert into candidate_offer(candidate_id, tenant_id, employment_type, benefits, salary_offer, start_date, confidentiality, non_compete, at_will, offer_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, tenantId || 0, employmentType || null, benefits || null, salaryOffer || null, startDate || null,
      Boolean(confidentiality), Boolean(nonCompete), Boolean(atWill), offerStatus || null]
  );
  await p.query(`update candidate set status = $3 where id = $1 and tenant_id = $2`, [id, tenantId || 0, offerStatus || 'Offered']);
}

// ---- Employees ----

async function createEmployee({ tenantId, email, fullName, passwordHash, passwordSalt, roleName, title }) {
  const p = getPool();
  const r = await p.query(
    `select * from sp_create_employee($1,$2,$3,$4,$5,$6,$7)`,
    [tenantId, email, fullName || null, passwordHash || null, passwordSalt || null, roleName || null, title || null]
  );
  const row = r.rows[0] || {};
  const cu = await p.query(`select company_user_id as "CompanyUserId" from company_users where tenant_id = $1 and user_id = $2`, [tenantId, row.user_id]);
  return { UserId: row.user_id, RoleId: row.role_id, CompanyUserId: cu.rows[0]?.CompanyUserId || null };
}

async function listEmployees(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select p.id as "ProfileId", cu.company_user_id as "CompanyUserId", u.user_id as "UserId", u.full_name as "FullName", u.email as "Email",
            p.department as "Department", p.active as "Active", p.phone as "Phone", p.country as "Country", p.state as "State", p.zip as "Zip"
     from company_users cu
     join users u on u.user_id = cu.user_id
     left join hr_employee_profile p on p.employee_id = cu.company_user_id and p.tenant_id = cu.tenant_id
     where cu.tenant_id = $1
     order by u.full_name`,
    [tenantId || 0]
  );
  return r.rows;
}

async function getEmployee(tenantId, employeeId) {
  const p = getPool();
  const r = await p.query(
    `select cu.company_user_id as "CompanyUserId", u.user_id as "UserId", u.full_name as "FullName", u.email as "Email",
            p.id as "Id", p.address1 as "Address1", p.address2 as "Address2", p.active as "Active", p.phone as "Phone",
            p.country as "Country", p.state as "State", p.zip as "Zip", p.fax as "Fax", p.department as "Department",
            p.employee_type as "EmployeeType", p.ssn as "SSN", p.email as "Email", p.hire_date as "HireDate",
            p.birth_date as "BirthDate", p.commissionable as "Commissionable", p.commission_percent as "CommissionPercent",
            p.next_of_kin_name as "NextOfKinName", p.next_of_kin_number as "NextOfKinNumber", p.source_type as "SourceType",
            p.industry as "Industry", p.geo_location as "GeoLocation", p.disability as "Disability", p.work_injury as "WorkInjury",
            p.health_insurance as "HealthInsurance", p.id_number as "IdNumber", p.notes as "Notes", p.heritage as "Heritage",
            p.sexual_orientation as "SexualOrientation", p.job_description as "JobDescription"
     from company_users cu
     join users u on u.user_id = cu.user_id
     left join hr_employee_profile p on p.employee_id = cu.company_user_id and p.tenant_id = cu.tenant_id
     where cu.tenant_id = $1 and cu.company_user_id = $2
     limit 1`,
    [tenantId || 0, employeeId]
  );
  return r.rows[0] || null;
}

async function updateEmployeeProfile(tenantId, employeeId, profile) {
  await upsertByEmployee('hr_employee_profile', tenantId || 0, employeeId, {
    address1: val(profile.address1), address2: val(profile.address2), active: Boolean(profile.active),
    phone: val(profile.phone), country: val(profile.country), state: val(profile.state), zip: val(profile.zip),
    fax: val(profile.fax), department: val(profile.department), employee_type: val(profile.employeeType),
    ssn: val(profile.ssn), email: val(profile.email), hire_date: val(profile.hireDate), birth_date: val(profile.birthDate),
    commissionable: Boolean(profile.commissionable), commission_percent: num(profile.commissionPercent),
    next_of_kin_name: val(profile.nextOfKinName), next_of_kin_number: val(profile.nextOfKinNumber),
    source_type: val(profile.sourceType), industry: val(profile.industry), geo_location: val(profile.geoLocation),
    disability: val(profile.disability), work_injury: val(profile.workInjury), health_insurance: val(profile.healthInsurance),
    id_number: val(profile.idNumber), notes: val(profile.notes), heritage: val(profile.heritage),
    sexual_orientation: val(profile.sexualOrientation), job_description: val(profile.jobDescription),
  });
}

async function getEmployeeTotals(tenantId, employeeId) {
  const p = getPool();
  const r = await p.query(
    `select mtd_gross as "MTD_Gross", mtd_state as "MTD_State", qtd_gross as "QTD_Gross", qtd_state as "QTD_State",
            ytd_gross as "YTD_Gross", ytd_state as "YTD_State", mtd_fica as "MTD_Fica", qtd_fica as "QTD_Fica", ytd_fica as "YTD_Fica",
            mtd_local as "MTD_Local", qtd_local as "QTD_Local", ytd_local as "YTD_Local", mtd_federal as "MTD_Federal",
            qtd_federal as "QTD_Federal", ytd_federal as "YTD_Federal", mtd_other as "MTD_Other", qtd_other as "QTD_Other", ytd_other as "YTD_Other"
     from hr_employee_totals where tenant_id = $1 and employee_id = $2 limit 1`,
    [tenantId || 0, employeeId]
  );
  return r.rows[0] || {};
}

async function updateEmployeeTotals(tenantId, employeeId, t) {
  await upsertByEmployee('hr_employee_totals', tenantId || 0, employeeId, {
    mtd_gross: num(t.MTD_Gross), mtd_state: num(t.MTD_State), qtd_gross: num(t.QTD_Gross), qtd_state: num(t.QTD_State),
    ytd_gross: num(t.YTD_Gross), ytd_state: num(t.YTD_State), mtd_fica: num(t.MTD_Fica), qtd_fica: num(t.QTD_Fica), ytd_fica: num(t.YTD_Fica),
    mtd_local: num(t.MTD_Local), qtd_local: num(t.QTD_Local), ytd_local: num(t.YTD_Local), mtd_federal: num(t.MTD_Federal),
    qtd_federal: num(t.QTD_Federal), ytd_federal: num(t.YTD_Federal), mtd_other: num(t.MTD_Other), qtd_other: num(t.QTD_Other), ytd_other: num(t.YTD_Other),
  });
}

async function getEmployeePayDetails(tenantId, employeeId) {
  const p = getPool();
  const r = await p.query(
    `select salary_scale as "SalaryScale", pay_frequency as "PayFrequency", commission_code as "CommissionCode",
            fica_eobi as "FicaEobi", state_allowance as "StateAllowance", federal_withholding as "FederalWithholding",
            city_withholding as "CityWithholding", country_filing_status as "CountryFilingStatus", amount as "Amount",
            deductions as "Deductions", blank_check_overtime_rate as "BlankCheckOvertimeRate", ytd_regular_hours as "YTD_RegularHours",
            last_agi as "LastAGI", pregnancy_leaves as "PregnancyLeaves", pay_yn as "PayYN", salary as "Salary",
            commission_percent as "CommissionPercent", federal_income_tax_yn as "FederalIncomeTaxYN", country_allowance as "CountryAllowance",
            state_withholding as "StateWithholding", federal_filing_status as "FederalFilingStatus", city_filing_status as "CityFilingStatus",
            net_amount as "NetAmount", pre_tax_amount as "PreTaxAmount", ytd_fit as "YTD_FIT", ytd_overtime_hours as "YTD_OvertimeHours",
            last_fica_eobi as "LastFicaEobi", pay_type as "PayType", hourly_rate as "HourlyRate", overtime_rate as "OvertimeRate",
            federal_allowance as "FederalAllowance", city_allowance as "CityAllowance", country_withholding_amount as "CountryWithholdingAmount",
            state_filing_status as "StateFilingStatus", gender as "Gender", blank_check_hourly_rate as "BlankCheckHourlyRate",
            additions as "Additions", last_gross as "LastGross", last_fit as "LastFIT"
     from hr_employee_pay_details where tenant_id = $1 and employee_id = $2 limit 1`,
    [tenantId || 0, employeeId]
  );
  return r.rows[0] || {};
}

async function updateEmployeePayDetails(tenantId, employeeId, d) {
  await upsertByEmployee('hr_employee_pay_details', tenantId || 0, employeeId, {
    salary_scale: val(d.SalaryScale || d.salaryScale), pay_frequency: val(d.PayFrequency || d.payFrequency),
    commission_code: val(d.CommissionCode || d.commissionCode), fica_eobi: Boolean(d.FicaEobi),
    state_allowance: num(d.StateAllowance), federal_withholding: num(d.FederalWithholding), city_withholding: num(d.CityWithholding),
    country_filing_status: val(d.CountryFilingStatus), amount: num(d.Amount), deductions: num(d.Deductions),
    blank_check_overtime_rate: num(d.BlankCheckOvertimeRate), ytd_regular_hours: num(d.YTD_RegularHours), last_agi: num(d.LastAGI),
    pregnancy_leaves: d.PregnancyLeaves != null ? parseInt(d.PregnancyLeaves, 10) : null, pay_yn: Boolean(d.PayYN),
    salary: num(d.Salary), commission_percent: num(d.CommissionPercent), federal_income_tax_yn: Boolean(d.FederalIncomeTaxYN),
    country_allowance: num(d.CountryAllowance), state_withholding: num(d.StateWithholding), federal_filing_status: val(d.FederalFilingStatus),
    city_filing_status: val(d.CityFilingStatus), net_amount: num(d.NetAmount), pre_tax_amount: num(d.PreTaxAmount),
    ytd_fit: num(d.YTD_FIT), ytd_overtime_hours: num(d.YTD_OvertimeHours), last_fica_eobi: num(d.LastFicaEobi),
    pay_type: val(d.PayType), hourly_rate: num(d.HourlyRate), overtime_rate: num(d.OvertimeRate),
    federal_allowance: num(d.FederalAllowance), city_allowance: num(d.CityAllowance), country_withholding_amount: num(d.CountryWithholdingAmount),
    state_filing_status: val(d.StateFilingStatus), gender: val(d.Gender), blank_check_hourly_rate: num(d.BlankCheckHourlyRate),
    additions: num(d.Additions), last_gross: num(d.LastGross), last_fit: num(d.LastFIT),
  });
}

// ---- Payroll ----

async function getPayrollBaseRows(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select cu.company_user_id as "EmployeeId", u.full_name as "EmployeeName", coalesce(p.active, true) as "Active",
            pd.salary as "Salary", pd.hourly_rate as "HourlyRate", pd.pay_type as "PayType", pd.pay_frequency as "PayFrequency",
            t.mtd_gross as "MTD_Gross", t.mtd_state as "MTD_State", t.mtd_federal as "MTD_Federal", t.mtd_fica as "MTD_Fica", t.mtd_other as "MTD_Other",
            pd.federal_withholding as "FederalWithholding", pd.state_withholding as "StateWithholding", pd.deductions as "Deductions"
     from company_users cu
     join users u on u.user_id = cu.user_id
     left join hr_employee_profile p on p.employee_id = cu.company_user_id and p.tenant_id = cu.tenant_id
     left join hr_employee_pay_details pd on pd.employee_id = cu.company_user_id and pd.tenant_id = cu.tenant_id
     left join hr_employee_totals t on t.employee_id = cu.company_user_id and t.tenant_id = cu.tenant_id
     where cu.tenant_id = $1
     order by u.full_name`,
    [tenantId || 0]
  );
  return r.rows;
}

async function insertApInvoice({ tenantId, orderId, productName, dueDate, supplierName, amount, docUrl, notes, createdBy }) {
  const p = getPool();
  await p.query(
    `insert into ap_invoices(tenant_id, order_id, product_name, due_date, supplier_name, amount, doc_url, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [tenantId || 0, orderId, productName, dueDate, supplierName, amount, docUrl || null, notes || null, createdBy || null]
  );
}

async function seedSalary(tenantId, salary) {
  const p = getPool();
  const employees = await p.query(`select company_user_id as "CompanyUserId" from company_users where tenant_id = $1`, [tenantId || 0]);
  let updated = 0;
  for (const row of employees.rows) {
    if (!row.CompanyUserId) continue;
    await upsertByEmployee('hr_employee_totals', tenantId || 0, row.CompanyUserId, { mtd_gross: salary });
    updated++;
  }
  return updated;
}

module.exports = {
  listPostings, createPosting, updatePosting, deletePosting,
  listApplicants, createApplicant, shortlistApplicant, addEvaluation, addOffer,
  createEmployee, listEmployees, getEmployee, updateEmployeeProfile,
  getEmployeeTotals, updateEmployeeTotals, getEmployeePayDetails, updateEmployeePayDetails,
  getPayrollBaseRows, insertApInvoice, seedSalary,
};
