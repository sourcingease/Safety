const { createSupabasePgPool } = require('./supabase');

let pool = null;

function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

// ---- Notes ----

async function getNotes({ tenantId, customer, salesperson, from, to }) {
  const p = getPool();
  const clauses = ['tenant_id = $1'];
  const vals = [tenantId || 0];
  let i = 2;
  if (customer) { clauses.push(`customer_name = $${i++}`); vals.push(customer); }
  if (salesperson) { clauses.push(`sales_person_name = $${i++}`); vals.push(salesperson); }
  if (from) { clauses.push(`created_at >= $${i++}`); vals.push(new Date(from)); }
  if (to) { clauses.push(`created_at <= $${i++}`); vals.push(new Date(to)); }
  const r = await p.query(
    `select id as "Id", subject as "Subject", body as "Body", follow_up_at as "FollowUpAt",
            created_at as "CreatedAt", customer_name as "CustomerName", sales_person_name as "SalesPersonName"
     from phone_notes where ${clauses.join(' and ')}
     order by coalesce(follow_up_at, created_at) desc`,
    vals
  );
  return r.rows;
}

async function createNote({ tenantId, userId, subject, body, followUpAt, customerName, salesPersonName }) {
  const p = getPool();
  const r = await p.query(
    `insert into phone_notes(tenant_id, subject, body, follow_up_at, customer_name, sales_person_name, created_by)
     values ($1,$2,$3,$4,$5,$6,$7) returning id as "Id"`,
    [tenantId || 0, subject || null, body, followUpAt || null, customerName || null, salesPersonName || null, userId]
  );
  return r.rows[0].Id;
}

// ---- Segments ----

async function getSegments(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", name as "Name", created_at as "CreatedAt" from segments where tenant_id = $1 order by name`,
    [tenantId || 0]
  );
  return r.rows;
}

async function createSegment(tenantId, name) {
  const p = getPool();
  const r = await p.query(
    `insert into segments(tenant_id, name) values ($1,$2) returning id as "Id"`,
    [tenantId || 0, name]
  );
  return r.rows[0].Id;
}

async function deleteSegment(tenantId, id) {
  const p = getPool();
  await p.query(`delete from crm_segment_companies where segment_id = $1 and tenant_id = $2`, [id, tenantId || 0]);
  await p.query(`delete from segments where id = $1 and tenant_id = $2`, [id, tenantId || 0]);
}

async function getSegmentCompanies(tenantId, segmentId) {
  const p = getPool();
  const r = await p.query(
    `select c.id as "Id", c.company_name as "CompanyName", c.city as "City", c.country as "Country", c.status as "Status"
     from crm_segment_companies sc
     join crm_companies c on c.id = sc.company_id and c.tenant_id = sc.tenant_id
     where sc.tenant_id = $1 and sc.segment_id = $2
     order by c.company_name`,
    [tenantId || 0, segmentId]
  );
  return r.rows;
}

async function setSegmentCompanies(tenantId, segmentId, companyIds) {
  const p = getPool();
  const tid = tenantId || 0;
  await p.query(`delete from crm_segment_companies where segment_id = $1 and tenant_id = $2`, [segmentId, tid]);
  for (const cid of companyIds) {
    await p.query(
      `insert into crm_segment_companies(segment_id, company_id, tenant_id) values ($1,$2,$3)`,
      [segmentId, cid, tid]
    );
  }
}

// ---- Categories ----

async function getOrSeedCategories(tenantId, role, defaults) {
  const p = getPool();
  const tid = tenantId || 0;
  let r = await p.query(
    `select id as "Id", name as "Name" from crm_categories where tenant_id = $1 and role_code = $2 order by name`,
    [tid, role]
  );
  if (r.rows.length === 0) {
    for (const name of defaults) {
      await p.query(`insert into crm_categories(tenant_id, role_code, name) values ($1,$2,$3)`, [tid, role, name]);
    }
    r = await p.query(
      `select id as "Id", name as "Name" from crm_categories where tenant_id = $1 and role_code = $2 order by name`,
      [tid, role]
    );
  }
  return r.rows;
}

// ---- Companies ----

const COMPANY_COLUMNS = `id as "Id", tenant_id as "TenantId", company_name as "CompanyName", company_details as "CompanyDetails",
  company_type as "CompanyType", product as "Product", hs_code as "HSCode", phone as "Phone", cell_phone as "CellPhone",
  whatsapp as "Whatsapp", website as "Website", address as "Address", city as "City", state as "State", zip as "Zip",
  country as "Country", ntn as "NTN", instagram as "Instagram", facebook as "Facebook", twitter as "Twitter",
  linkedin as "Linkedin", skype as "Skype", source_of_contact as "SourceOfContact", status as "Status",
  saved_updated_on as "SavedUpdatedOn", send_email_on_save as "SendEmailOnSave", created_by as "CreatedBy", created_at as "CreatedAt"`;

async function createCompany({ tenantId, userId, company, persons, categoryIds }) {
  const p = getPool();
  const r = await p.query(
    `insert into crm_companies(tenant_id, company_name, company_details, company_type, product, hs_code, phone,
       cell_phone, whatsapp, website, address, city, state, zip, country, ntn, instagram, facebook, twitter,
       linkedin, skype, source_of_contact, status, saved_updated_on, send_email_on_save, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     returning id as "Id"`,
    [tenantId || 0, company.companyName, company.companyDetails || null, company.companyType || null,
      company.product || null, company.hsCode || null, company.phone || null, company.cellPhone || null,
      company.whatsapp || null, company.website || null, company.address || null, company.city || null,
      company.state || null, company.zip || null, company.country || null, company.ntn || null,
      company.instagram || null, company.facebook || null, company.twitter || null, company.linkedin || null,
      company.skype || null, company.sourceOfContact || null, company.status || 'Lead',
      company.savedUpdatedOn ? new Date(company.savedUpdatedOn) : null, Boolean(company.sendEmailOnSave), userId || null]
  );
  const companyId = r.rows[0].Id;
  await replacePersons(companyId, persons);
  await replaceCategories(companyId, categoryIds);
  return companyId;
}

async function replacePersons(companyId, persons) {
  const p = getPool();
  await p.query(`delete from crm_contact_persons where company_id = $1`, [companyId]);
  for (const person of persons || []) {
    await p.query(
      `insert into crm_contact_persons(company_id, first_name, last_name, designation, email, phone, cell_phone, whatsapp, linkedin, skype)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [companyId, person.firstName || null, person.lastName || null, person.designation || null, person.email || null,
        person.phone || null, person.cellPhone || null, person.whatsapp || null, person.linkedin || null, person.skype || null]
    );
  }
}

async function replaceCategories(companyId, categoryIds) {
  const p = getPool();
  await p.query(`delete from crm_company_category_map where company_id = $1`, [companyId]);
  for (const cid of categoryIds || []) {
    const id = parseInt(cid, 10);
    if (id > 0) {
      await p.query(`insert into crm_company_category_map(company_id, category_id) values ($1,$2)`, [companyId, id]);
    }
  }
}

async function getCompany(tenantId, id) {
  const p = getPool();
  const c = await p.query(
    `select ${COMPANY_COLUMNS} from crm_companies where id = $1 and tenant_id = $2 limit 1`,
    [id, tenantId || 0]
  );
  if (!c.rows.length) return null;
  const persons = (await p.query(
    `select id as "Id", company_id as "CompanyId", first_name as "FirstName", last_name as "LastName",
            designation as "Designation", email as "Email", phone as "Phone", cell_phone as "CellPhone",
            whatsapp as "Whatsapp", linkedin as "Linkedin", skype as "Skype"
     from crm_contact_persons where company_id = $1 order by id`,
    [id]
  )).rows;
  const cats = (await p.query(`select category_id as "CategoryId" from crm_company_category_map where company_id = $1`, [id]))
    .rows.map((r) => r.CategoryId);
  return { company: c.rows[0], persons, categoryIds: cats };
}

async function updateCompany({ tenantId, id, company, persons, categoryIds }) {
  const p = getPool();
  await p.query(
    `update crm_companies set
       company_name = coalesce($3, company_name), company_details = coalesce($4, company_details),
       company_type = coalesce($5, company_type), product = coalesce($6, product), hs_code = coalesce($7, hs_code),
       phone = coalesce($8, phone), cell_phone = coalesce($9, cell_phone), whatsapp = coalesce($10, whatsapp),
       website = coalesce($11, website), address = coalesce($12, address), city = coalesce($13, city),
       state = coalesce($14, state), zip = coalesce($15, zip), country = coalesce($16, country), ntn = coalesce($17, ntn),
       instagram = coalesce($18, instagram), facebook = coalesce($19, facebook), twitter = coalesce($20, twitter),
       linkedin = coalesce($21, linkedin), skype = coalesce($22, skype),
       source_of_contact = coalesce($23, source_of_contact), status = coalesce($24, status),
       saved_updated_on = coalesce($25, saved_updated_on), send_email_on_save = coalesce($26, send_email_on_save)
     where id = $1 and tenant_id = $2`,
    [id, tenantId || 0, company.companyName || null, company.companyDetails || null, company.companyType || null,
      company.product || null, company.hsCode || null, company.phone || null, company.cellPhone || null,
      company.whatsapp || null, company.website || null, company.address || null, company.city || null,
      company.state || null, company.zip || null, company.country || null, company.ntn || null,
      company.instagram || null, company.facebook || null, company.twitter || null, company.linkedin || null,
      company.skype || null, company.sourceOfContact || null, company.status || null,
      company.savedUpdatedOn ? new Date(company.savedUpdatedOn) : null, Boolean(company.sendEmailOnSave)]
  );
  await replacePersons(id, persons);
  await replaceCategories(id, categoryIds);
}

async function listCompanies({ tenantId, q, role, status }) {
  const p = getPool();
  const clauses = ['c.tenant_id = $1'];
  const vals = [tenantId || 0];
  let i = 2;
  if (q) { clauses.push(`(c.company_name ilike $${i} or c.city ilike $${i} or c.state ilike $${i})`); vals.push(`%${q}%`); i++; }
  if (status) { clauses.push(`c.status = $${i++}`); vals.push(status); }
  if (role) { clauses.push(`exists(select 1 from crm_categories cc join crm_company_category_map m on m.category_id = cc.id and m.company_id = c.id where cc.tenant_id = c.tenant_id and lower(cc.role_code) = $${i})`); vals.push(role); i++; }
  const r = await p.query(
    `select c.id as "Id", c.company_name as "CompanyName", c.company_type as "CompanyType", c.product as "Product",
            c.phone as "Phone", c.city as "City", c.state as "State", c.zip as "Zip", c.country as "Country", c.status as "Status",
            (select trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) from crm_contact_persons p where p.company_id = c.id limit 1) as "ContactName",
            (select p.email from crm_contact_persons p where p.company_id = c.id and p.email is not null limit 1) as "Email"
     from crm_companies c
     where ${clauses.join(' and ')}
     order by c.company_name
     limit 200`,
    vals
  );
  return r.rows;
}

async function deleteCompany(id) {
  const p = getPool();
  await p.query(`delete from crm_company_category_map where company_id = $1`, [id]);
  await p.query(`delete from crm_contact_persons where company_id = $1`, [id]);
  await p.query(`delete from crm_companies where id = $1`, [id]);
}

async function upgradeCompanyStatus(id) {
  const p = getPool();
  const r = await p.query(`select status as "Status" from crm_companies where id = $1 limit 1`, [id]);
  if (!r.rows.length) return null;
  const current = r.rows[0].Status || 'Lead';
  const next = current === 'Lead' ? 'Account' : current === 'Account' ? 'NA' : 'Lead';
  await p.query(`update crm_companies set status = $2 where id = $1`, [id, next]);
  return next;
}

// ---- Appointments ----

async function getAppointments(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", company as "Company", notes as "Notes", when_at as "WhenAt", created_at as "CreatedAt"
     from crm_appointments where tenant_id = $1 order by when_at asc limit 50`,
    [tenantId || 0]
  );
  return r.rows;
}

async function createAppointment({ tenantId, company, notes, whenAt, userId }) {
  const p = getPool();
  const r = await p.query(
    `insert into crm_appointments(tenant_id, company, notes, when_at, created_by) values ($1,$2,$3,$4,$5) returning id as "Id"`,
    [tenantId || 0, company || null, notes || null, whenAt, userId || null]
  );
  return r.rows[0].Id;
}

// ---- Campaigns ----

async function getCampaigns(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", name as "Name", subject as "Subject", scheduled_at as "ScheduledAt", created_at as "CreatedAt"
     from crm_email_campaigns where tenant_id = $1 order by created_at desc limit 50`,
    [tenantId || 0]
  );
  return r.rows;
}

async function createCampaign({ tenantId, name, subject, scheduledAt, userId }) {
  const p = getPool();
  const r = await p.query(
    `insert into crm_email_campaigns(tenant_id, name, subject, scheduled_at, created_by) values ($1,$2,$3,$4,$5) returning id as "Id"`,
    [tenantId || 0, name, subject || null, scheduledAt, userId || null]
  );
  return r.rows[0].Id;
}

// ---- Summary ----

async function getSummary(tenantId) {
  const p = getPool();
  const tid = tenantId || 0;
  const contacts = await p.query(`select count(*)::int as "C" from contact_test`);
  const leads = await p.query(`select count(*)::int as "C" from crm_leads where tenant_id = $1`, [tid]);
  const accounts = await p.query(`select count(*)::int as "C" from crm_accounts where tenant_id = $1`, [tid]);
  return { contacts: contacts.rows[0]?.C || 0, leads: leads.rows[0]?.C || 0, accounts: accounts.rows[0]?.C || 0 };
}

// ---- Leads ----

async function getLeads(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", tenant_id as "TenantId", lead_name as "LeadName", company as "Company", email as "Email",
            phone as "Phone", status as "Status", estimated_value as "EstimatedValue", source as "Source",
            notes as "Notes", created_by as "CreatedBy", created_at as "CreatedAt", updated_at as "UpdatedAt"
     from crm_leads where tenant_id = $1 order by created_at desc`,
    [tenantId || 0]
  );
  return r.rows;
}

async function createLead({ tenantId, leadName, company, email, phone, status, estimatedValue, source, notes, userId }) {
  const p = getPool();
  const r = await p.query(
    `insert into crm_leads(tenant_id, lead_name, company, email, phone, status, estimated_value, source, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id as "Id"`,
    [tenantId || 0, leadName || '', company || '', email || '', phone || null, status || 'New',
      Number(estimatedValue || 0), source || null, notes || null, userId || null]
  );
  return r.rows[0].Id;
}

async function updateLead({ tenantId, id, leadName, company, email, phone, status, estimatedValue, source, notes }) {
  const p = getPool();
  await p.query(
    `update crm_leads set lead_name=$3, company=$4, email=$5, phone=$6, status=$7, estimated_value=$8, source=$9, notes=$10, updated_at=now()
     where tenant_id = $1 and id = $2`,
    [tenantId || 0, id, leadName || '', company || '', email || '', phone || null, status || 'New',
      Number(estimatedValue || 0), source || null, notes || null]
  );
}

// ---- Email / mailbox ----

async function getEmails(tenantId, userId, folder) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", folder as "Folder", from_address as "FromAddress", to_addresses as "ToAddresses",
            cc_addresses as "CcAddresses", subject as "Subject", body as "Body", attachments_json as "AttachmentsJson",
            sent_at as "SentAt", created_at as "CreatedAt"
     from emails where tenant_id = $1 and (user_id = $2 or $2 is null) and folder = $3
     order by coalesce(sent_at, created_at) desc`,
    [tenantId || 0, userId, folder]
  );
  return r.rows;
}

async function getEmailById(tenantId, userId, id) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", folder as "Folder", from_address as "FromAddress", to_addresses as "ToAddresses",
            cc_addresses as "CcAddresses", subject as "Subject", body as "Body", attachments_json as "AttachmentsJson",
            sent_at as "SentAt", created_at as "CreatedAt"
     from emails where tenant_id = $1 and (user_id = $2 or $2 is null) and id = $3 limit 1`,
    [tenantId || 0, userId, id]
  );
  return r.rows[0] || null;
}

async function createEmail({ tenantId, userId, folder, fromAddress, toAddresses, ccAddresses, subject, body, attachmentsJson, sentAt }) {
  const p = getPool();
  const r = await p.query(
    `insert into emails(tenant_id, user_id, folder, from_address, to_addresses, cc_addresses, subject, body, attachments_json, sent_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id as "Id"`,
    [tenantId || 0, userId || null, folder, fromAddress, toAddresses || null, ccAddresses || null, subject || null, body || null, attachmentsJson || null, sentAt || null]
  );
  return r.rows[0].Id;
}

async function deleteEmail(tenantId, userId, id) {
  const p = getPool();
  await p.query(`delete from emails where tenant_id = $1 and (user_id = $2 or $2 is null) and id = $3`, [tenantId || 0, userId, id]);
}

// ---- Orders ----

const ORDER_COLUMNS = `id as "Id", tenant_id as "TenantId", order_number as "OrderNumber", order_type as "OrderType",
  party_name as "PartyName", contact_person as "ContactPerson", email as "Email", address as "Address", items as "Items",
  subtotal as "Subtotal", tax as "Tax", total_amount as "TotalAmount", status as "Status", notes as "Notes",
  lead_id as "LeadId", created_by as "CreatedBy", created_at as "CreatedAt", updated_at as "UpdatedAt", shipped_at as "ShippedAt"`;

async function getOrders(tenantId) {
  const p = getPool();
  const r = await p.query(`select ${ORDER_COLUMNS} from crm_orders where tenant_id = $1 order by created_at desc`, [tenantId || 0]);
  return r.rows;
}

async function createOrder({ tenantId, orderType, partyName, contactPerson, email, address, items, subtotal, tax, totalAmount, status, notes, userId }) {
  const p = getPool();
  const r = await p.query(
    `insert into crm_orders(tenant_id, order_type, party_name, contact_person, email, address, items, subtotal, tax, total_amount, status, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id as "Id"`,
    [tenantId || 0, orderType || 'Sales', partyName || '', contactPerson || null, email || null, address || null, items || null,
      subtotal || 0, tax || 0, totalAmount || 0, status || 'Draft', notes || null, userId || null]
  );
  const orderId = r.rows[0].Id;
  const orderNumber = (orderType === 'Sales' ? 'SALE-' : 'PO-') + orderId;
  await p.query(`update crm_orders set order_number = $2 where tenant_id = $1 and id = $3`, [tenantId || 0, orderNumber, orderId]);
  return { orderId, orderNumber };
}

async function updateOrder({ tenantId, id, orderType, partyName, contactPerson, email, address, items, subtotal, tax, totalAmount, status, notes }) {
  const p = getPool();
  await p.query(
    `update crm_orders set order_type=$3, party_name=$4, contact_person=$5, email=$6, address=$7, items=$8,
       subtotal=$9, tax=$10, total_amount=$11, status=$12, notes=$13, updated_at=now()
     where tenant_id = $1 and id = $2`,
    [tenantId || 0, id, orderType || 'Sales', partyName || '', contactPerson || null, email || null, address || null,
      items || null, subtotal || 0, tax || 0, totalAmount || 0, status || 'Draft', notes || null]
  );
}

async function shipOrder(tenantId, id) {
  const p = getPool();
  await p.query(
    `update crm_orders set status = 'Shipped', shipped_at = now(), updated_at = now()
     where tenant_id = $1 and id = $2 and order_type = 'Sales'`,
    [tenantId || 0, id]
  );
}

async function getOrderByType(tenantId, id, orderType) {
  const p = getPool();
  const r = await p.query(`select ${ORDER_COLUMNS} from crm_orders where tenant_id = $1 and id = $2 and order_type = $3`, [tenantId || 0, id, orderType]);
  return r.rows[0] || null;
}

// ---- Contact test table (simple demo/fallback contacts) ----

async function getContacts() {
  const p = getPool();
  const r = await p.query(`select id as "Id", name as "Name", created_date as "CreatedDate" from contact_test order by created_date desc`);
  return r.rows;
}

async function createContact(name) {
  const p = getPool();
  await p.query(`insert into contact_test(name) values ($1)`, [name]);
  const count = await p.query(`select count(*)::int as total from contact_test`);
  return count.rows[0].total;
}

async function updateContact(id, name) {
  const p = getPool();
  const r = await p.query(`update contact_test set name = $2 where id = $1`, [id, name]);
  return r.rowCount;
}

async function deleteContact(id) {
  const p = getPool();
  const r = await p.query(`delete from contact_test where id = $1`, [id]);
  return r.rowCount;
}

async function deleteAllContacts() {
  const p = getPool();
  const r = await p.query(`delete from contact_test`);
  return r.rowCount;
}

module.exports = {
  getNotes, createNote,
  getSegments, createSegment, deleteSegment, getSegmentCompanies, setSegmentCompanies,
  getOrSeedCategories,
  createCompany, getCompany, updateCompany, listCompanies, deleteCompany, upgradeCompanyStatus,
  getAppointments, createAppointment,
  getCampaigns, createCampaign,
  getSummary,
  getLeads, createLead, updateLead,
  getEmails, getEmailById, createEmail, deleteEmail,
  getOrders, createOrder, updateOrder, shipOrder, getOrderByType,
  getContacts, createContact, updateContact, deleteContact, deleteAllContacts,
};
