/**
 * Safety Officer API Routes — Supabase (Postgres) implementation.
 * Mirrors safety-api.js route-for-route; registered instead of it when
 * ENABLE_SUPABASE_SAFETY=1. Sharing the same paths means only one of the
 * two modules is ever mounted, so there's no risk of duplicate handlers.
 */

const { createSupabasePgPool } = require('./db/supabase');

let pool = null;
function getPool() {
  if (!pool) pool = createSupabasePgPool();
  return pool;
}

function toPascalRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/(^|_)([a-z0-9])/g, (_, __, c) => c.toUpperCase())] = v;
  }
  return out;
}
function toPascalRows(rows) { return rows.map(toPascalRow); }

function setupSafetyRoutes(app) {
  const p = getPool();

  // ==================== INCIDENTS ====================

  app.get('/api/safety/incidents', async (req, res) => {
    try {
      const r = await p.query(`select id as "Id", incident_date as "IncidentDate", incident_type as "IncidentType",
        location as "Location", department as "Department", description as "Description", injury_occurred as "InjuryOccurred",
        property_damage as "PropertyDamage", severity as "Severity", reported_by as "ReportedBy",
        investigation_status as "InvestigationStatus", corrective_action as "CorrectiveAction", status as "Status",
        created_date as "CreatedDate", updated_date as "UpdatedDate"
        from safety_incidents order by created_date desc`);
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/safety/incidents/:id', async (req, res) => {
    try {
      const r = await p.query(`select id as "Id", incident_date as "IncidentDate", incident_type as "IncidentType",
        location as "Location", department as "Department", description as "Description", injury_occurred as "InjuryOccurred",
        property_damage as "PropertyDamage", severity as "Severity", reported_by as "ReportedBy",
        investigation_status as "InvestigationStatus", corrective_action as "CorrectiveAction", status as "Status",
        created_date as "CreatedDate", updated_date as "UpdatedDate"
        from safety_incidents where id = $1`, [req.params.id]);
      if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Incident not found' });
      res.json({ success: true, data: r.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/incidents', async (req, res) => {
    try {
      const { incidentDate, incidentType, location, department, description, injuryOccurred, propertyDamage,
        severity, reportedBy, investigationStatus, correctiveAction, status } = req.body;
      const r = await p.query(
        `insert into safety_incidents(incident_date, incident_type, location, department, description, injury_occurred,
           property_damage, severity, reported_by, investigation_status, corrective_action, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id as "Id"`,
        [incidentDate, incidentType, location, department, description, injuryOccurred, propertyDamage,
          severity, reportedBy, investigationStatus, correctiveAction, status || 'Open']
      );
      res.json({ success: true, id: r.rows[0].Id, message: 'Incident created successfully' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.put('/api/safety/incidents/:id', async (req, res) => {
    try {
      const { incidentDate, incidentType, location, department, description, injuryOccurred, propertyDamage,
        severity, reportedBy, investigationStatus, correctiveAction, status } = req.body;
      await p.query(
        `update safety_incidents set incident_date=$2, incident_type=$3, location=$4, department=$5, description=$6,
           injury_occurred=$7, property_damage=$8, severity=$9, reported_by=$10, investigation_status=$11,
           corrective_action=$12, status=$13, updated_date=now() where id=$1`,
        [req.params.id, incidentDate, incidentType, location, department, description, injuryOccurred, propertyDamage,
          severity, reportedBy, investigationStatus, correctiveAction, status]
      );
      res.json({ success: true, message: 'Incident updated successfully' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.delete('/api/safety/incidents/:id', async (req, res) => {
    try {
      await p.query('delete from safety_incidents where id = $1', [req.params.id]);
      res.json({ success: true, message: 'Incident deleted successfully' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ==================== GRIEVANCES ====================

  app.get('/api/safety/grievances', async (req, res) => {
    try {
      const r = await p.query(`select id as "Id", grievance_date as "GrievanceDate", complainant_name as "ComplainantName",
        complainant_role as "ComplainantRole", grievance_type as "GrievanceType", category as "Category",
        description as "Description", priority as "Priority", assigned_to as "AssignedTo",
        resolution_details as "ResolutionDetails", status as "Status", created_date as "CreatedDate", updated_date as "UpdatedDate"
        from safety_grievances order by created_date desc`);
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/grievances', async (req, res) => {
    try {
      const { grievanceDate, complainantName, complainantRole, grievanceType, category, description, priority,
        assignedTo, resolutionDetails, status } = req.body;
      const r = await p.query(
        `insert into safety_grievances(grievance_date, complainant_name, complainant_role, grievance_type, category,
           description, priority, assigned_to, resolution_details, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id as "Id"`,
        [grievanceDate, complainantName, complainantRole, grievanceType, category, description, priority,
          assignedTo, resolutionDetails, status || 'Pending']
      );
      res.json({ success: true, id: r.rows[0].Id, message: 'Grievance created successfully' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.put('/api/safety/grievances/:id', async (req, res) => {
    try {
      const { grievanceDate, complainantName, complainantRole, grievanceType, category, description, priority,
        assignedTo, resolutionDetails, status } = req.body;
      await p.query(
        `update safety_grievances set grievance_date=$2, complainant_name=$3, complainant_role=$4, grievance_type=$5,
           category=$6, description=$7, priority=$8, assigned_to=$9, resolution_details=$10, status=$11, updated_date=now()
         where id=$1`,
        [req.params.id, grievanceDate, complainantName, complainantRole, grievanceType, category, description, priority,
          assignedTo, resolutionDetails, status]
      );
      res.json({ success: true, message: 'Grievance updated successfully' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.delete('/api/safety/grievances/:id', async (req, res) => {
    try {
      await p.query('delete from safety_grievances where id = $1', [req.params.id]);
      res.json({ success: true, message: 'Grievance deleted successfully' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/safety/self-check', async (_req, res) => {
    try {
      const ping = await p.query('select now() as now');
      res.json({ success: true, message: 'Safety API self-check OK', data: { connected: true, now: ping.rows[0].now } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ==================== Generic "form data" checklist modules ====================
  // fire/electrical/structural/health/gas/boiler/consultant/dsa/emergency-power/
  // training(legacy)/ungp/usc-safe all follow one of two shapes:
  //  - one JSON blob row per tenant, upserted on save
  //  - GET returns either all rows or just the latest, with an optional
  //    fallback to a legacy fully-columnar table if the blob table is empty
  function registerFormModule({ routePath, table, legacyTable, topOne, label }) {
    app.get(`/api/safety/${routePath}`, async (req, res) => {
      try {
        const order = topOne ? ' limit 1' : '';
        const r = await p.query(
          `select id as "Id", tenant_id as "TenantId", form_data as "FormData", created_by as "CreatedBy",
                  created_date as "CreatedDate", updated_date as "UpdatedDate"
           from ${table} order by created_date desc${order}`
        );
        if (r.rows.length > 0 || !legacyTable) return res.json({ success: true, data: r.rows });
        const r2 = await p.query(`select * from ${legacyTable} order by created_date desc`);
        return res.json({ success: true, data: toPascalRows(r2.rows) });
      } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    app.post(`/api/safety/${routePath}`, async (req, res) => {
      try {
        const tenantId = req.body.tenantId || req.auth?.tid || 1;
        let data = req.body?.formData ?? null;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
          const fb = { ...req.body }; delete fb.formData; delete fb.createdBy; delete fb.tenantId;
          if (Object.keys(fb).length > 0) data = fb;
        }
        const formData = JSON.stringify(data || {});
        const createdBy = req.body.createdBy || (req.auth?.uid?.toString()) || 'System';
        const existing = await p.query(`select id from ${table} where tenant_id = $1`, [tenantId]);
        let id;
        if (existing.rows.length) {
          await p.query(`update ${table} set form_data = $2, updated_date = now() where tenant_id = $1`, [tenantId, formData]);
          id = existing.rows[0].id;
        } else {
          const r = await p.query(`insert into ${table}(tenant_id, form_data, created_by) values ($1,$2,$3) returning id`, [tenantId, formData, createdBy]);
          id = r.rows[0].id;
        }
        res.json({ success: true, id, message: `${label} saved` });
      } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    app.put(`/api/safety/${routePath}/:id`, async (req, res) => {
      try {
        await p.query(`update ${table} set form_data = $2, updated_date = now() where id = $1`, [req.params.id, JSON.stringify(req.body.formData)]);
        res.json({ success: true, message: `${label} updated` });
      } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    app.delete(`/api/safety/${routePath}/:id`, async (req, res) => {
      try {
        await p.query(`delete from ${table} where id = $1`, [req.params.id]);
        res.json({ success: true, message: `${label} deleted` });
      } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });
  }

  registerFormModule({ routePath: 'fire', table: 'safety_fire_safety', legacyTable: 'fire_safety', topOne: false, label: 'Fire safety record' });
  registerFormModule({ routePath: 'electrical', table: 'safety_electrical', legacyTable: 'electrical_safety', topOne: true, label: 'Electrical safety' });
  registerFormModule({ routePath: 'structural', table: 'safety_structural', legacyTable: 'structural_safety', topOne: true, label: 'Structural safety' });
  registerFormModule({ routePath: 'health', table: 'safety_health_hazards', legacyTable: 'health_hazards', topOne: true, label: 'Health hazards' });
  registerFormModule({ routePath: 'usc-safe', table: 'safety_usc_safe', legacyTable: null, topOne: false, label: 'USC-Safe record' });
  registerFormModule({ routePath: 'gas', table: 'safety_gas_safety', legacyTable: null, topOne: false, label: 'Gas safety record' });
  registerFormModule({ routePath: 'boiler', table: 'safety_boiler_safety', legacyTable: null, topOne: false, label: 'Boiler safety record' });
  registerFormModule({ routePath: 'consultant', table: 'safety_consultant', legacyTable: null, topOne: false, label: 'Consultant record' });
  registerFormModule({ routePath: 'dsa', table: 'safety_dsa', legacyTable: null, topOne: false, label: 'DSA record' });
  registerFormModule({ routePath: 'emergency-power', table: 'safety_emergency_power', legacyTable: null, topOne: false, label: 'Emergency power record' });
  registerFormModule({ routePath: 'training', table: 'safety_safety_training', legacyTable: null, topOne: false, label: 'Training record' });
  registerFormModule({ routePath: 'ungp', table: 'safety_ungp', legacyTable: null, topOne: false, label: 'UNGP record' });

  // ==================== SAFETY TRAINING (sessions + attendees) ====================

  app.get('/api/safety/training-sessions', async (req, res) => {
    try {
      const { tenantId, q, fromDate, toDate } = req.query;
      const clauses = ['1=1']; const vals = []; let i = 1;
      if (tenantId) { clauses.push(`tenant_id = $${i++}`); vals.push(parseInt(tenantId)); }
      if (q) { clauses.push(`(name ilike $${i} or related_to ilike $${i})`); vals.push(`%${q}%`); i++; }
      if (fromDate) { clauses.push(`training_date >= $${i++}`); vals.push(fromDate); }
      if (toDate) { clauses.push(`training_date <= $${i++}`); vals.push(toDate); }
      const r = await p.query(
        `select id as "Id", tenant_id as "TenantId", name as "Name", description as "Description", related_to as "RelatedTo",
                training_date as "TrainingDate", conducted_by as "ConductedBy", created_by as "CreatedBy",
                created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_training_session where ${clauses.join(' and ')} order by training_date desc, created_date desc`,
        vals
      );
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/training-sessions', async (req, res) => {
    try {
      const { tenantId = 1, name, description, relatedTo, trainingDate, conductedBy, createdBy = 'System', attendees = [] } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'name required' });
      const r = await p.query(
        `insert into safety_training_session(tenant_id, name, description, related_to, training_date, conducted_by, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [tenantId, name, description || null, relatedTo || null, trainingDate || null, conductedBy || null, createdBy]
      );
      const sessionId = r.rows[0].id;
      for (const a of attendees) {
        await p.query(`insert into safety_training_attendee(session_id, employee_id, name, email) values ($1,$2,$3,$4)`,
          [sessionId, a.employeeId || null, a.name || null, a.email || null]);
      }
      res.json({ success: true, id: sessionId, message: 'Training created' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/safety/training-sessions/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const s = await p.query(
        `select id as "Id", tenant_id as "TenantId", name as "Name", description as "Description", related_to as "RelatedTo",
                training_date as "TrainingDate", conducted_by as "ConductedBy", created_by as "CreatedBy",
                created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_training_session where id = $1`, [id]);
      if (s.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
      const a = await p.query(
        `select id as "Id", session_id as "SessionId", employee_id as "EmployeeId", name as "Name", email as "Email",
                created_date as "CreatedDate"
         from safety_training_attendee where session_id = $1`, [id]);
      res.json({ success: true, data: { session: s.rows[0], attendees: a.rows } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.put('/api/safety/training-sessions/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description, relatedTo, trainingDate, conductedBy } = req.body;
      await p.query(
        `update safety_training_session set name=coalesce($2,name), description=coalesce($3,description),
           related_to=coalesce($4,related_to), training_date=coalesce($5,training_date), conducted_by=coalesce($6,conducted_by),
           updated_date=now() where id=$1`,
        [id, name || null, description || null, relatedTo || null, trainingDate || null, conductedBy || null]
      );
      res.json({ success: true, message: 'Updated' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.delete('/api/safety/training-sessions/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await p.query('delete from safety_training_attendee where session_id = $1', [id]);
      await p.query('delete from safety_training_session where id = $1', [id]);
      res.json({ success: true, message: 'Deleted' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/training-sessions/:id/attendees', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const attendees = Array.isArray(req.body.attendees) ? req.body.attendees : [];
      await p.query('delete from safety_training_attendee where session_id = $1', [id]);
      for (const a of attendees) {
        await p.query('insert into safety_training_attendee(session_id, employee_id, name, email) values ($1,$2,$3,$4)',
          [id, a.employeeId || null, a.name || null, a.email || null]);
      }
      res.json({ success: true, message: 'Attendees saved' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ==================== SAFETY AUDITS ====================

  app.post('/api/safety/audits', async (req, res) => {
    try {
      const { tenantId = 1, auditName, auditType, auditCompany, auditDate, createdBy = 'System' } = req.body;
      if (!auditName || !auditType) return res.status(400).json({ success: false, error: 'auditName and auditType are required' });
      const r = await p.query(
        `insert into safety_audit_plan(tenant_id, audit_name, audit_type, audit_company, audit_date, created_by)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [tenantId, auditName, auditType, auditCompany || null, auditDate || null, createdBy]
      );
      res.json({ success: true, id: r.rows[0].id, message: 'Audit planned successfully' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/safety/audits', async (req, res) => {
    try {
      const { q, status, tenantId, company } = req.query;
      const clauses = ['1=1']; const vals = []; let i = 1;
      if (tenantId) { clauses.push(`tenant_id = $${i++}`); vals.push(parseInt(tenantId)); }
      if (status) { clauses.push(`status = $${i++}`); vals.push(status); }
      if (company) { clauses.push(`audit_company = $${i++}`); vals.push(company); }
      if (q) { clauses.push(`audit_name ilike $${i++}`); vals.push(`%${q}%`); }
      const r = await p.query(
        `select id as "Id", tenant_id as "TenantId", audit_name as "AuditName", audit_type as "AuditType",
                audit_company as "AuditCompany", audit_date as "AuditDate", status as "Status", created_by as "CreatedBy",
                created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_audit_plan where ${clauses.join(' and ')} order by created_date desc`,
        vals
      );
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/safety/audits/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const plan = await p.query(
        `select id as "Id", tenant_id as "TenantId", audit_name as "AuditName", audit_type as "AuditType",
                audit_company as "AuditCompany", audit_date as "AuditDate", status as "Status", created_by as "CreatedBy",
                created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_audit_plan where id = $1`, [id]);
      if (plan.rows.length === 0) return res.status(404).json({ success: false, error: 'Audit not found' });
      const items = await p.query(
        `select id as "Id", audit_id as "AuditId", head as "Head", value as "Value", no_issue as "NoIssue",
                issue_details as "IssueDetails", attachments as "Attachments", suggested_action as "SuggestedAction",
                informed_to as "InformedTo", created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_audit_item where audit_id = $1 order by id asc`, [id]);
      const corrective = await p.query(
        `select c.id as "Id", c.audit_item_id as "AuditItemId", c.corrective_action_taken as "CorrectiveActionTaken",
                c.attachments as "Attachments", c.corrective_action_by as "CorrectiveActionBy",
                c.corrective_action_on as "CorrectiveActionOn", c.resolution_mode as "ResolutionMode",
                c.resolution_amount as "ResolutionAmount", c.status as "Status", c.created_date as "CreatedDate"
         from safety_audit_corrective_action c
         join safety_audit_item i on i.id = c.audit_item_id
         where i.audit_id = $1 order by c.created_date desc`, [id]);
      const reaudit = await p.query(
        `select id as "Id", audit_id as "AuditId", notes as "Notes", attachments as "Attachments", status as "Status",
                created_by as "CreatedBy", created_date as "CreatedDate"
         from safety_audit_reaudit where audit_id = $1 order by created_date desc limit 1`, [id]);
      res.json({ success: true, data: { plan: plan.rows[0], items: items.rows, corrective: corrective.rows, reaudit: reaudit.rows[0] || null } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/audits/:id/items', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      if (items.length === 0) return res.status(400).json({ success: false, error: 'No items provided' });
      await p.query('delete from safety_audit_item where audit_id = $1', [id]);
      for (const it of items) {
        const hasNoIssueFlag = (typeof it.NoIssue === 'boolean');
        const noIssue = hasNoIssueFlag ? (it.NoIssue === false ? false : true) : true;
        await p.query(
          `insert into safety_audit_item(audit_id, head, value, no_issue, issue_details, attachments, suggested_action, informed_to)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, it.Head || '', it.Value || null, noIssue, it.IssueDetails || null, it.Attachments || null, it.SuggestedAction || null, it.InformedTo || null]
        );
      }
      const anyAnswered = items.some(i => typeof i.NoIssue === 'boolean' || (i.IssueDetails && i.IssueDetails.trim() !== ''));
      const anyIssues = items.some(i => i.NoIssue === false || (i.IssueDetails && i.IssueDetails.trim() !== ''));
      const newStatus = !anyAnswered ? 'Planned' : (anyIssues ? 'OpenIssues' : 'Closed');
      await p.query('update safety_audit_plan set status = $2, updated_date = now() where id = $1', [id, newStatus]);
      res.json({ success: true, message: 'Audit items saved', status: newStatus });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/audits/:auditId/items/:itemId/corrective-actions', async (req, res) => {
    try {
      const { auditId, itemId } = req.params;
      const { correctiveActionTaken, attachments, correctiveActionBy, correctiveActionOn, resolutionMode, resolutionAmount, status } = req.body || {};
      let statusToSave = null;
      if (status !== undefined && status !== null) {
        const userId = req.auth?.uid; const tenantId = req.auth?.tid;
        if (userId && tenantId) {
          const roleResult = await p.query(
            `select r.name from user_roles ur join roles r on r.role_id = ur.role_id where ur.user_id = $1 and ur.tenant_id = $2`,
            [userId, tenantId]
          );
          const roles = roleResult.rows.map(r => (r.name || '').toLowerCase());
          const isAuditOfficer = roles.includes('safety auditor') || roles.includes('audit officer');
          statusToSave = isAuditOfficer ? status : null;
        }
      }
      let amountVal = null;
      if (resolutionAmount !== undefined && resolutionAmount !== null && resolutionAmount !== '') {
        const n = Number(resolutionAmount);
        amountVal = Number.isFinite(n) ? n : null;
      }
      const r = await p.query(
        `insert into safety_audit_corrective_action(audit_item_id, corrective_action_taken, attachments, corrective_action_by,
           corrective_action_on, resolution_mode, resolution_amount, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [parseInt(itemId), correctiveActionTaken || null, attachments || null, correctiveActionBy || null,
          correctiveActionOn || null, resolutionMode || null, amountVal, statusToSave]
      );
      await p.query(`update safety_audit_plan set status = 'CorrectiveSubmitted', updated_date = now() where id = $1`, [parseInt(auditId)]);
      res.json({ success: true, id: r.rows[0].id, message: 'Corrective action saved' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.put('/api/safety/audits/:id/status', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes, attachments, createdBy = 'Auditor' } = req.body;
      if (!status) return res.status(400).json({ success: false, error: 'status is required' });
      await p.query('update safety_audit_plan set status = $2, updated_date = now() where id = $1', [id, status]);
      if (notes || attachments || status === 'Closed') {
        await p.query(
          `insert into safety_audit_reaudit(audit_id, notes, attachments, status, created_by) values ($1,$2,$3,$4,$5)`,
          [id, notes || null, attachments || null, status, createdBy]
        );
      }
      res.json({ success: true, message: 'Status updated' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ==================== RFQ / QUOTES / PO / INVOICE ====================

  app.get('/api/safety/units', async (req, res) => {
    try {
      const tenantId = parseInt(req.query.tenantId) || 1;
      const r = await p.query(`select id as "Id", tenant_id as "TenantId", name as "Name", created_date as "CreatedDate"
        from safety_units where tenant_id = $1 order by name`, [tenantId]);
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.post('/api/safety/units', async (req, res) => {
    try {
      const { tenantId = 1, name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'name is required' });
      const existing = await p.query('select id from safety_units where tenant_id = $1 and name = $2', [tenantId, name]);
      if (existing.rows.length) return res.json({ success: true, id: existing.rows[0].id });
      const r = await p.query('insert into safety_units(tenant_id, name) values ($1,$2) returning id', [tenantId, name]);
      res.json({ success: true, id: r.rows[0].id });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.delete('/api/safety/units/:id', async (req, res) => {
    try {
      await p.query('delete from safety_units where id = $1', [parseInt(req.params.id)]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/rfq', async (req, res) => {
    try {
      const { tenantId = 1, auditId, auditItemId, itemName, detail, qty, unit, neededBy,
        shippingTerms, paymentTerms, otherTerms, recipients, createdBy = 'SafetyOfficer' } = req.body;
      if (!itemName) return res.status(400).json({ success: false, error: 'itemName is required' });
      const r = await p.query(
        `insert into safety_rfq(tenant_id, audit_id, audit_item_id, item_name, detail, qty, unit, needed_by,
           shipping_terms, payment_terms, other_terms, recipients, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [tenantId, auditId || null, auditItemId || null, itemName, detail || null, qty || null, unit || null,
          neededBy || null, shippingTerms || null, paymentTerms || null, otherTerms || null, recipients || null, createdBy]
      );
      res.json({ success: true, id: r.rows[0].id, message: 'RFQ created' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.put('/api/safety/rfq/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { itemName, detail, qty, unit, neededBy, shippingTerms, paymentTerms, otherTerms, recipients, status } = req.body;
      await p.query(
        `update safety_rfq set item_name=coalesce($2,item_name), detail=coalesce($3,detail), qty=coalesce($4,qty),
           unit=coalesce($5,unit), needed_by=coalesce($6,needed_by), shipping_terms=coalesce($7,shipping_terms),
           payment_terms=coalesce($8,payment_terms), other_terms=coalesce($9,other_terms), recipients=coalesce($10,recipients),
           status=coalesce($11,status), updated_date=now() where id=$1`,
        [id, itemName || null, detail || null, qty || null, unit || null, neededBy || null, shippingTerms || null,
          paymentTerms || null, otherTerms || null, recipients || null, status || null]
      );
      res.json({ success: true, message: 'RFQ updated' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.delete('/api/safety/rfq/:id', async (req, res) => {
    try {
      await p.query('delete from safety_rfq where id = $1', [parseInt(req.params.id)]);
      res.json({ success: true, message: 'RFQ deleted' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.get('/api/safety/rfq', async (req, res) => {
    try {
      const { tenantId, status } = req.query;
      const clauses = ['1=1']; const vals = []; let i = 1;
      if (tenantId) { clauses.push(`tenant_id = $${i++}`); vals.push(parseInt(tenantId)); }
      if (status) { clauses.push(`status = $${i++}`); vals.push(status); }
      const r = await p.query(
        `select id as "Id", tenant_id as "TenantId", audit_id as "AuditId", audit_item_id as "AuditItemId",
                item_name as "ItemName", detail as "Detail", qty as "Qty", unit as "Unit", needed_by as "NeededBy",
                shipping_terms as "ShippingTerms", payment_terms as "PaymentTerms", other_terms as "OtherTerms",
                recipients as "Recipients", status as "Status", created_by as "CreatedBy",
                created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_rfq where ${clauses.join(' and ')} order by created_date desc`,
        vals
      );
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.get('/api/safety/rfq/by-item/:auditItemId', async (req, res) => {
    try {
      const r = await p.query(
        `select id as "Id", tenant_id as "TenantId", audit_id as "AuditId", audit_item_id as "AuditItemId",
                item_name as "ItemName", detail as "Detail", qty as "Qty", unit as "Unit", needed_by as "NeededBy",
                shipping_terms as "ShippingTerms", payment_terms as "PaymentTerms", other_terms as "OtherTerms",
                recipients as "Recipients", status as "Status", created_by as "CreatedBy",
                created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_rfq where audit_item_id = $1 order by created_date desc`,
        [parseInt(req.params.auditItemId)]
      );
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/rfq/:id/quotes', async (req, res) => {
    try {
      const rfqId = parseInt(req.params.id);
      const { supplierName, supplierEmail, price, shippingCost, tax, discount, total, arrivalDate, shippingTerms, paymentTerms, otherTerms } = req.body;
      const r = await p.query(
        `insert into safety_rfq_quote(rfq_id, supplier_name, supplier_email, price, shipping_cost, tax, discount, total,
           arrival_date, shipping_terms, payment_terms, other_terms)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [rfqId, supplierName || null, supplierEmail || null, price || 0, shippingCost || 0, tax || 0, discount || 0,
          total || 0, arrivalDate || null, shippingTerms || null, paymentTerms || null, otherTerms || null]
      );
      res.json({ success: true, id: r.rows[0].id, message: 'Quote submitted' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.get('/api/safety/rfq/:id/quotes', async (req, res) => {
    try {
      const r = await p.query(
        `select id as "Id", rfq_id as "RFQId", supplier_name as "SupplierName", supplier_email as "SupplierEmail",
                price as "Price", shipping_cost as "ShippingCost", tax as "Tax", discount as "Discount", total as "Total",
                arrival_date as "ArrivalDate", shipping_terms as "ShippingTerms", payment_terms as "PaymentTerms",
                other_terms as "OtherTerms", status as "Status", approved as "Approved", approved_date as "ApprovedDate",
                po_number as "PONumber", created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_rfq_quote where rfq_id = $1 order by created_date desc`,
        [parseInt(req.params.id)]
      );
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.put('/api/safety/quotes/:id/approve', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { poNumber } = req.body;
      await p.query(`update safety_rfq_quote set approved = true, approved_date = now(), status = 'Approved', po_number = $2 where id = $1`,
        [id, poNumber || null]);
      res.json({ success: true, message: 'Quote approved' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.put('/api/safety/quotes/:id/status', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      await p.query('update safety_rfq_quote set status = coalesce($2,status), updated_date = now() where id = $1', [id, status || null]);
      res.json({ success: true, message: 'Quote status updated' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/safety/quotes/:id/invoice', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { invoiceNumber, subtotal, tax, total, attachmentUrl } = req.body;
      const r = await p.query(
        `insert into safety_rfq_invoice(quote_id, invoice_number, subtotal, tax, total, attachment_url)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [id, invoiceNumber, subtotal || 0, tax || 0, total || 0, attachmentUrl || null]
      );
      res.json({ success: true, id: r.rows[0].id, message: 'Invoice recorded' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.get('/api/safety/quotes/:id/invoice', async (req, res) => {
    try {
      const r = await p.query(
        `select id as "Id", quote_id as "QuoteId", invoice_number as "InvoiceNumber", subtotal as "Subtotal", tax as "Tax",
                total as "Total", attachment_url as "AttachmentUrl", status as "Status", created_date as "CreatedDate",
                updated_date as "UpdatedDate"
         from safety_rfq_invoice where quote_id = $1 order by created_date desc limit 1`,
        [parseInt(req.params.id)]
      );
      res.json({ success: true, data: r.rows[0] || null });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/safety/rfq/quote-stats', async (req, res) => {
    try {
      const { tenantId, supplierEmail } = req.query;
      const clauses = ['1=1']; const vals = []; let i = 1;
      if (tenantId) { clauses.push(`rfq.tenant_id = $${i++}`); vals.push(parseInt(tenantId)); }
      if (supplierEmail) { clauses.push(`q.supplier_email = $${i++}`); vals.push(supplierEmail); }
      const r = await p.query(
        `select count(*)::int as "Total",
                sum(case when q.status = 'Submitted' then 1 else 0 end)::int as "Submitted",
                sum(case when q.status = 'Approved' then 1 else 0 end)::int as "Approved",
                sum(case when q.status = 'Delivered' then 1 else 0 end)::int as "Delivered"
         from safety_rfq_quote q
         join safety_rfq rfq on rfq.id = q.rfq_id
         where ${clauses.join(' and ')}`,
        vals
      );
      res.json({ success: true, data: r.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ==================== AI PROMPT TEMPLATES ====================

  app.get('/api/ai/prompts', async (req, res) => {
    try {
      const { tenantId, q, category } = req.query;
      const clauses = ['1=1']; const vals = []; let i = 1;
      if (tenantId) { clauses.push(`tenant_id = $${i++}`); vals.push(parseInt(tenantId)); }
      if (category) { clauses.push(`category = $${i++}`); vals.push(category); }
      if (q) { clauses.push(`(name ilike $${i} or content ilike $${i})`); vals.push(`%${q}%`); i++; }
      const r = await p.query(
        `select id as "Id", tenant_id as "TenantId", name as "Name", category as "Category", content as "Content",
                created_by as "CreatedBy", created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_ai_prompt_templates where ${clauses.join(' and ')} order by created_date desc`,
        vals
      );
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.post('/api/ai/prompts', async (req, res) => {
    try {
      const { tenantId = 1, name, category = null, content, createdBy = 'System' } = req.body;
      if (!name || !content) return res.status(400).json({ success: false, error: 'name and content required' });
      const r = await p.query(
        `insert into safety_ai_prompt_templates(tenant_id, name, category, content, created_by) values ($1,$2,$3,$4,$5) returning id`,
        [tenantId, name, category, content, createdBy]
      );
      res.json({ success: true, id: r.rows[0].id, message: 'Prompt saved' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.get('/api/ai/prompts/:id', async (req, res) => {
    try {
      const r = await p.query(
        `select id as "Id", tenant_id as "TenantId", name as "Name", category as "Category", content as "Content",
                created_by as "CreatedBy", created_date as "CreatedDate", updated_date as "UpdatedDate"
         from safety_ai_prompt_templates where id = $1`, [parseInt(req.params.id)]);
      if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: r.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.put('/api/ai/prompts/:id', async (req, res) => {
    try {
      const { name, category, content } = req.body;
      await p.query(
        `update safety_ai_prompt_templates set name=coalesce($2,name), category=coalesce($3,category),
           content=coalesce($4,content), updated_date=now() where id=$1`,
        [parseInt(req.params.id), name || null, category || null, content || null]
      );
      res.json({ success: true, message: 'Updated' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.delete('/api/ai/prompts/:id', async (req, res) => {
    try {
      await p.query('delete from safety_ai_prompt_templates where id = $1', [parseInt(req.params.id)]);
      res.json({ success: true, message: 'Deleted' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ==================== ATTENDANCE (Barcode-based) ====================

  app.get('/api/attendance/barcodes', async (req, res) => {
    try {
      const { tenantId, q } = req.query;
      const clauses = ['1=1']; const vals = []; let i = 1;
      if (tenantId) { clauses.push(`b.tenant_id = $${i++}`); vals.push(parseInt(tenantId)); }
      if (q) { clauses.push(`(u.full_name ilike $${i} or u.email ilike $${i} or b.barcode ilike $${i})`); vals.push(`%${q}%`); i++; }
      const r = await p.query(
        `select b.id as "Id", b.tenant_id as "TenantId", b.user_id as "UserId", b.barcode as "Barcode",
                b.photo_url as "PhotoUrl", b.created_date as "CreatedDate", u.full_name as "FullName", u.email as "Email"
         from safety_attendance_barcode b
         left join users u on u.user_id = b.user_id
         where ${clauses.join(' and ')} order by u.full_name`,
        vals
      );
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.post('/api/attendance/barcodes', async (req, res) => {
    try {
      const { tenantId = 1, userId, barcode, photoUrl = null } = req.body;
      if (!userId || !barcode) return res.status(400).json({ success: false, error: 'userId and barcode required' });
      const existing = await p.query('select id from safety_attendance_barcode where tenant_id = $1 and user_id = $2', [tenantId, userId]);
      if (existing.rows.length) {
        await p.query('update safety_attendance_barcode set barcode = $3, photo_url = $4 where tenant_id = $1 and user_id = $2',
          [tenantId, userId, barcode, photoUrl]);
      } else {
        await p.query('insert into safety_attendance_barcode(tenant_id, user_id, barcode, photo_url) values ($1,$2,$3,$4)',
          [tenantId, userId, barcode, photoUrl]);
      }
      res.json({ success: true, message: 'Saved' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
  app.delete('/api/attendance/barcodes/:id', async (req, res) => {
    try {
      await p.query('delete from safety_attendance_barcode where id = $1', [parseInt(req.params.id)]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/attendance/logs', async (req, res) => {
    try {
      let { tenantId = 1, userId, barcode, direction, source = 'Barcode', deviceId = null, notes = null, timestamp = null } = req.body;
      if (!userId) {
        if (!barcode) return res.status(400).json({ success: false, error: 'userId or barcode required' });
        const r = await p.query('select user_id from safety_attendance_barcode where tenant_id = $1 and barcode = $2', [tenantId, barcode]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'barcode not assigned' });
        userId = r.rows[0].user_id;
      }
      if (!direction) {
        const last = await p.query(
          `select direction from safety_attendance_log where tenant_id = $1 and user_id = $2 order by "timestamp" desc limit 1`,
          [tenantId, userId]
        );
        direction = (last.rows.length > 0 && last.rows[0].direction === 'In') ? 'Out' : 'In';
      }
      const r2 = await p.query(
        `insert into safety_attendance_log(tenant_id, user_id, direction, "timestamp", source, device_id, notes)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [tenantId, userId, direction, timestamp || new Date(), source, deviceId, notes]
      );
      res.json({ success: true, id: r2.rows[0].id, data: { userId, direction } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/attendance/logs', async (req, res) => {
    try {
      const { tenantId, userId, from, to } = req.query;
      const clauses = ['1=1']; const vals = []; let i = 1;
      if (tenantId) { clauses.push(`l.tenant_id = $${i++}`); vals.push(parseInt(tenantId)); }
      if (userId) { clauses.push(`l.user_id = $${i++}`); vals.push(parseInt(userId)); }
      if (from) { clauses.push(`l."timestamp" >= $${i++}`); vals.push(from); }
      if (to) { clauses.push(`l."timestamp" <= $${i++}`); vals.push(to); }
      const r = await p.query(
        `select l.id as "Id", l.tenant_id as "TenantId", l.user_id as "UserId", l.direction as "Direction",
                l."timestamp" as "Timestamp", l.source as "Source", l.device_id as "DeviceId", l.notes as "Notes",
                u.full_name as "FullName", u.email as "Email"
         from safety_attendance_log l
         left join users u on u.user_id = l.user_id
         where ${clauses.join(' and ')} order by l."timestamp" desc`,
        vals
      );
      res.json({ success: true, data: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/attendance/status', async (req, res) => {
    try {
      const { tenantId, userId } = req.query;
      if (!tenantId || !userId) return res.status(400).json({ success: false, error: 'tenantId and userId required' });
      const r = await p.query(
        `select direction as "Direction", "timestamp" as "Timestamp" from safety_attendance_log
         where tenant_id = $1 and user_id = $2 order by "timestamp" desc limit 1`,
        [parseInt(tenantId), parseInt(userId)]
      );
      res.json({ success: true, data: r.rows[0] || null });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  console.log('✅ Safety API routes configured (Supabase)');
}

module.exports = { setupSafetyRoutes };
