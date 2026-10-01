const { createSupabasePgPool } = require('./supabase');

let pool = null;

function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

// ---- Chart of accounts ----

async function listAccounts(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", account_type as "AccountType", account_name as "AccountName", account_number as "AccountNumber",
            notes as "Notes", created_at as "CreatedAt"
     from chart_of_accounts where tenant_id = $1 order by account_type, account_number, account_name`,
    [tenantId || 0]
  );
  return r.rows;
}

async function createAccount({ tenantId, accountType, accountName, accountNumber, notes }) {
  const p = getPool();
  const r = await p.query(
    `insert into chart_of_accounts(tenant_id, account_type, account_name, account_number, notes)
     values ($1,$2,$3,$4,$5) returning id as "Id"`,
    [tenantId || 0, accountType, accountName, accountNumber || null, notes || null]
  );
  return r.rows[0].Id;
}

async function deleteAccount(tenantId, id) {
  const p = getPool();
  await p.query(`delete from chart_of_accounts where id = $1 and tenant_id = $2`, [id, tenantId || 0]);
}

// ---- Company profile ----

async function getCompanyProfile(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select tenant_id as "TenantId", address1 as "Address1", address2 as "Address2", city as "City", state as "State",
            postal_code as "PostalCode", country as "Country", employees as "Employees", capacity_type as "CapacityType",
            capacity_qty as "CapacityQty", min_order_qty as "MinOrderQty", sales_profit_type as "SalesProfitType",
            sales_profit_value as "SalesProfitValue", min_wage as "MinWage", min_age as "MinAge", retirement_age as "RetirementAge",
            deal_in_garments as "DealInGarments", deal_in_home_textile as "DealInHomeTextile", logo_url as "LogoUrl", updated_at as "UpdatedAt"
     from company_profile where tenant_id = $1 limit 1`,
    [tenantId]
  );
  const lines = await p.query(`select id as "Id", name as "Name" from company_product_line where tenant_id = $1 order by name`, [tenantId]);
  return { profile: r.rows[0] || {}, productLines: lines.rows };
}

async function upsertCompanyProfile(tenantId, p_) {
  const p = getPool();
  const existing = await p.query(`select 1 from company_profile where tenant_id = $1 limit 1`, [tenantId]);
  const vals = [tenantId, p_.address1||null, p_.address2||null, p_.city||null, p_.state||null, p_.postalCode||null,
    p_.country||null, p_.employees||null, p_.capacityType||null, p_.capacityQty||null, p_.minOrderQty||null,
    p_.salesProfitType||null, p_.salesProfitValue||null, p_.minWage||null, p_.minAge||null, p_.retirementAge||null,
    Boolean(p_.dealInGarments), Boolean(p_.dealInHomeTextile)];
  if (existing.rows.length) {
    await p.query(
      `update company_profile set address1=$2, address2=$3, city=$4, state=$5, postal_code=$6, country=$7,
         employees=$8, capacity_type=$9, capacity_qty=$10, min_order_qty=$11, sales_profit_type=$12, sales_profit_value=$13,
         min_wage=$14, min_age=$15, retirement_age=$16, deal_in_garments=$17, deal_in_home_textile=$18, updated_at=now()
       where tenant_id = $1`,
      vals
    );
  } else {
    await p.query(
      `insert into company_profile(tenant_id, address1, address2, city, state, postal_code, country, employees,
         capacity_type, capacity_qty, min_order_qty, sales_profit_type, sales_profit_value, min_wage, min_age,
         retirement_age, deal_in_garments, deal_in_home_textile)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      vals
    );
  }
}

async function setCompanyLogo(tenantId, url) {
  const p = getPool();
  const existing = await p.query(`select 1 from company_profile where tenant_id = $1 limit 1`, [tenantId]);
  if (existing.rows.length) {
    await p.query(`update company_profile set logo_url = $2, updated_at = now() where tenant_id = $1`, [tenantId, url]);
  } else {
    await p.query(`insert into company_profile(tenant_id, logo_url) values ($1,$2)`, [tenantId, url]);
  }
}

// ---- Product lines ----

async function listProductLines(tenantId) {
  const p = getPool();
  const r = await p.query(`select id as "Id", name as "Name" from company_product_line where tenant_id = $1 order by name`, [tenantId]);
  return r.rows;
}
async function createProductLine(tenantId, name) {
  const p = getPool();
  const r = await p.query(`insert into company_product_line(tenant_id, name) values ($1,$2) returning id as "Id"`, [tenantId, name]);
  return r.rows[0].Id;
}
async function deleteProductLine(tenantId, id) {
  const p = getPool();
  await p.query(`delete from company_product_line where id = $1 and tenant_id = $2`, [id, tenantId]);
}

// ---- Warehouses ----

async function listWarehouses(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", tenant_id as "TenantId", name as "Name", address_type as "AddressType", warehouse_type as "WarehouseType",
            address1 as "Address1", address2 as "Address2", city as "City", state as "State", postal_code as "PostalCode",
            country as "Country", created_at as "CreatedAt", updated_at as "UpdatedAt"
     from company_warehouse where tenant_id = $1 order by name`,
    [tenantId]
  );
  return r.rows;
}
async function createWarehouse({ tenantId, name, addressType, warehouseType, address1, address2, city, state, postalCode, country }) {
  const p = getPool();
  const r = await p.query(
    `insert into company_warehouse(tenant_id, name, address_type, warehouse_type, address1, address2, city, state, postal_code, country)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id as "Id"`,
    [tenantId, name, addressType||null, warehouseType||null, address1||null, address2||null, city||null, state||null, postalCode||null, country||null]
  );
  return r.rows[0].Id;
}
async function updateWarehouse({ tenantId, id, name, addressType, warehouseType, address1, address2, city, state, postalCode, country }) {
  const p = getPool();
  await p.query(
    `update company_warehouse set name=coalesce($3,name), address_type=coalesce($4,address_type), warehouse_type=coalesce($5,warehouse_type),
       address1=coalesce($6,address1), address2=coalesce($7,address2), city=coalesce($8,city), state=coalesce($9,state),
       postal_code=coalesce($10,postal_code), country=coalesce($11,country), updated_at=now()
     where id = $2 and tenant_id = $1`,
    [tenantId, id, name||null, addressType||null, warehouseType||null, address1||null, address2||null, city||null, state||null, postalCode||null, country||null]
  );
}
async function deleteWarehouse(tenantId, id) {
  const p = getPool();
  await p.query(`delete from company_warehouse where id = $1 and tenant_id = $2`, [id, tenantId]);
}

// ---- Spaces ----

async function listSpaces(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", tenant_id as "TenantId", name as "Name", type as "Type", purpose as "Purpose", floor as "Floor",
            width as "Width", length as "Length", height as "Height", unit as "Unit", capacity as "Capacity",
            ventilation as "Ventilation", doors as "Doors", windows as "Windows", exit_plan_url as "ExitPlanUrl",
            created_at as "CreatedAt", updated_at as "UpdatedAt"
     from company_space where tenant_id = $1 order by name`,
    [tenantId]
  );
  return r.rows;
}
async function createSpace({ tenantId, name, type, purpose, floor, width, length, height, unit, capacity, ventilation, doors, windows }) {
  const p = getPool();
  const r = await p.query(
    `insert into company_space(tenant_id, name, type, purpose, floor, width, length, height, unit, capacity, ventilation, doors, windows)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id as "Id"`,
    [tenantId, name, type||null, purpose||null, floor||0, width||null, length||null, height||null, unit||null, capacity||null, ventilation||null, doors||0, windows||0]
  );
  return r.rows[0].Id;
}
async function setSpaceExitPlan(tenantId, id, url) {
  const p = getPool();
  await p.query(`update company_space set exit_plan_url = $3, updated_at = now() where id = $2 and tenant_id = $1`, [tenantId, id, url]);
}
async function deleteSpace(tenantId, id) {
  const p = getPool();
  await p.query(`delete from company_space where id = $1 and tenant_id = $2`, [id, tenantId]);
}

// ---- Assets ----

async function listAssets(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", tenant_id as "TenantId", asset_name as "AssetName", asset_type as "AssetType", quantity as "Quantity",
            purchase_date as "PurchaseDate", purchase_price as "PurchasePrice", supplier as "Supplier", notes as "Notes",
            saved_on as "SavedOn", created_at as "CreatedAt", updated_at as "UpdatedAt"
     from company_assets where tenant_id = $1 order by asset_name`,
    [tenantId]
  );
  return r.rows;
}
async function createAsset({ tenantId, assetName, assetType, quantity, purchaseDate, purchasePrice, supplier, notes }) {
  const p = getPool();
  const r = await p.query(
    `insert into company_assets(tenant_id, asset_name, asset_type, quantity, purchase_date, purchase_price, supplier, notes, saved_on)
     values ($1,$2,$3,$4,$5,$6,$7,$8, current_date) returning id as "Id"`,
    [tenantId, assetName, assetType||null, quantity||null, purchaseDate||null, purchasePrice||null, supplier||null, notes||null]
  );
  return r.rows[0].Id;
}
async function updateAsset({ tenantId, id, assetName, assetType, quantity, purchaseDate, purchasePrice, supplier, notes }) {
  const p = getPool();
  await p.query(
    `update company_assets set asset_name=coalesce($3,asset_name), asset_type=coalesce($4,asset_type), quantity=coalesce($5,quantity),
       purchase_date=coalesce($6,purchase_date), purchase_price=coalesce($7,purchase_price), supplier=coalesce($8,supplier),
       notes=coalesce($9,notes), updated_at=now()
     where id = $2 and tenant_id = $1`,
    [tenantId, id, assetName||null, assetType||null, quantity||null, purchaseDate||null, purchasePrice||null, supplier||null, notes||null]
  );
}
async function deleteAsset(tenantId, id) {
  const p = getPool();
  await p.query(`delete from company_assets where id = $1 and tenant_id = $2`, [id, tenantId]);
}

// ---- Certifications ----

async function listCertifications(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", tenant_id as "TenantId", type as "Type", policy as "Policy", name as "Name", valid_from as "ValidFrom",
            valid_till as "ValidTill", detail as "Detail", cert_image_url as "CertImageUrl", logo_url as "LogoUrl",
            created_at as "CreatedAt", updated_at as "UpdatedAt"
     from company_certification where tenant_id = $1 order by name`,
    [tenantId]
  );
  return r.rows;
}
async function createCertification({ tenantId, type, policy, name, validFrom, validTill, detail }) {
  const p = getPool();
  const r = await p.query(
    `insert into company_certification(tenant_id, type, policy, name, valid_from, valid_till, detail)
     values ($1,$2,$3,$4,$5,$6,$7) returning id as "Id"`,
    [tenantId, type||null, policy||null, name, validFrom||null, validTill||null, detail||null]
  );
  return r.rows[0].Id;
}
async function setCertificationImage(tenantId, id, url) {
  const p = getPool();
  await p.query(`update company_certification set cert_image_url = $3, updated_at = now() where id = $2 and tenant_id = $1`, [tenantId, id, url]);
}
async function setCertificationLogo(tenantId, id, url) {
  const p = getPool();
  await p.query(`update company_certification set logo_url = $3, updated_at = now() where id = $2 and tenant_id = $1`, [tenantId, id, url]);
}
async function deleteCertification(tenantId, id) {
  const p = getPool();
  await p.query(`delete from company_certification where id = $1 and tenant_id = $2`, [id, tenantId]);
}

// ---- Unions ----

async function listUnions(tenantId) {
  const p = getPool();
  const r = await p.query(`select id as "Id", name as "Name", description as "Description" from company_union where tenant_id = $1 order by name`, [tenantId]);
  return r.rows;
}
async function createUnion(tenantId, name, description) {
  const p = getPool();
  const r = await p.query(`insert into company_union(tenant_id, name, description) values ($1,$2,$3) returning id as "Id"`, [tenantId, name, description || null]);
  return r.rows[0].Id;
}
async function updateUnion({ tenantId, id, name, description }) {
  const p = getPool();
  await p.query(
    `update company_union set name=coalesce($3,name), description=coalesce($4,description), updated_at=now() where id = $2 and tenant_id = $1`,
    [tenantId, id, name||null, description||null]
  );
}
async function deleteUnion(tenantId, id) {
  const p = getPool();
  await p.query(`delete from company_union where id = $1 and tenant_id = $2`, [id, tenantId]);
}

// ---- Banks ----

async function listBanks(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select bank_id as "BankId", name as "Name", account_title as "AccountTitle", account_number as "AccountNumber",
            branch_name as "BranchName", notes as "Notes", opening_balance as "OpeningBalance", created_at as "CreatedAt"
     from banks where tenant_id = $1 order by name`,
    [tenantId || 0]
  );
  return r.rows;
}
async function getBank(tenantId, id) {
  const p = getPool();
  const r = await p.query(
    `select bank_id as "BankId", name as "Name", account_title as "AccountTitle", account_number as "AccountNumber",
            branch_name as "BranchName", notes as "Notes", opening_balance as "OpeningBalance", created_at as "CreatedAt"
     from banks where tenant_id = $1 and bank_id = $2 limit 1`,
    [tenantId || 0, id]
  );
  return r.rows[0] || null;
}
async function createBank({ tenantId, name, title, number, branchName, notes, openingBalance }) {
  const p = getPool();
  const r = await p.query(
    `insert into banks(tenant_id, name, account_title, account_number, branch_name, notes, opening_balance)
     values ($1,$2,$3,$4,$5,$6,$7) returning bank_id as "BankId"`,
    [tenantId || 0, name, title||null, number||null, branchName||null, notes||null, openingBalance || 0]
  );
  return r.rows[0].BankId;
}

// ---- Ledger ----

async function listLedger({ tenantId, bankId, type, limit }) {
  const p = getPool();
  const clauses = ['tenant_id = $1'];
  const vals = [tenantId || 0];
  let i = 2;
  if (bankId) { clauses.push(`bank_id = $${i++}`); vals.push(bankId); }
  if (type) { clauses.push(`entry_type = $${i++}`); vals.push(type); }
  let sql = `select ledger_id::int as "LedgerId", bank_id as "BankId", entry_type as "EntryType", amount as "Amount",
                    quantity as "Quantity", reference as "Reference", party as "Party", slip_number as "SlipNumber",
                    doc_url as "DocUrl", entry_date as "EntryDate"
             from bank_ledger where ${clauses.join(' and ')} order by entry_date desc, ledger_id desc`;
  if (limit > 0) { sql += ` limit $${i++}`; vals.push(limit); }
  const r = await p.query(sql, vals);
  return r.rows;
}

async function addLedgerEntry({ tenantId, bankId, type, amount, quantity, reference, party, slipNumber, docUrl, entryDate, createdBy }) {
  const p = getPool();
  const r = await p.query(
    `insert into bank_ledger(tenant_id, bank_id, entry_type, amount, quantity, reference, party, slip_number, doc_url, entry_date, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning ledger_id::int as "LedgerId"`,
    [tenantId || 0, bankId, type, amount, quantity != null ? quantity : null, reference || null, party || null, slipNumber || null, docUrl || null, entryDate || new Date(), createdBy || null]
  );
  return r.rows[0].LedgerId;
}

async function transfer({ tenantId, fromId, toId, amount, reference, userId }) {
  const p = getPool();
  const now = new Date();
  await p.query(
    `insert into bank_ledger(tenant_id, bank_id, entry_type, amount, reference, party, entry_date, created_by)
     values ($1,$2,'DR',$3,$4,$5,$6,$7)`,
    [tenantId || 0, fromId, amount, reference, `Transfer to ${toId}`, now, userId || null]
  );
  await p.query(
    `insert into bank_ledger(tenant_id, bank_id, entry_type, amount, reference, party, entry_date, created_by)
     values ($1,$2,'CR',$3,$4,$5,$6,$7)`,
    [tenantId || 0, toId, amount, reference, `Transfer from ${fromId}`, now, userId || null]
  );
}

async function bankSummary(tenantId) {
  const p = getPool();
  const r = await p.query(
    `select b.bank_id as "BankId", b.name as "Name", b.account_title as "AccountTitle", b.account_number as "AccountNumber",
            b.branch_name as "BranchName", b.notes as "Notes", b.opening_balance as "OpeningBalance",
            b.opening_balance + coalesce((
              select sum(case when l.entry_type = 'CR' then l.amount else -l.amount end)
              from bank_ledger l where l.tenant_id = b.tenant_id and l.bank_id = b.bank_id
            ), 0) as "Balance"
     from banks b where b.tenant_id = $1 order by b.name`,
    [tenantId || 0]
  );
  return r.rows;
}

// ---- AP invoices ----

async function listAp(tenantId, status) {
  const p = getPool();
  const clauses = ['tenant_id = $1'];
  const vals = [tenantId || 0];
  if (status) { clauses.push(`status = $2`); vals.push(status); }
  const r = await p.query(
    `select id as "Id", order_id as "OrderId", product_name as "ProductName", due_date as "DueDate", supplier_name as "SupplierName",
            amount as "Amount", status as "Status", doc_url as "DocUrl", notes as "Notes", bank_id as "BankId",
            created_at as "CreatedAt", approved_at as "ApprovedAt", paid_at as "PaidAt"
     from ap_invoices where ${clauses.join(' and ')} order by created_at desc, id desc`,
    vals
  );
  return r.rows;
}
async function createAp({ tenantId, orderId, productName, dueDate, supplierName, amount, docUrl, notes, createdBy }) {
  const p = getPool();
  const r = await p.query(
    `insert into ap_invoices(tenant_id, order_id, product_name, due_date, supplier_name, amount, doc_url, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id as "Id"`,
    [tenantId || 0, orderId || null, productName || null, dueDate || null, supplierName || null, amount, docUrl || null, notes || null, createdBy || null]
  );
  return r.rows[0].Id;
}
async function approveAp(tenantId, id, userId) {
  const p = getPool();
  await p.query(
    `update ap_invoices set status = 'Approved', approved_at = now(), approved_by = $3 where tenant_id = $1 and id = $2 and status = 'Pending'`,
    [tenantId || 0, id, userId || null]
  );
}
async function getAp(tenantId, id) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", order_id as "OrderId", product_name as "ProductName", supplier_name as "SupplierName", amount as "Amount"
     from ap_invoices where tenant_id = $1 and id = $2 limit 1`,
    [tenantId || 0, id]
  );
  return r.rows[0] || null;
}
async function payAp({ tenantId, id, bankId, userId }) {
  const p = getPool();
  await p.query(`update ap_invoices set status = 'Paid', paid_at = now(), paid_by = $3, bank_id = $4 where tenant_id = $1 and id = $2`, [tenantId || 0, id, userId || null, bankId]);
}

// ---- AR invoices ----

async function listAr(tenantId, status) {
  const p = getPool();
  const clauses = ['tenant_id = $1'];
  const vals = [tenantId || 0];
  if (status) { clauses.push(`status = $2`); vals.push(status); }
  const r = await p.query(
    `select id as "Id", order_id as "OrderId", product_name as "ProductName", due_date as "DueDate", customer_name as "CustomerName",
            amount as "Amount", status as "Status", doc_url as "DocUrl", notes as "Notes", bank_id as "BankId",
            created_at as "CreatedAt", received_at as "ReceivedAt"
     from ar_invoices where ${clauses.join(' and ')} order by created_at desc, id desc`,
    vals
  );
  return r.rows;
}
async function createAr({ tenantId, orderId, productName, dueDate, customerName, amount, docUrl, notes, createdBy }) {
  const p = getPool();
  const r = await p.query(
    `insert into ar_invoices(tenant_id, order_id, product_name, due_date, customer_name, amount, doc_url, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id as "Id"`,
    [tenantId || 0, orderId || null, productName || null, dueDate || null, customerName || null, amount, docUrl || null, notes || null, createdBy || null]
  );
  return r.rows[0].Id;
}
async function getAr(tenantId, id) {
  const p = getPool();
  const r = await p.query(
    `select id as "Id", order_id as "OrderId", product_name as "ProductName", customer_name as "CustomerName", amount as "Amount"
     from ar_invoices where tenant_id = $1 and id = $2 limit 1`,
    [tenantId || 0, id]
  );
  return r.rows[0] || null;
}
async function receiveAr({ tenantId, id, bankId, userId }) {
  const p = getPool();
  await p.query(`update ar_invoices set status = 'Received', received_at = now(), received_by = $3, bank_id = $4 where tenant_id = $1 and id = $2`, [tenantId || 0, id, userId || null, bankId]);
}

module.exports = {
  listAccounts, createAccount, deleteAccount,
  getCompanyProfile, upsertCompanyProfile, setCompanyLogo,
  listProductLines, createProductLine, deleteProductLine,
  listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse,
  listSpaces, createSpace, setSpaceExitPlan, deleteSpace,
  listAssets, createAsset, updateAsset, deleteAsset,
  listCertifications, createCertification, setCertificationImage, setCertificationLogo, deleteCertification,
  listUnions, createUnion, updateUnion, deleteUnion,
  listBanks, getBank, createBank,
  listLedger, addLedgerEntry, transfer, bankSummary,
  listAp, createAp, approveAp, getAp, payAp,
  listAr, createAr, getAr, receiveAr,
};
